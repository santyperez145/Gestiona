-- F0 / matriz de pagos — elimina la ambigüedad del RPC de reintegros.
--
-- La función histórica acepta (return_request_id, requested_by DEFAULT NULL) y
-- la guarda por tenant nació como (org_id, return_request_id,
-- requested_by DEFAULT NULL). Al delegar con dos UUID, ambas firmas eran
-- candidatas y PostgreSQL abortaba antes de contactar al proveedor.
--
-- El caller server-side siempre envía los tres campos. PostgreSQL no permite
-- quitar un default con CREATE OR REPLACE, por lo que se recrea sólo esta
-- firma; no hay datos asociados a una función y sus grants se restablecen abajo.

DROP FUNCTION IF EXISTS public.pago_reintegro_preparar(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.pago_reintegro_preparar(
  p_org_id            uuid,
  p_return_request_id uuid,
  p_requested_by      uuid
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
  'Valida tenant y delega al reintegro interno. Los tres argumentos son obligatorios para evitar sobrecargas ambiguas.';

DO $verify$
DECLARE
  v_defaults integer;
BEGIN
  SELECT pronargdefaults INTO v_defaults
  FROM pg_proc
  WHERE oid = 'public.pago_reintegro_preparar(uuid,uuid,uuid)'::regprocedure;

  IF v_defaults <> 0 THEN
    RAISE EXCEPTION 'El wrapper de reintegro todavía tiene % defaults', v_defaults;
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.pago_reintegro_preparar(uuid,uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'El wrapper de reintegro quedó ejecutable por authenticated';
  END IF;
END
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260821000056', 'refund_rpc_overload') ON CONFLICT DO NOTHING;
