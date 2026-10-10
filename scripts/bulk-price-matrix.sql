-- Matriz reversible de 20261010001700 (ajuste de precios en bloque).
--   node scripts/db.mjs --file scripts/bulk-price-matrix.sql
-- Un dueño real (rol authenticated con claims) previsualiza y aplica sobre una
-- organización ZZ; un vendedor sin permiso de productos es rechazado. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE zz_bloque (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_bloque TO authenticated;

DO $d$
DECLARE
  v_owner uuid; v_vend uuid; v_org uuid; v_prov uuid; v_r jsonb; v_n int;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ bloque', 'zz-bloque-' || substr(md5(random()::text), 1, 10), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_vend, 'vendedor');
  INSERT INTO public.suppliers (org_id, name) VALUES (v_org, 'ZZ proveedor') RETURNING id INTO v_prov;
  INSERT INTO public.products (org_id, user_id, name, brand, category, cost_ars, cost_currency, sale_price_ars, supplier_id)
  VALUES (v_org, v_owner, 'ZZ tornillo', 'ZZ marca', 'otros', 100, 'ARS', 180, v_prov),
         (v_org, v_owner, 'ZZ tuerca', 'ZZ marca', 'otros', 50, 'ARS', 95, v_prov),
         (v_org, v_owner, 'ZZ martillo', 'Otra', 'otros', 1000, 'ARS', 1500, NULL);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_r := public.ajustar_precios_en_bloque(v_org, 10, 'costo_y_precio', NULL, NULL, v_prov, 10, false);
  INSERT INTO zz_bloque VALUES ('vista previa: afectados (2)', v_r->>'afectados');
  INSERT INTO zz_bloque VALUES ('vista previa: no aplica', v_r->>'aplicado');
  INSERT INTO zz_bloque SELECT 'vista previa no toca: precio tornillo (180)', sale_price_ars::text FROM public.products WHERE org_id = v_org AND name = 'ZZ tornillo';
  v_r := public.ajustar_precios_en_bloque(v_org, 10, 'costo_y_precio', NULL, NULL, v_prov, 10, true);
  INSERT INTO zz_bloque SELECT 'aplicado: tornillo precio/costo/ganancia (200/110/90)',
    sale_price_ars::text || '/' || cost_ars::text || '/' || profit_per_unit_ars::text FROM public.products WHERE org_id = v_org AND name = 'ZZ tornillo';
  INSERT INTO zz_bloque SELECT 'otro proveedor intacto: martillo (1500)', sale_price_ars::text FROM public.products WHERE org_id = v_org AND name = 'ZZ martillo';
  v_r := public.ajustar_precios_en_bloque(v_org, -5, 'precio', NULL, 'Otra', NULL, 1, true);
  INSERT INTO zz_bloque SELECT 'por marca -5%: martillo (1425)', sale_price_ars::text FROM public.products WHERE org_id = v_org AND name = 'ZZ martillo';
  RESET ROLE;

  SELECT count(*) INTO v_n FROM public.price_history ph JOIN public.products p ON p.id = ph.product_id WHERE p.org_id = v_org;
  INSERT INTO zz_bloque VALUES ('historial de precios registrado (>0)', v_n::text);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    v_r := public.ajustar_precios_en_bloque(v_org, 50, 'precio', NULL, NULL, NULL, 1, true);
    INSERT INTO zz_bloque VALUES ('vendedor sin permiso', 'PUDO (mal) ' || (v_r->>'afectados'));
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_bloque VALUES ('vendedor sin permiso', 'rechazado');
  END;
  RESET ROLE;
END $d$;

SELECT * FROM zz_bloque;
ROLLBACK;
