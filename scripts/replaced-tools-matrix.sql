-- Matriz reversible de 20261010001800 (lo que reemplaza Nerqia).
--   node scripts/db.mjs --file scripts/replaced-tools-matrix.sql
-- Un dueño carga lo que paga y lee el uso; un vendedor lee pero no escribe;
-- alguien de otro comercio no lee. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE zz_reemplazo (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_reemplazo TO authenticated;

DO $d$
DECLARE
  v_owner uuid; v_vend uuid; v_ajeno uuid; v_org uuid; v_r jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  SELECT u.id INTO v_ajeno FROM auth.users u WHERE u.id NOT IN (v_owner, v_vend) ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ reemplazo', 'zz-reemplazo-' || substr(md5(random()::text), 1, 10), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_vend, 'vendedor')
    ON CONFLICT DO NOTHING;
  DELETE FROM public.memberships WHERE org_id = v_org AND user_id = v_ajeno;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.guardar_herramienta_reemplazada(v_org, 'commerce', '  Tiendanube ', 25000);
  PERFORM public.guardar_herramienta_reemplazada(v_org, 'finance', NULL, 18000.555);
  PERFORM public.guardar_herramienta_reemplazada(v_org, 'commerce', 'Tiendanube Plan B', 30000);
  v_r := public.uso_de_nerqia(v_org);
  INSERT INTO zz_reemplazo VALUES ('productos medidos (6)', jsonb_array_length(v_r->'productos')::text);
  INSERT INTO zz_reemplazo VALUES ('herramientas guardadas (2)', jsonb_array_length(v_r->'herramientas')::text);
  INSERT INTO zz_reemplazo SELECT 'upsert commerce (Tiendanube Plan B/30000.00)', (h->>'herramienta') || '/' || (h->>'monto_mensual_ars')
    FROM jsonb_array_elements(v_r->'herramientas') h WHERE h->>'producto' = 'commerce';
  INSERT INTO zz_reemplazo SELECT 'redondeo finance (18000.56)', h->>'monto_mensual_ars'
    FROM jsonb_array_elements(v_r->'herramientas') h WHERE h->>'producto' = 'finance';
  PERFORM public.guardar_herramienta_reemplazada(v_org, 'finance', 'x', NULL);
  INSERT INTO zz_reemplazo SELECT 'monto vacío borra (1)', count(*)::text FROM public.herramientas_reemplazadas WHERE org_id = v_org;
  BEGIN
    PERFORM public.guardar_herramienta_reemplazada(v_org, 'commerce', NULL, -1);
    INSERT INTO zz_reemplazo VALUES ('monto negativo', 'PASÓ (mal)');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO zz_reemplazo VALUES ('monto negativo', 'rechazado');
  END;
  BEGIN
    PERFORM public.guardar_herramienta_reemplazada(v_org, 'otro', NULL, 1);
    INSERT INTO zz_reemplazo VALUES ('producto desconocido', 'PASÓ (mal)');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO zz_reemplazo VALUES ('producto desconocido', 'rechazado');
  END;
  BEGIN
    INSERT INTO public.herramientas_reemplazadas (org_id, producto, monto_mensual_ars) VALUES (v_org, 'growth', 1);
    INSERT INTO zz_reemplazo VALUES ('insert directo del dueño', 'PASÓ (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_reemplazo VALUES ('insert directo del dueño', 'rechazado');
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_r := public.uso_de_nerqia(v_org);
  INSERT INTO zz_reemplazo VALUES ('vendedor lee (1)', jsonb_array_length(v_r->'herramientas')::text);
  BEGIN
    PERFORM public.guardar_herramienta_reemplazada(v_org, 'growth', NULL, 1000);
    INSERT INTO zz_reemplazo VALUES ('vendedor escribe', 'PASÓ (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_reemplazo VALUES ('vendedor escribe', 'rechazado');
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_r := public.uso_de_nerqia(v_org);
    INSERT INTO zz_reemplazo VALUES ('otro comercio lee el uso', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_reemplazo VALUES ('otro comercio lee el uso', 'rechazado');
  END;
  INSERT INTO zz_reemplazo SELECT 'otro comercio ve filas (0)', count(*)::text FROM public.herramientas_reemplazadas WHERE org_id = v_org;
  RESET ROLE;
END $d$;

SELECT * FROM zz_reemplazo;
ROLLBACK;
