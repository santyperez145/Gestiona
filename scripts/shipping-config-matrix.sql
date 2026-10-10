-- Matriz reversible del tarifario (20261010000200): un vendedor lee zonas y
-- tarifas pero no las borra; el dueño sí. Corre como los usuarios reales
-- (rol authenticated con claims) y revierte todo.
--
--   node scripts/db.mjs --file scripts/shipping-config-matrix.sql
--
-- 2026-10-10: antes del arreglo el vendedor borraba 1 tarifa y 1 zona; después, 0.
BEGIN;
CREATE TEMP TABLE zz_env (caso text, borradas int, ok_lectura boolean) ON COMMIT DROP;
GRANT ALL ON zz_env TO authenticated;
DO $d$
DECLARE v_owner uuid; v_vend uuid; v_org uuid; v_zona uuid; v_n int; v_lee boolean;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ envios', 'zz-envios-' || substr(md5(random()::text),1,10), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_vend, 'vendedor');
  INSERT INTO public.shipping_zones (org_id, name) VALUES (v_org, 'ZZ zona') RETURNING id INTO v_zona;
  INSERT INTO public.shipping_rates (org_id, zone_id) VALUES (v_org, v_zona);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT EXISTS (SELECT 1 FROM public.shipping_zones WHERE id = v_zona) INTO v_lee;
  DELETE FROM public.shipping_rates WHERE zone_id = v_zona; GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_env VALUES ('vendedor borra tarifas', v_n, v_lee);
  DELETE FROM public.shipping_zones WHERE id = v_zona; GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_env VALUES ('vendedor borra zona', v_n, v_lee);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.shipping_zones WHERE id = v_zona; GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO zz_env VALUES ('dueño borra zona', v_n, true);
  RESET ROLE;
END $d$;
SELECT * FROM zz_env;
ROLLBACK;
