-- Matriz reversible de 20261011001200 (experimentos de la tesis).
--   node scripts/db.mjs --file scripts/experimentos-tesis-matrix.sql
-- El admin de plataforma recibe las cinco mediciones; con una entrevista ZZ
-- que confirma y otra que no, E2 suma 2/1; un usuario común es rechazado.
-- Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_et (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_et TO authenticated;

DO $d$
DECLARE v_admin uuid; v_comun uuid; v_antes jsonb; v_r jsonb;
BEGIN
  SELECT id INTO v_admin FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT u.id INTO v_comun FROM auth.users u WHERE u.id <> v_admin AND NOT public.is_platform_admin(u.id) ORDER BY created_at LIMIT 1;
  INSERT INTO public.platform_admins (user_id) VALUES (v_admin) ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_antes := public.platform_experimentos_tesis();
  RESET ROLE;
  INSERT INTO public.entrevistas_e2 (puerta, comercio, herramientas, margen_sin_respuesta, created_by)
  VALUES ('catalogo_grande', 'ZZ uno', ARRAY['excel','tiendanube','contador'], true, v_admin),
         ('catalogo_grande', 'ZZ dos', ARRAY['excel', ' '], true, v_admin);
  SET LOCAL ROLE authenticated;
  v_r := public.platform_experimentos_tesis();
  RESET ROLE;
  INSERT INTO zz_et VALUES ('trae e1..e5', (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(v_r) k));
  INSERT INTO zz_et VALUES ('E2 suma 2 entrevistas y 1 confirma',
    ((v_r->'e2'->>'total')::int - (v_antes->'e2'->>'total')::int) || '/' || ((v_r->'e2'->>'confirman')::int - (v_antes->'e2'->>'confirman')::int));
  INSERT INTO zz_et VALUES ('valores de hoy', left(v_antes::text, 58));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.platform_experimentos_tesis();
    INSERT INTO zz_et VALUES ('usuario común', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_et VALUES ('usuario común', 'rechazado'); END;
  RESET ROLE;
END $d$;

SELECT * FROM zz_et;
ROLLBACK;
