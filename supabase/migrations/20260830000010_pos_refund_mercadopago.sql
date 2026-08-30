-- POS — reintegro real de Mercado Pago para una devolución de mostrador.
--
-- La devolución transaccional ya dejaba el dinero digital como obligación
-- pendiente. Este slice conecta esa obligación con el cobro QR original sin
-- permitir que el navegador elija monto, credencial, endpoint o estado.
--
-- La API del proveedor queda fuera de la transacción PostgreSQL. Por eso:
--   * prepare bloquea devolución y cobro, deriva IDs/monto y fija una clave;
--   * observe conserva timeouts/rechazos sin esconder la deuda al cliente;
--   * sólo sales_return_refund_complete, ejecutada como service_role después
--     de leer al proveedor, cancela el pasivo y marca el reintegro completo.

ALTER TABLE public.sales_return_refunds
  ADD COLUMN IF NOT EXISTS provider_refund_id text,
  ADD COLUMN IF NOT EXISTS provider_idempotency_key text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_last_attempt_at timestamptz;

ALTER TABLE public.sales_return_refunds
  DROP CONSTRAINT IF EXISTS sales_return_refunds_provider_attempt_count_check;
ALTER TABLE public.sales_return_refunds
  ADD CONSTRAINT sales_return_refunds_provider_attempt_count_check
  CHECK (provider_attempt_count >= 0);

-- Un rechazo de red/proveedor no elimina la obligación al cliente. `failed`
-- hacía desaparecer el importe de pending_amount y permitía reservar de nuevo
-- ese mismo saldo. Desde acá sólo existe pendiente o efectivamente completado.
UPDATE public.sales_return_refunds
SET status = 'pending_external'
WHERE status = 'failed';
ALTER TABLE public.sales_return_refunds
  DROP CONSTRAINT IF EXISTS sales_return_refunds_status_check;
ALTER TABLE public.sales_return_refunds
  ADD CONSTRAINT sales_return_refunds_status_check
  CHECK (status IN ('completed', 'pending_external'));

CREATE UNIQUE INDEX IF NOT EXISTS sales_return_refund_provider_key_uidx
  ON public.sales_return_refunds (org_id, provider_idempotency_key)
  WHERE provider_idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_return_refund_provider_pending_idx
  ON public.sales_return_refunds (org_id, provider, provider_last_attempt_at)
  WHERE execution_mode = 'mercadopago_api' AND status = 'pending_external';

COMMENT ON COLUMN public.sales_return_refunds.provider_idempotency_key IS
  'Clave estable enviada al proveedor en todos los retries de esta misma parte del reintegro.';
COMMENT ON COLUMN public.sales_return_refunds.provider_status IS
  'Último estado saneado observado en Mercado Pago; no reemplaza status, que expresa la obligación local.';
COMMENT ON COLUMN public.sales_return_refunds.failure_reason IS
  'Último bloqueo operativo. El reintegro continúa pending_external hasta evidencia positiva.';

