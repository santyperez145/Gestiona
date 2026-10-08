BEGIN;

ALTER TABLE public.pos_qr_sessions
  ADD COLUMN IF NOT EXISTS invoice_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invoice_request_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS invoice_preparation_error text;

-- Delegate prices, reservations and idempotency to the existing POS authority.
CREATE OR REPLACE FUNCTION public.pos_qr_session_prepare_fiscal(
  p_org_id uuid, p_sales jsonb, p_client_key uuid, p_request_invoice boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
  v_session public.pos_qr_sessions;
BEGIN
  IF p_request_invoice IS NULL THEN RAISE EXCEPTION 'La solicitud fiscal no es valida'; END IF;
  IF p_request_invoice THEN
    PERFORM public.exigir_permiso(p_org_id, 'invoices', 'edit', 'solicitar factura del POS');
  END IF;
  v_result := public.pos_qr_session_prepare(p_org_id, p_sales, p_client_key);
  SELECT * INTO v_session FROM public.pos_qr_sessions
    WHERE id = (v_result->>'session_id')::uuid FOR UPDATE;
  IF v_session.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'El cobro pertenece a otro cajero' USING ERRCODE = '42501';
  END IF;
  IF v_session.invoice_request_set_at IS NOT NULL THEN
    IF v_session.invoice_requested IS DISTINCT FROM p_request_invoice THEN
      RAISE EXCEPTION 'La clave del cobro ya tiene otra solicitud fiscal' USING ERRCODE = '23505';
    END IF;
  ELSE
    IF v_session.state <> 'preparing' OR v_session.provider_order_id IS NOT NULL THEN
      RAISE EXCEPTION 'La solicitud fiscal se fija antes de enviar el cobro al proveedor';
    END IF;
    UPDATE public.pos_qr_sessions SET invoice_requested = p_request_invoice,
      invoice_request_set_at = now() WHERE id = v_session.id;
  END IF;
  RETURN public.pos_qr_session_response(v_session.id)
    || jsonb_build_object('reused', COALESCE((v_result->>'reused')::boolean, false));
END;
$function$;
REVOKE ALL ON FUNCTION public.pos_qr_session_prepare_fiscal(uuid,jsonb,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_qr_session_prepare_fiscal(uuid,jsonb,uuid,boolean) TO authenticated;

-- Only a server-confirmed transition can prepare an opted-in fiscal document.
-- ARCA delivery/retries remain in factura.creada -> the canonical outbox.
CREATE OR REPLACE FUNCTION public.trg_pos_qr_prepare_fiscal_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_claims text := current_setting('request.jwt.claims', true);
  v_result jsonb;
  v_invoice uuid;
  v_error text;
BEGIN
  IF NEW.sale_transaction_id IS NULL OR NEW.invoice_id IS NOT NULL THEN RETURN NULL; END IF;
  BEGIN
    -- Revalidate the original cashier's current membership/fiscal permission.
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', NEW.created_by, 'role', 'authenticated')::text, true);
    v_result := public.facturar_venta_pos(NEW.org_id, NEW.sale_transaction_id);
    IF v_result->>'ok' = 'true' AND NULLIF(v_result->>'invoice_id', '') IS NOT NULL THEN
      v_invoice := (v_result->>'invoice_id')::uuid;
    ELSE
      v_error := 'configuration_required';
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN v_error := 'permission_required';
    WHEN OTHERS THEN v_error := 'preparation_failed';
  END;
  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);
  -- Failure is durable and visible, but cannot undo money, ticket or stock.
  UPDATE public.pos_qr_sessions SET invoice_id = v_invoice,
    invoice_preparation_error = v_error WHERE id = NEW.id;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_pos_qr_prepare_fiscal_invoice() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS pos_qr_prepare_fiscal_invoice ON public.pos_qr_sessions;
CREATE TRIGGER pos_qr_prepare_fiscal_invoice AFTER UPDATE OF state ON public.pos_qr_sessions
  FOR EACH ROW WHEN (NEW.state = 'completed' AND OLD.state IS DISTINCT FROM NEW.state AND NEW.invoice_requested)
  EXECUTE FUNCTION public.trg_pos_qr_prepare_fiscal_invoice();

CREATE OR REPLACE FUNCTION public.pos_qr_session_response(p_session_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'session_id', session.id, 'org_id', session.org_id, 'state', session.state,
    'amount', session.amount, 'platform_fee', session.platform_fee, 'currency', session.currency,
    'expires_at', session.expires_at, 'provider_order_id', session.provider_order_id,
    'provider_status', session.provider_status, 'provider_status_detail', session.provider_status_detail,
    'provider_payment_id', session.provider_payment_id, 'qr_data', session.qr_data,
    'sale_transaction_id', session.sale_transaction_id, 'failure_reason', session.failure_reason,
    'payment_attempt_id', session.payment_attempt_id, 'invoice_requested', session.invoice_requested,
    'invoice_preparation_error', session.invoice_preparation_error,
    'invoice', (
      SELECT jsonb_build_object('ok', true, 'invoice_id', i.id, 'number', i.number,
        'cae', i.cae, 'afip_status', i.afip_status, 'autorizar', i.cae IS NULL)
      FROM public.invoices i WHERE i.org_id = session.org_id
        AND i.sale_transaction_id = session.sale_transaction_id
        AND i.nota_credito_de IS NULL ORDER BY i.created_at, i.id LIMIT 1
    ),
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'product_id', line.value->>'product_id', 'title', line.value->>'product_name',
        'unit_price', line.value->>'unit_price_ars', 'quantity', line.value->>'quantity'
      )), '[]'::jsonb) FROM jsonb_array_elements(session.sales_payload) line(value)
    )
  ) FROM public.pos_qr_sessions session WHERE session.id = p_session_id
    AND (public.is_org_member(session.org_id, auth.uid()) OR auth.role() = 'service_role');
$function$;
REVOKE ALL ON FUNCTION public.pos_qr_session_response(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_qr_session_response(uuid) TO authenticated, service_role;

DO $guard$
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.pos_qr_session_prepare_fiscal(uuid,jsonb,uuid,boolean)', 'EXECUTE');
  ASSERT NOT has_function_privilege('service_role', 'public.trg_pos_qr_prepare_fiscal_invoice()', 'EXECUTE');
END;
$guard$;
COMMIT;
