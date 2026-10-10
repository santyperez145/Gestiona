-- Matriz reversible de 20261010002000 (filas repetidas en la importación).
--   node scripts/db.mjs --file scripts/import-duplicates-matrix.sql
-- Un archivo trae el mismo artículo dos veces (con código y sin código, mismo
-- nombre): el lote termina, crea uno solo y avisa la repetida. Un producto que
-- apareció por fuera después de validar sigue frenando, con su nombre.
-- Organización ZZ; todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE zz_rep (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_rep TO authenticated;

DO $d$
DECLARE
  v_owner uuid; v_org uuid; v_r jsonb; v_b uuid;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ repetidas', 'zz-repetidas-' || substr(md5(random()::text), 1, 10), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_r := public.stage_product_import(v_org, 'zz.xlsx', 'xlsx', jsonb_build_array(
    jsonb_build_object('name', 'ZZ Linga', 'sku', 'ZZ-LIN', 'sale_price_ars', 100, 'cost_ars', 50),
    jsonb_build_object('name', 'ZZ Linga', 'barcode', 'ZZ-LIN', 'sale_price_ars', 100, 'cost_ars', 50),
    jsonb_build_object('name', 'ZZ Otro', 'sale_price_ars', 10, 'cost_ars', 5)));
  v_b := COALESCE(v_r->>'batch_id', v_r->>'id')::uuid;
  INSERT INTO zz_rep SELECT 'validación: altas (3)', create_rows::text FROM public.product_import_batches WHERE id = v_b;
  v_r := public.apply_catalog_migration(v_b, false);
  INSERT INTO zz_rep VALUES ('aplica: ok/conciliado (true/true)', (v_r->>'ok') || '/' || (v_r->>'reconciled'));
  INSERT INTO zz_rep VALUES ('creados/omitidos (2/1)', (v_r->>'created') || '/' || (v_r->>'skipped'));
  INSERT INTO zz_rep SELECT 'un solo «ZZ Linga» (1)', count(*)::text FROM public.products WHERE org_id = v_org AND name = 'ZZ Linga';
  INSERT INTO zz_rep SELECT 'estado del lote (completed_with_errors)', status FROM public.product_import_batches WHERE id = v_b;
  INSERT INTO zz_rep SELECT 'fila repetida avisada (1)', count(*)::text FROM public.product_import_rows
    WHERE batch_id = v_b AND status = 'skipped' AND validation_warnings[array_length(validation_warnings, 1)] LIKE 'Repetida en el archivo%';
  v_r := public.apply_catalog_migration(v_b, false);
  INSERT INTO zz_rep VALUES ('reintento: reusa y concilia (true/true)', (v_r->>'reused') || '/' || (v_r->>'reconciled'));

  v_r := public.stage_product_import(v_org, 'zz2.xlsx', 'xlsx', jsonb_build_array(
    jsonb_build_object('name', 'ZZ Nuevo', 'sale_price_ars', 10, 'cost_ars', 5)));
  v_b := COALESCE(v_r->>'batch_id', v_r->>'id')::uuid;
  RESET ROLE;
  INSERT INTO public.products (org_id, user_id, name, cost_currency, sale_price_ars, stock, is_active)
    VALUES (v_org, v_owner, 'ZZ Nuevo', 'ARS', 10, 0, true);
  SET LOCAL ROLE authenticated;
  v_r := public.apply_catalog_migration(v_b, false);
  INSERT INTO zz_rep VALUES ('producto ajeno a la importación frena (false)', v_r->>'ok');
  INSERT INTO zz_rep VALUES ('y dice cuál (sí)', CASE WHEN v_r->>'error' LIKE '%«ZZ Nuevo» ya existe%' THEN 'sí' ELSE 'no: ' || coalesce(v_r->>'error', v_r::text) END);
  RESET ROLE;
END $d$;

SELECT * FROM zz_rep;
ROLLBACK;
