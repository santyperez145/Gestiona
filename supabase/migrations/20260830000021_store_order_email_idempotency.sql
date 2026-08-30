-- D5.3: los correos transaccionales de una orden se reclaman una sola vez.
--
-- Checkout, store-pay y el webhook de Mercado Pago pueden informar la misma
-- transición. También dos operadores pueden hacer doble click en el aviso de
-- despacho. La restricción única anterior evitaba parte de los duplicados,
-- pero el SELECT seguido de INSERT/UPDATE dejaba una carrera entre instancias.
--
-- Esta migración convierte el log existente en un ledger de entregas para los
-- cuatro eventos de la orden y sus dos audiencias. `claim` toma el trabajo en
-- una transacción corta; el proveedor se llama después, fuera de PostgreSQL;
-- `finish` sólo acepta el token de ese intento. Un lease recupera un worker que
-- murió sin dejar dos instancias activas indefinidamente.

ALTER TABLE public.store_order_status_email_log
  ADD COLUMN IF NOT EXISTS audience text,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_id text;

UPDATE public.store_order_status_email_log
SET audience = 'buyer'
WHERE audience IS NULL;

ALTER TABLE public.store_order_status_email_log
  ALTER COLUMN audience SET DEFAULT 'buyer',
  ALTER COLUMN audience SET NOT NULL;

ALTER TABLE public.store_order_status_email_log
  DROP CONSTRAINT IF EXISTS store_order_status_email_log_event_check,
  DROP CONSTRAINT IF EXISTS store_order_status_email_log_audience_check,
  DROP CONSTRAINT IF EXISTS store_order_status_email_log_ecommerce_order_id_event_key;

ALTER TABLE public.store_order_status_email_log
  ADD CONSTRAINT store_order_status_email_log_event_check
    CHECK (event IN ('order_created', 'payment_confirmed', 'shipped', 'delivered')),
  ADD CONSTRAINT store_order_status_email_log_audience_check
    CHECK (audience IN ('buyer', 'merchant'));

CREATE UNIQUE INDEX IF NOT EXISTS store_order_email_delivery_event_key
  ON public.store_order_status_email_log (ecommerce_order_id, audience, event);

DROP INDEX IF EXISTS public.store_order_status_email_log_pending_idx;
CREATE INDEX IF NOT EXISTS store_order_email_delivery_pending_idx
  ON public.store_order_status_email_log (status, updated_at)
  WHERE status <> 'sent';

COMMENT ON TABLE public.store_order_status_email_log IS
  'Ledger privado e idempotente de emails transaccionales de ecommerce. Un claim atómico precede al proveedor y finish exige el token del intento.';
COMMENT ON COLUMN public.store_order_status_email_log.claim_token IS
  'Token efímero del worker que reclamó el envío; evita que un intento vencido cierre el intento nuevo.';
COMMENT ON COLUMN public.store_order_status_email_log.provider_message_id IS
  'Identificador saneado que devuelve el proveedor, cuando existe. Nunca contiene la credencial.';

CREATE OR REPLACE FUNCTION public.claim_store_order_email(
  p_order_id uuid,
  p_audience text,
  p_event text,
  p_recipient_email text,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_delivery public.store_order_status_email_log%ROWTYPE;
  v_claim_token uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 300), 30), 900);
  v_inserted boolean := false;
BEGIN
  IF p_order_id IS NULL
     OR p_audience NOT IN ('buyer', 'merchant')
     OR p_event NOT IN ('order_created', 'payment_confirmed', 'shipped', 'delivered')
     OR NULLIF(btrim(p_recipient_email), '') IS NULL THEN
    RAISE EXCEPTION 'Parámetros de entrega de email inválidos' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.store_order_status_email_log (
    ecommerce_order_id,
    audience,
    event,
    recipient_email,
    status,
    attempt_count,
    claim_token,
    claimed_at,
    updated_at
  ) VALUES (
    p_order_id,
    p_audience,
    p_event,
    lower(btrim(p_recipient_email)),
    'pending',
    1,
    v_claim_token,
    v_now,
    v_now
  )
  ON CONFLICT (ecommerce_order_id, audience, event) DO NOTHING
  RETURNING * INTO v_delivery;

  v_inserted := FOUND;
  IF NOT v_inserted THEN
    SELECT *
    INTO v_delivery
    FROM public.store_order_status_email_log
    WHERE ecommerce_order_id = p_order_id
      AND audience = p_audience
      AND event = p_event
    FOR UPDATE;

    IF v_delivery.status = 'sent' THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'duplicate', true,
        'inProgress', false,
        'deliveryId', v_delivery.id
      );
    END IF;

    IF v_delivery.status = 'pending'
       AND v_delivery.claimed_at IS NOT NULL
       AND v_delivery.claimed_at > v_now - make_interval(secs => v_lease_seconds) THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'duplicate', false,
        'inProgress', true,
        'deliveryId', v_delivery.id
      );
    END IF;

    UPDATE public.store_order_status_email_log
    SET recipient_email = lower(btrim(p_recipient_email)),
        status = 'pending',
        provider = NULL,
        provider_message_id = NULL,
        last_error = NULL,
        attempt_count = attempt_count + 1,
        claim_token = v_claim_token,
        claimed_at = v_now,
        updated_at = v_now
    WHERE id = v_delivery.id
    RETURNING * INTO v_delivery;
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'duplicate', false,
    'inProgress', false,
    'deliveryId', v_delivery.id,
    'claimToken', v_claim_token,
    'idempotencyKey', concat(
      'gestiona-order-email/', p_order_id::text, '/', p_audience, '/', p_event
    ),
    'attempt', v_delivery.attempt_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_store_order_email(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_success boolean,
  p_provider text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.store_order_status_email_log
  SET status = CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
      provider = NULLIF(left(COALESCE(p_provider, ''), 40), ''),
      provider_message_id = NULLIF(left(COALESCE(p_provider_message_id, ''), 255), ''),
      last_error = CASE
        WHEN p_success THEN NULL
        ELSE left(COALESCE(NULLIF(p_error, ''), 'No se pudo enviar el email'), 2000)
      END,
      sent_at = CASE WHEN p_success THEN clock_timestamp() ELSE sent_at END,
      claim_token = NULL,
      updated_at = clock_timestamp()
  WHERE id = p_delivery_id
    AND claim_token = p_claim_token
    AND status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_store_order_email(uuid, text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_store_order_email(uuid, uuid, boolean, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_store_order_email(uuid, text, text, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_store_order_email(uuid, uuid, boolean, text, text, text)
  TO service_role;

ALTER TABLE public.store_order_status_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.store_order_status_email_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_order_status_email_log TO service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.claim_store_order_email(uuid,text,text,text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_store_order_email(uuid,text,text,text,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.finish_store_order_email(uuid,uuid,boolean,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.finish_store_order_email(uuid,uuid,boolean,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Los RPC internos de email quedaron expuestos al navegador';
  END IF;
END;
$$;

