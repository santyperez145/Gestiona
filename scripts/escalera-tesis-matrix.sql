-- Matriz reversible de 20261010002800 (escalera de la tesis).
--   node scripts/db.mjs --file scripts/escalera-tesis-matrix.sql
-- Un administrador de plataforma lee la escalera; un comercio ZZ con una
-- venta de caja en cada una de las últimas 4 semanas cuenta como «vendiendo
-- todas las semanas»; un usuario común es rechazado. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_es (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_es TO authenticated;

DO $d$
DECLARE v_admin uuid; v_comun uuid; v_org uuid; v_r jsonb; v_antes jsonb; v_zz jsonb; i int;
BEGIN
  SELECT id INTO v_admin FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT u.id INTO v_comun FROM auth.users u WHERE u.id <> v_admin AND NOT public.is_platform_admin(u.id) ORDER BY created_at LIMIT 1;
  INSERT INTO public.platform_admins (user_id) VALUES (v_admin) ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_antes := public.platform_escalera_tesis();

  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ semanal', 'zz-semanal-' || substr(md5(random()::text), 1, 8), v_admin) RETURNING id INTO v_org;
  FOR i IN 0..3 LOOP
    INSERT INTO public.sale_transactions (org_id, occurred_at, source)
      VALUES (v_org, now() - make_interval(days => i * 7 + 1), 'pos');
  END LOOP;

  SET LOCAL ROLE authenticated;
  v_r := public.platform_escalera_tesis();
  RESET ROLE;
  SELECT c INTO v_zz FROM jsonb_array_elements(v_r->'comercios') c WHERE c->>'org_id' = v_org::text;
  INSERT INTO zz_es VALUES ('ZZ vende todas las semanas (true)', v_zz->>'semanal');
  INSERT INTO zz_es VALUES ('ZZ semanas ([1, 1, 1, 1, 0, 0, 0, 0])', v_zz->>'semanas');
  INSERT INTO zz_es VALUES ('suma uno al escalón semanal (+1)',
    '+' || ((v_r->>'vendiendo_todas_las_semanas')::int - (v_antes->>'vendiendo_todas_las_semanas')::int));
  INSERT INTO zz_es VALUES ('y uno a activos (+1)',
    '+' || ((v_r->>'comercios_activos')::int - (v_antes->>'comercios_activos')::int));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_r := public.platform_escalera_tesis();
    INSERT INTO zz_es VALUES ('usuario común', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_es VALUES ('usuario común', 'rechazado');
  END;
  RESET ROLE;
END $d$;

SELECT * FROM zz_es;
ROLLBACK;
