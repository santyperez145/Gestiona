BEGIN;

-- Preserve retries of pre-release orders without inventing fiscal consent.
-- New orders still freeze the decision before sending anything to MP.
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
  ELSIF v_session.state <> 'preparing' OR v_session.provider_order_id IS NOT NULL THEN
    IF p_request_invoice THEN
      RAISE EXCEPTION 'Un cobro anterior no admite una solicitud fiscal retroactiva' USING ERRCODE = '23505';
    END IF;
    -- Old browser orders can be consulted/retried, but never opt in later.
    RETURN public.pos_qr_session_response(v_session.id) || jsonb_build_object('reused', true);
  ELSE
    UPDATE public.pos_qr_sessions SET invoice_requested = p_request_invoice,
      invoice_request_set_at = now() WHERE id = v_session.id;
  END IF;
  RETURN public.pos_qr_session_response(v_session.id)
    || jsonb_build_object('reused', COALESCE((v_result->>'reused')::boolean, false));
END;
$function$;
REVOKE ALL ON FUNCTION public.pos_qr_session_prepare_fiscal(uuid,jsonb,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_qr_session_prepare_fiscal(uuid,jsonb,uuid,boolean) TO authenticated;

COMMIT;
