-- Simulacro de 20261023000200 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Ninguna vista de public se puede escribir con anon o authenticated, y
--      ninguna tabla tiene TRUNCATE para ellos.
--   2. Las vistas se siguen leyendo y las tablas se siguen escribiendo con RLS.
--   3. Una vista definer escribible ya no deja escribir la tabla de abajo.
DO $$
DECLARE
  v_user uuid; v_org uuid; n int; v_ok text := '';
BEGIN
  -- 1
  SELECT count(*) INTO n
    FROM information_schema.role_table_grants g
    JOIN pg_class c ON c.relname = g.table_name
    JOIN pg_namespace s ON s.oid = c.relnamespace AND s.nspname = 'public'
   WHERE g.table_schema = 'public' AND c.relkind IN ('v', 'm')
     AND g.grantee IN ('anon', 'authenticated') AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  IF n <> 0 THEN RAISE EXCEPTION 'FALLA 1a: quedan % permisos de escritura sobre vistas', n; END IF;
  SELECT count(*) INTO n
    FROM information_schema.role_table_grants g
   WHERE g.table_schema = 'public' AND g.grantee IN ('anon', 'authenticated') AND g.privilege_type = 'TRUNCATE';
  IF n <> 0 THEN RAISE EXCEPTION 'FALLA 1b: quedan % TRUNCATE', n; END IF;
  v_ok := v_ok || '1 ';

  -- 2
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ vistas', 'zz-vl-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social)
  VALUES (v_org, '20123456786', 3, 'homologacion', 'responsable_inscripto', 'ZZ SRL') ON CONFLICT (org_id) DO NOTHING;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.afip_connection_status WHERE org_id = v_org;
  IF n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'FALLA 2a: el dueño no lee su estado de ARCA (%)', n; END IF;
  INSERT INTO public.customers (org_id, user_id, name) VALUES (v_org, v_user, 'ZZ Cliente');
  v_ok := v_ok || '2 ';

  -- 3
  BEGIN
    UPDATE public.afip_connection_status SET cuit = '20000000001' WHERE org_id = v_org;
    RESET ROLE;
    RAISE EXCEPTION 'FALLA 3: se escribió por la vista';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
