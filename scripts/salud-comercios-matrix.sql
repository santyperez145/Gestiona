-- Matriz reversible de 20261010002900 (salud de comercios).
--   node scripts/db.mjs --file scripts/salud-comercios-matrix.sql
-- Un comercio ZZ con un producto bajo costo queda en rojo con ese motivo; al
-- corregir el precio y vender, sin tienda, queda en ámbar. Famatina aparece en
-- rojo. Un usuario común es rechazado. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_sc (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_sc TO authenticated;

DO $d$
DECLARE v_admin uuid; v_comun uuid; v_org uuid; v_r jsonb; v_zz jsonb; v_fam jsonb;
BEGIN
  SELECT id INTO v_admin FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT u.id INTO v_comun FROM auth.users u WHERE u.id <> v_admin AND NOT public.is_platform_admin(u.id) ORDER BY created_at LIMIT 1;
  INSERT INTO public.platform_admins (user_id) VALUES (v_admin) ON CONFLICT DO NOTHING;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ salud', 'zz-salud-' || substr(md5(random()::text), 1, 8), v_admin) RETURNING id INTO v_org;
  INSERT INTO public.products (org_id, user_id, name, cost_ars, cost_currency, sale_price_ars)
    VALUES (v_org, v_admin, 'ZZ disco', 776, 'ARS', 0.1);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_r := public.platform_salud_comercios();
  RESET ROLE;
  SELECT c INTO v_zz FROM jsonb_array_elements(v_r->'comercios') c WHERE c->>'org_id' = v_org::text;
  INSERT INTO zz_sc VALUES ('bajo costo: semáforo (rojo)', v_zz->>'semaforo');
  INSERT INTO zz_sc SELECT 'motivo y destino (bajo_costo /productos?margen=negative)', (m->>'id') || ' ' || (m->>'ir')
    FROM jsonb_array_elements(v_zz->'motivos') m WHERE m->>'nivel' = 'rojo';
  SELECT c INTO v_fam FROM jsonb_array_elements(v_r->'comercios') c WHERE c->>'nombre' = 'Ferreteria Famatina';
  INSERT INTO zz_sc VALUES ('Famatina (rojo)', v_fam->>'semaforo');

  UPDATE public.products SET sale_price_ars = 1500 WHERE org_id = v_org;
  INSERT INTO public.sale_transactions (org_id, occurred_at, source) VALUES (v_org, now() - interval '1 day', 'pos');
  SET LOCAL ROLE authenticated;
  v_r := public.platform_salud_comercios();
  RESET ROLE;
  SELECT c INTO v_zz FROM jsonb_array_elements(v_r->'comercios') c WHERE c->>'org_id' = v_org::text;
  INSERT INTO zz_sc VALUES ('precio corregido y con venta, sin tienda (ambar)', v_zz->>'semaforo');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_r := public.platform_salud_comercios();
    INSERT INTO zz_sc VALUES ('usuario común', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_sc VALUES ('usuario común', 'rechazado');
  END;
  RESET ROLE;
END $d$;

SELECT * FROM zz_sc;
ROLLBACK;
