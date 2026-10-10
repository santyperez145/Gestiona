-- Matriz reversible de 20261010001900 (productos Nerqia por comercio).
--   node scripts/db.mjs --file scripts/products-per-org-matrix.sql
-- Un administrador de plataforma ve el comercio ZZ con sus productos y lo que
-- cargó; un usuario sin rol de plataforma no ve filas; nadie llama directo las
-- funciones internas sin ser del comercio; el dueño sigue leyendo su uso en Mi plan. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE zz_por_comercio (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_por_comercio TO authenticated;

DO $d$
DECLARE
  v_admin uuid; v_comun uuid; v_org uuid; v_r jsonb; v_n int;
BEGIN
  SELECT u.id INTO v_admin FROM auth.users u ORDER BY created_at LIMIT 1;
  SELECT u.id INTO v_comun FROM auth.users u
   WHERE u.id <> v_admin AND NOT public.is_platform_admin(u.id) ORDER BY created_at LIMIT 1;
  INSERT INTO public.platform_admins (user_id) VALUES (v_admin) ON CONFLICT DO NOTHING;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ por comercio', 'zz-por-comercio-' || substr(md5(random()::text), 1, 10), v_admin) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_admin, 'owner')
    ON CONFLICT DO NOTHING;
  DELETE FROM public.memberships WHERE org_id = v_org AND user_id = v_comun;
  INSERT INTO public.herramientas_reemplazadas (org_id, producto, herramienta, monto_mensual_ars)
    VALUES (v_org, 'commerce', 'Tiendanube', 25000), (v_org, 'finance', NULL, 18000), (v_org, 'growth', NULL, 0);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO zz_por_comercio SELECT 'admin ve ZZ: paga/cargadas/en uso (43000.00/2/0)',
    paga_hoy_ars::text || '/' || herramientas_cargadas::text || '/' || productos_en_uso::text
    FROM public.platform_org_productos_nerqia WHERE org_id = v_org;
  INSERT INTO zz_por_comercio SELECT 'admin ve 6 productos por comercio (6)', jsonb_array_length(productos)::text
    FROM public.platform_org_productos_nerqia WHERE org_id = v_org;
  v_r := public.uso_de_nerqia(v_org);
  INSERT INTO zz_por_comercio VALUES ('Mi plan sigue: productos/herramientas (6/3)',
    jsonb_array_length(v_r->'productos')::text || '/' || jsonb_array_length(v_r->'herramientas')::text);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.platform_org_productos_nerqia;
  INSERT INTO zz_por_comercio VALUES ('usuario común no ve filas (0)', v_n::text);
  BEGIN
    v_r := public._senales_uso_nerqia(v_org);
    INSERT INTO zz_por_comercio VALUES ('función interna sin ser del comercio', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_por_comercio VALUES ('función interna sin ser del comercio', 'rechazado');
  END;
  BEGIN
    v_r := public._herramientas_reemplazadas_json(v_org);
    INSERT INTO zz_por_comercio VALUES ('montos de otro comercio', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_por_comercio VALUES ('montos de otro comercio', 'rechazado');
  END;
  RESET ROLE;
END $d$;

SELECT * FROM zz_por_comercio;
ROLLBACK;
