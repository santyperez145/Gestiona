-- P0.3.2 — el tenant de la solicitud también forma parte del contrato.
--
-- La Function ya valida la membresía del orgId recibido. Este wrapper evita
-- que un caller server-side prepare por accidente un RMA de otra organización
-- antes de descubrir el desajuste.

CREATE OR REPLACE FUNCTION public.pago_reintegro_preparar(
  p_org_id            uuid,
  p_return_request_id uuid,
  p_requested_by      uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_request_org uuid;
BEGIN
  IF p_org_id IS NULL OR p_return_request_id IS NULL THEN
    RAISE EXCEPTION 'Falta la organización o la solicitud de devolución';
  END IF;

  SELECT org_id INTO v_request_org
  FROM public.return_requests
  WHERE id = p_return_request_id
  FOR UPDATE;

  IF v_request_org IS NULL THEN
    RAISE EXCEPTION 'Solicitud de devolución no encontrada';
  END IF;
  IF v_request_org <> p_org_id THEN
    RAISE EXCEPTION 'La solicitud de devolución no pertenece a la organización indicada'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN public.pago_reintegro_preparar(p_return_request_id, p_requested_by);
END;
$fn$;

REVOKE ALL ON FUNCTION public.pago_reintegro_preparar(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pago_reintegro_preparar(uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.pago_reintegro_preparar(uuid, uuid, uuid) IS
  'Valida el tenant del RMA antes de delegar la preparación idempotente del reintegro.';

DO $$
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.pago_reintegro_preparar(uuid,uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'El RPC de preparación de reintegro quedó ejecutable por authenticated';
  END IF;
END $$;
