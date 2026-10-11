-- Matriz reversible de 20261010002500 (el ajuste en bloque avisa bajo costo).
--   node scripts/db.mjs --file scripts/bulk-price-below-cost-matrix.sql
-- Subir sólo el costo deja un producto bajo costo y la vista previa lo dice
-- sin tocar nada; subir costo y precio juntos no. Sin costo no cuenta.
-- Organización ZZ; todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE zz_bc (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_bc TO authenticated;

DO $d$
DECLARE v_owner uuid; v_org uuid; v_r jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ bajo costo', 'zz-bajo-costo-' || substr(md5(random()::text), 1, 10), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, brand, category, cost_ars, cost_currency, sale_price_ars)
  VALUES (v_org, v_owner, 'ZZ justo', 'ZZ', 'otros', 100, 'ARS', 105),
         (v_org, v_owner, 'ZZ holgado', 'ZZ', 'otros', 100, 'ARS', 200),
         (v_org, v_owner, 'ZZ sin costo', 'ZZ', 'otros', 0, 'ARS', 50);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_r := public.ajustar_precios_en_bloque(v_org, 10, 'costo', NULL, 'ZZ', NULL, 1, false);
  INSERT INTO zz_bc VALUES ('sólo costo +10%: quedan bajo costo (1)', v_r->>'bajo_costo_despues');
  INSERT INTO zz_bc VALUES ('cuál (ZZ justo)', v_r->'bajo_costo_muestra'->>0);
  INSERT INTO zz_bc SELECT 'la vista previa no tocó el costo (100.00)', cost_ars::text FROM public.products WHERE org_id = v_org AND name = 'ZZ justo';
  v_r := public.ajustar_precios_en_bloque(v_org, 10, 'costo_y_precio', NULL, 'ZZ', NULL, 1, false);
  INSERT INTO zz_bc VALUES ('costo y precio +10%: ninguno (0)', v_r->>'bajo_costo_despues');
  v_r := public.ajustar_precios_en_bloque(v_org, 10, 'costo', NULL, 'ZZ', NULL, 1, true);
  INSERT INTO zz_bc VALUES ('al aplicar también lo informa (1/true)', (v_r->>'bajo_costo_despues') || '/' || (v_r->>'aplicado'));
  RESET ROLE;
END $d$;

SELECT * FROM zz_bc;
ROLLBACK;