CREATE OR REPLACE FUNCTION public.pos_mp_refund_prepare(
  p_org_id uuid,
  p_refund_id uuid,
  p_requested_by uuid,
  p_increment_attempt boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_refund public.sales_return_refunds;
  v_payment public.payment_transactions;
  v_other_completed numeric := 0;
  v_order_id text;
  v_payment_id text;
  v_api_mode text;
  v_is_total boolean := false;
BEGIN
  IF p_org_id IS NULL OR p_refund_id IS NULL OR p_requested_by IS NULL THEN
    RAISE EXCEPTION 'Faltan organización, reintegro o actor';
  END IF;
  IF NOT public.is_org_member(p_org_id, p_requested_by) THEN
    RAISE EXCEPTION 'El actor no pertenece a la organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_refund
  FROM public.sales_return_refunds refund
  WHERE refund.id = p_refund_id AND refund.org_id = p_org_id
  FOR UPDATE;
  IF v_refund.id IS NULL THEN RAISE EXCEPTION 'El reintegro POS no existe'; END IF;
  IF v_refund.provider <> 'mercadopago'
     OR v_refund.execution_mode <> 'mercadopago_api' THEN
    RAISE EXCEPTION 'Esta parte no se ejecuta por la API de Mercado Pago';
  END IF;
  IF v_refund.status NOT IN ('pending_external', 'completed') THEN
    RAISE EXCEPTION 'El reintegro tiene un estado local inválido: %', v_refund.status;
  END IF;
  IF v_refund.payment_transaction_id IS NULL THEN
    RAISE EXCEPTION 'El reintegro no conserva el cobro original';
  END IF;

  SELECT * INTO v_payment
  FROM public.payment_transactions payment
  WHERE payment.id = v_refund.payment_transaction_id
    AND payment.org_id = p_org_id
    AND payment.source = 'pos'
    AND payment.provider = 'mercadopago'
  FOR UPDATE;
  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'El cobro de Mercado Pago no pertenece a este ticket';
  END IF;
  IF v_payment.gross_amount <= 0 OR v_refund.amount > v_payment.gross_amount + 0.01 THEN
    RAISE EXCEPTION 'El importe del reintegro no coincide con el cobro original';
  END IF;

  v_order_id := NULLIF(btrim(v_payment.raw->>'provider_order_id'), '');
  v_payment_id := COALESCE(
    NULLIF(btrim(v_payment.raw->>'provider_payment_id'), ''),
    CASE
      WHEN v_order_id IS NULL OR NULLIF(btrim(v_payment.external_id), '') IS DISTINCT FROM v_order_id
        THEN NULLIF(btrim(v_payment.external_id), '')
      ELSE NULL
    END
  );
  v_api_mode := CASE WHEN v_order_id IS NOT NULL THEN 'orders' ELSE 'payments' END;
  IF v_api_mode = 'payments' AND v_payment_id IS NULL THEN
    RAISE EXCEPTION 'El cobro no conserva el payment_id requerido por Mercado Pago';
  END IF;

  SELECT round(COALESCE(sum(other.amount), 0), 2)
    INTO v_other_completed
  FROM public.sales_return_refunds other
  WHERE other.payment_transaction_id = v_payment.id
    AND other.id <> v_refund.id
    AND other.status = 'completed';

  IF v_refund.amount > round(v_payment.gross_amount - v_other_completed, 2) + 0.01 THEN
    RAISE EXCEPTION 'El reintegro supera el saldo confirmado del proveedor';
  END IF;
  v_is_total := v_other_completed = 0
    AND abs(v_refund.amount - v_payment.gross_amount) <= 0.01;
  IF v_api_mode = 'orders' AND NOT v_is_total AND v_payment_id IS NULL THEN
    RAISE EXCEPTION 'El reintegro parcial necesita el transaction_id de Mercado Pago';
  END IF;

  UPDATE public.sales_return_refunds
  SET provider_idempotency_key = COALESCE(
        provider_idempotency_key,
        'pos-refund:' || id::text
      ),
      provider_attempt_count = provider_attempt_count
        + CASE WHEN COALESCE(p_increment_attempt, false) THEN 1 ELSE 0 END,
      provider_requested_by = p_requested_by,
      provider_requested_at = COALESCE(provider_requested_at, now()),
      provider_last_attempt_at = now(),
      failure_reason = CASE
        WHEN COALESCE(p_increment_attempt, false) THEN NULL
        ELSE failure_reason
      END,
      updated_at = now()
  WHERE id = v_refund.id
  RETURNING * INTO v_refund;

  RETURN jsonb_build_object(
    'ok', true,
    'already_completed', v_refund.status = 'completed',
    'org_id', v_refund.org_id,
    'refund_id', v_refund.id,
    'return_transaction_id', v_refund.return_transaction_id,
    'payment_transaction_id', v_payment.id,
    'payment_status', v_payment.status,
    'amount', v_refund.amount,
    'gross_amount', v_payment.gross_amount,
    'currency', v_payment.currency,
    'client_key', v_refund.provider_idempotency_key,
    'api_mode', v_api_mode,
    'provider_order_id', v_order_id,
    'provider_payment_id', v_payment_id,
    'provider_refund_id', v_refund.provider_refund_id,
    'is_total', v_is_total,
    'attempt_count', v_refund.provider_attempt_count
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.pos_mp_refund_observe(
  p_refund_id uuid,
  p_provider_status text,
  p_external_refund_id text,
  p_failure_reason text,
  p_raw jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_refund public.sales_return_refunds;
BEGIN
  SELECT * INTO v_refund
  FROM public.sales_return_refunds refund
  WHERE refund.id = p_refund_id
  FOR UPDATE;
  IF v_refund.id IS NULL THEN RAISE EXCEPTION 'El reintegro POS no existe'; END IF;
  IF v_refund.provider <> 'mercadopago'
     OR v_refund.execution_mode <> 'mercadopago_api' THEN
    RAISE EXCEPTION 'Esta parte no pertenece a Mercado Pago';
  END IF;

  IF v_refund.status = 'completed' THEN
    RETURN jsonb_build_object(
      'ok', true, 'reused', true, 'status', 'completed',
      'refund_id', v_refund.id
    );
  END IF;

  UPDATE public.sales_return_refunds
  SET provider_status = NULLIF(left(btrim(COALESCE(p_provider_status, '')), 80), ''),
      provider_refund_id = COALESCE(
        NULLIF(left(btrim(COALESCE(p_external_refund_id, '')), 180), ''),
        provider_refund_id
      ),
      failure_reason = NULLIF(left(btrim(COALESCE(p_failure_reason, '')), 500), ''),
      raw = CASE WHEN p_raw IS NULL THEN raw ELSE p_raw END,
      provider_last_attempt_at = now(),
      updated_at = now()
  WHERE id = v_refund.id
  RETURNING * INTO v_refund;

  RETURN jsonb_build_object(
    'ok', true,
    'reused', false,
    'status', v_refund.status,
    'refund_id', v_refund.id,
    'provider_status', v_refund.provider_status,
    'provider_refund_id', v_refund.provider_refund_id
  );
END
$function$;

REVOKE ALL ON FUNCTION public.pos_mp_refund_prepare(uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_mp_refund_observe(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_mp_refund_prepare(uuid, uuid, uuid, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_mp_refund_observe(uuid, text, text, text, jsonb)
  TO service_role;

DO $guards$
BEGIN
  IF has_function_privilege(
       'authenticated',
       'public.pos_mp_refund_prepare(uuid,uuid,uuid,boolean)',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated',
       'public.pos_mp_refund_observe(uuid,text,text,text,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'authenticated puede fabricar el estado del refund Mercado Pago';
  END IF;
  IF has_table_privilege('authenticated', 'public.sales_return_refunds', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated puede editar reintegros sin la autoridad server-side';
  END IF;
END
$guards$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260830000010', 'pos_refund_mercadopago')
ON CONFLICT DO NOTHING;
