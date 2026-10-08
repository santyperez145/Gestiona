-- Guard the existing transactional finalizer, rather than invent another sale
-- or stock authority. Only the guard's owner can invoke the inner function.
BEGIN;

DO $migration$
BEGIN
  IF to_regprocedure('public.pos_qr_apply_provider_inner(uuid,text,text,text,text,numeric,numeric,numeric,jsonb)') IS NULL THEN
    ALTER FUNCTION public.pos_qr_apply_provider(uuid,text,text,text,text,numeric,numeric,numeric,jsonb)
      RENAME TO pos_qr_apply_provider_inner;
  END IF;
END;
$migration$;

REVOKE ALL ON FUNCTION public.pos_qr_apply_provider_inner(uuid,text,text,text,text,numeric,numeric,numeric,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pos_qr_apply_provider(
  p_session_id uuid, p_provider_order_id text, p_status text,
  p_status_detail text DEFAULT NULL, p_payment_id text DEFAULT NULL,
  p_gross numeric DEFAULT NULL, p_net numeric DEFAULT NULL,
  p_fee numeric DEFAULT NULL, p_raw jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_session public.pos_qr_sessions;
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_merchant text;
  v_live boolean;
  v_reason text;
  v_key text;
BEGIN
  SELECT * INTO v_session FROM public.pos_qr_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'Sesion QR inexistente'; END IF;
  IF v_session.provider_order_id IS DISTINCT FROM p_provider_order_id OR p_provider_order_id IS NULL THEN
    RAISE EXCEPTION 'La order no corresponde a la sesion QR';
  END IF;

  -- An older provider snapshot must never resurrect a refund or downgrade a
  -- completed sale. Locking spans validation and the original finalizer.
  IF v_session.state = 'refunded'
    OR (v_session.state = 'completed' AND v_status NOT IN ('processed','refunded')) THEN
    RETURN public.pos_qr_session_response(p_session_id) || jsonb_build_object('ignored_stale', true);
  END IF;

  IF v_status = 'processed' THEN
    SELECT external_id, live_mode INTO v_merchant, v_live
      FROM public.payment_connections
      WHERE org_id = v_session.org_id AND provider = 'mercadopago';

    IF p_raw->>'provider_evidence_version' IS DISTINCT FROM '1'
      OR p_raw->>'source' IS DISTINCT FROM 'mercadopago_orders_api' THEN
      v_reason := 'Falta evidencia verificable del proveedor';
    ELSIF p_raw->>'provider_order_type' IS DISTINCT FROM 'qr'
      OR p_raw->>'provider_currency' IS DISTINCT FROM v_session.currency THEN
      v_reason := 'El tipo de cobro o la moneda no coincide';
    ELSIF p_raw->>'external_reference' IS DISTINCT FROM 'posqr_' || replace(p_session_id::text, '-', '') THEN
      v_reason := 'La referencia no corresponde a esta venta';
    ELSIF NULLIF(v_merchant, '') IS NULL
      OR p_raw->>'provider_merchant_id' IS DISTINCT FROM v_merchant THEN
      v_reason := 'La cuenta receptora no coincide con el comercio conectado';
    ELSIF p_raw ? 'provider_live_mode'
      AND p_raw->>'provider_live_mode' IS DISTINCT FROM COALESCE(v_live, true)::text THEN
      v_reason := 'El ambiente del cobro no coincide con la conexion';
    ELSIF p_raw->>'payment_count' IS DISTINCT FROM '1'
      OR NULLIF(btrim(p_payment_id), '') IS NULL
      OR p_raw->>'payment_status' IS DISTINCT FROM 'processed'
      OR p_raw->>'payment_status_detail' IS DISTINCT FROM 'accredited'
      OR COALESCE(p_status_detail, '') NOT IN ('processed','accredited') THEN
      v_reason := 'El pago no esta acreditado de forma completa';
    ELSE
      FOREACH v_key IN ARRAY ARRAY['order_total_amount','order_paid_amount','payment_amount','payment_paid_amount'] LOOP
        IF COALESCE(p_raw->>v_key, '') !~ '^[0-9]{1,16}(\.[0-9]{1,2})?$' THEN
          v_reason := 'El proveedor no informo todos los importes acreditados';
          EXIT;
        ELSIF (p_raw->>v_key)::numeric <> v_session.amount THEN
          v_reason := 'El importe acreditado no coincide con el total de la venta';
          EXIT;
        END IF;
      END LOOP;
      IF p_gross IS DISTINCT FROM v_session.amount THEN
        v_reason := 'El importe recibido no coincide con el total de la venta';
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      -- Preserve completed evidence and money. Before closing, keep the
      -- reservation for review; never invite the cashier to collect twice.
      IF v_session.sale_transaction_id IS NULL THEN
        UPDATE public.pos_qr_sessions SET state = 'manual_review',
          failure_reason = v_reason, updated_at = now() WHERE id = p_session_id;
      END IF;
      RETURN public.pos_qr_session_response(p_session_id)
        || jsonb_build_object('evidence_rejected', true, 'reconciliation_warning', v_reason);
    END IF;
  END IF;

  RETURN public.pos_qr_apply_provider_inner(p_session_id, p_provider_order_id,
    p_status, p_status_detail, p_payment_id, p_gross, p_net, p_fee, p_raw);
END;
$function$;

REVOKE ALL ON FUNCTION public.pos_qr_apply_provider(uuid,text,text,text,text,numeric,numeric,numeric,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_qr_apply_provider(uuid,text,text,text,text,numeric,numeric,numeric,jsonb)
  TO service_role;

DO $guard$
BEGIN
  ASSERT NOT has_function_privilege('authenticated',
    'public.pos_qr_apply_provider(uuid,text,text,text,text,numeric,numeric,numeric,jsonb)', 'EXECUTE');
  ASSERT NOT has_function_privilege('service_role',
    'public.pos_qr_apply_provider_inner(uuid,text,text,text,text,numeric,numeric,numeric,jsonb)', 'EXECUTE');
END;
$guard$;

COMMIT;
