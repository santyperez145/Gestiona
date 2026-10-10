-- Matriz reversible del precio por presentación y la recepción por bultos
-- (migración 20261009001500). Crea una organización ZZ, vende y recibe como
-- el dueño real (rol authenticated con claims) y revierte todo al final.
--
--   node scripts/db.mjs --file scripts/presentation-price-matrix.sql
--
-- Corrida el 2026-10-09 contra la base vinculada con la migración aplicada
-- dentro de la misma transacción: 7/7, cero residuos.
BEGIN;
SET LOCAL statement_timeout = '120s';
-- Drill reversible: escenarios contra la base real, todo se revierte.
CREATE TEMP TABLE zz_res (orden int, escenario text, ok boolean, detalle text) ON COMMIT DROP;
GRANT ALL ON zz_res TO authenticated;

DO $drill$
DECLARE
  v_sfx text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  v_user uuid; v_org uuid; v_prod uuid; v_otro uuid; v_pres uuid; v_pres_otro uuid; v_pres_cara uuid;
  v_res jsonb; v_sale record; v_base numeric; v_n int := 0;
  v_po uuid; v_item uuid; v_stock0 numeric; v_stock1 numeric; v_recibido numeric;
  v_linea jsonb;
  procedure_ok boolean;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ presentaciones ' || v_sfx, 'zz-pres-' || v_sfx, v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');

  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, category)
    VALUES (v_org, v_user, 'ZZ gaseosa ' || v_sfx, 1000, 500, 'zz') RETURNING id INTO v_prod;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, category)
    VALUES (v_org, v_user, 'ZZ otro ' || v_sfx, 500, 50, 'zz') RETURNING id INTO v_otro;
  INSERT INTO public.product_presentations (org_id, product_id, name, factor, barcode, price_ars)
    VALUES (v_org, v_prod, 'Caja x12', 12, 'ZZ12' || v_sfx, 9600) RETURNING id INTO v_pres;     -- 800 por unidad
  INSERT INTO public.product_presentations (org_id, product_id, name, factor, price_ars)
    VALUES (v_org, v_otro, 'Pack x6', 6, 2400) RETURNING id INTO v_pres_otro;
  INSERT INTO public.product_presentations (org_id, product_id, name, factor, price_ars)
    VALUES (v_org, v_prod, 'Regalo x2', 2, 2500) RETURNING id INTO v_pres_cara;               -- 1250 por unidad

  v_base := (public.precio_pos_autoritativo(v_org, v_prod, NULL, 12)->>'precio_vigente')::numeric;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. Caja con precio: 800 por unidad, no es override.
  v_res := public.create_sales_transaction_v2(v_org, jsonb_build_array(jsonb_build_object(
    'product_id', v_prod, 'product_name', 'ZZ', 'quantity', 12, 'unit_price_ars', 800,
    'payment_method', 'zz_metodo', 'paid', true, 'presentation_id', v_pres)), 'pos');
  SELECT unit_price_ars, presentation_id INTO v_sale FROM public.sales
   WHERE sale_transaction_id = (v_res->>'transaction_id')::uuid;
  INSERT INTO zz_res VALUES (1, 'caja cobra su precio sin override',
    v_sale.unit_price_ars = 800 AND v_sale.presentation_id = v_pres
      AND (v_res->>'overrides_de_precio')::int = 0 AND (v_res->>'lineas_por_bulto')::int = 1,
    format('unit=%s pres=%s overrides=%s bulto=%s base=%s', v_sale.unit_price_ars, v_sale.presentation_id IS NOT NULL,
      v_res->>'overrides_de_precio', v_res->>'lineas_por_bulto', v_base));

  -- 2. Menos que una caja: el precio de caja no aplica; 800 es override.
  v_res := public.create_sales_transaction_v2(v_org, jsonb_build_array(jsonb_build_object(
    'product_id', v_prod, 'product_name', 'ZZ', 'quantity', 5, 'unit_price_ars', 800,
    'payment_method', 'zz_metodo', 'paid', true, 'presentation_id', v_pres)), 'pos');
  INSERT INTO zz_res VALUES (2, 'menos de una caja no paga precio de caja',
    (v_res->>'overrides_de_precio')::int = 1 AND (v_res->>'lineas_por_bulto')::int = 0,
    format('overrides=%s bulto=%s', v_res->>'overrides_de_precio', v_res->>'lineas_por_bulto'));

  -- 3. Caja de otro producto: se rechaza.
  BEGIN
    PERFORM public.create_sales_transaction_v2(v_org, jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'product_name', 'ZZ', 'quantity', 12, 'unit_price_ars', 400,
      'payment_method', 'zz_metodo', 'paid', true, 'presentation_id', v_pres_otro)), 'pos');
    INSERT INTO zz_res VALUES (3, 'caja ajena se rechaza', false, 'no lanzó');
  EXCEPTION WHEN invalid_parameter_value THEN
    INSERT INTO zz_res VALUES (3, 'caja ajena se rechaza', true, SQLERRM);
  END;

  -- 4. Presentación borrada offline: se vende por unidad, sin id huérfano.
  v_res := public.create_sales_transaction_v2(v_org, jsonb_build_array(jsonb_build_object(
    'product_id', v_prod, 'product_name', 'ZZ', 'quantity', 12,
    'payment_method', 'zz_metodo', 'paid', true, 'presentation_id', gen_random_uuid())), 'pos');
  SELECT unit_price_ars, presentation_id INTO v_sale FROM public.sales
   WHERE sale_transaction_id = (v_res->>'transaction_id')::uuid;
  INSERT INTO zz_res VALUES (4, 'presentación borrada no tira la venta',
    v_sale.unit_price_ars = v_base AND v_sale.presentation_id IS NULL AND (v_res->>'presentaciones_ignoradas')::int = 1,
    format('unit=%s pres=%s ignoradas=%s', v_sale.unit_price_ars, v_sale.presentation_id, v_res->>'presentaciones_ignoradas'));

  -- 5. Caja más cara por unidad que el suelto: no encarece.
  v_res := public.create_sales_transaction_v2(v_org, jsonb_build_array(jsonb_build_object(
    'product_id', v_prod, 'product_name', 'ZZ', 'quantity', 2,
    'payment_method', 'zz_metodo', 'paid', true, 'presentation_id', v_pres_cara)), 'pos');
  SELECT unit_price_ars INTO v_sale FROM public.sales WHERE sale_transaction_id = (v_res->>'transaction_id')::uuid;
  INSERT INTO zz_res VALUES (5, 'presentación cara no encarece', v_sale.unit_price_ars = v_base,
    format('unit=%s base=%s', v_sale.unit_price_ars, v_base));

  RESET ROLE;

  -- 6. Recepción por bultos.
  BEGIN
    SELECT stock INTO v_stock0 FROM public.products WHERE id = v_prod;
    INSERT INTO public.purchase_orders (org_id, order_number, supplier_name, status, currency)
      VALUES (v_org, 'ZZ-' || v_sfx, 'ZZ proveedor', 'confirmed', 'ARS') RETURNING id INTO v_po;
    INSERT INTO public.purchase_order_items (order_id, org_id, product_id, product_name, quantity_ordered, unit_cost)
      VALUES (v_po, v_org, v_prod, 'ZZ gaseosa', 36, 500) RETURNING id INTO v_item;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_res := public.receive_purchase_order(v_po, jsonb_build_array(jsonb_build_object(
      'item_id', v_item, 'presentation_id', v_pres, 'bultos', 2)));
    RESET ROLE;
    SELECT quantity_received INTO v_recibido FROM public.purchase_order_items WHERE id = v_item;
    SELECT stock INTO v_stock1 FROM public.products WHERE id = v_prod;
    INSERT INTO zz_res VALUES (6, 'recibir 2 cajas suma 24', v_recibido = 24 AND v_stock1 - v_stock0 = 24,
      format('recibido=%s stock %s→%s', v_recibido, v_stock0, v_stock1));
    -- 7. Caja de otro producto en la recepción: se rechaza.
    BEGIN
      SET LOCAL ROLE authenticated;
      PERFORM public.receive_purchase_order(v_po, jsonb_build_array(jsonb_build_object(
        'item_id', v_item, 'presentation_id', v_pres_otro, 'bultos', 1)));
      RESET ROLE;
      INSERT INTO zz_res VALUES (7, 'recepción con caja ajena se rechaza', false, 'no lanzó');
    EXCEPTION WHEN invalid_parameter_value THEN
      RESET ROLE;
      INSERT INTO zz_res VALUES (7, 'recepción con caja ajena se rechaza', true, SQLERRM);
    END;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO zz_res VALUES (6, 'recepción por bultos', false, 'no se pudo armar: ' || SQLERRM);
  END;
END
$drill$;

SELECT orden, escenario, ok, detalle FROM zz_res ORDER BY orden;
ROLLBACK;
