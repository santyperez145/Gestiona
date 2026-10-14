-- Simulacro de 20261013000500 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. anon no puede leer ninguna de las 6 vistas
--   2. un usuario de Famatina ve sólo filas de su negocio en kardex_summary
--      y payment_operation_trace, y sigue viendo las suyas
--   3. un superadmin sigue viendo los ingresos de la plataforma
DO $$
DECLARE v text; v_user uuid; v_org uuid; v_admin uuid; n int; ajenas int;
BEGIN
  FOREACH v IN ARRAY ARRAY['kardex_summary','ecommerce_funnel','stock_a_reponer','payment_operation_trace','platform_revenue_monthly','audit_summary'] LOOP
    IF has_table_privilege('anon', 'public.' || v, 'SELECT') THEN RAISE EXCEPTION 'FALLA 1: anon lee %', v; END IF;
  END LOOP;

  SELECT o.id, m.user_id INTO v_org, v_user FROM public.organizations o
    JOIN public.memberships m ON m.org_id = o.id WHERE o.name ILIKE '%famatina%' LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) FILTER (WHERE org_id = v_org), count(*) FILTER (WHERE org_id <> v_org) INTO n, ajenas FROM public.kardex_summary;
  IF ajenas > 0 THEN RAISE EXCEPTION 'FALLA 2: Famatina ve % filas ajenas del kardex', ajenas; END IF;
  IF n = 0 THEN RAISE EXCEPTION 'FALLA 2: Famatina dejó de ver su propio kardex'; END IF;
  SELECT count(*) FILTER (WHERE org_id <> v_org) INTO ajenas FROM public.payment_operation_trace;
  IF ajenas > 0 THEN RAISE EXCEPTION 'FALLA 2: Famatina ve % pagos ajenos', ajenas; END IF;
  RESET ROLE;

  SELECT user_id INTO v_admin FROM public.platform_admins WHERE role = 'superadmin' LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.platform_revenue_monthly;
  RESET ROLE;
  IF n = 0 THEN RAISE EXCEPTION 'FALLA 3: el superadmin dejó de ver los ingresos'; END IF;
  RAISE EXCEPTION 'OK 1-3 (kardex propio de Famatina visible, ingresos visibles para superadmin)';
END $$;

ROLLBACK;
