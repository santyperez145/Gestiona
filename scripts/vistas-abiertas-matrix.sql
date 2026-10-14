-- Simulacro de 20261013000700 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. No queda ninguna vista sin invoker, legible desde el navegador, sin
--      filtro por usuario y sin marca @publica/@revisada.
--   2. Famatina sigue viendo sus 2 filas de desvio_de_comisiones.
--   3. anon sigue viendo los planes contratables (página de precios).
DO $$
DECLARE v_n int; v_lista text; v_user uuid;
BEGIN
  SELECT count(*), string_agg(c.relname, ', ') INTO v_n, v_lista
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
     AND coalesce(array_to_string(c.reloptions, ','), '') NOT LIKE '%security_invoker=true%'
     AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'))
     AND pg_get_viewdef(c.oid) !~* '(auth\.uid|is_org_member|has_org_role|has_permission|is_platform_admin|has_platform_role|current_setting|user_org_ids)'
     AND coalesce(obj_description(c.oid, 'pg_class'), '') !~ '^@(publica|revisada):';
  IF v_n > 0 THEN RAISE EXCEPTION 'FALLA 1: % vistas abiertas sin marca: %', v_n, v_lista; END IF;

  SELECT m.user_id INTO v_user FROM public.organizations o JOIN public.memberships m ON m.org_id = o.id
   WHERE o.name ILIKE '%famatina%' LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.desvio_de_comisiones;
  RESET ROLE;
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALLA 2: Famatina ve % filas de desvio (esperaba 2)', v_n; END IF;

  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.planes_contratables;
  RESET ROLE;
  IF v_n = 0 THEN RAISE EXCEPTION 'FALLA 3: anon dejó de ver los planes'; END IF;
  RAISE EXCEPTION 'OK 1-3';
END $$;

ROLLBACK;
