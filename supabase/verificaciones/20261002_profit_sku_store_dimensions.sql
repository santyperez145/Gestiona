-- Synthetic tenant only; no provider call, fiscal emission or customer mutation.
BEGIN;
DO $verify$
DECLARE
  v_org uuid := gen_random_uuid(); v_other uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid(); v_store uuid := gen_random_uuid(); v_inactive uuid := gen_random_uuid();
  v_foreign_store uuid := gen_random_uuid(); v_variant uuid; v_first uuid; v_second uuid;
  v_user uuid; v_order uuid; v_tx uuid; v_role text; v_period jsonb; v_sku jsonb; v_next jsonb;
  v_denied boolean; v_sum numeric; v_count integer; v_index integer;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'Requires a fixture owner';
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Profit dimensions', 'zz-profit-dim-' || v_org, v_user),
    (v_other, 'ZZ Profit dimensions', 'zz-profit-dim-' || v_other, v_user);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  DELETE FROM public.role_permissions WHERE org_id = v_org AND module = 'analytics';
  INSERT INTO public.products(id, org_id, user_id, name, stock, sku, cost_ars)
    VALUES (v_product, v_org, v_user, 'ZZ Profit dimensions product', 1000, 'ZZ-BASE', 3);
  INSERT INTO public.ecommerce_stores(id, org_id, name, slug, is_active) VALUES
    (v_store, v_org, 'ZZ Profit active', 'zz-active-' || v_org, true),
    (v_inactive, v_org, 'ZZ Profit inactive', 'zz-inactive-' || v_org, false),
    (v_foreign_store, v_other, 'ZZ Profit foreign', 'zz-foreign-' || v_other, true);
  FOR v_index IN 1..32 LOOP
    v_variant := gen_random_uuid(); v_tx := gen_random_uuid();
    IF v_index = 1 THEN v_first := v_variant; ELSIF v_index = 2 THEN v_second := v_variant; END IF;
    INSERT INTO public.product_variants(id, product_id, org_id, user_id, variant_name, sku, stock)
      VALUES (v_variant, v_product, v_org, v_user, 'ZZ Talle ' || v_index,
        CASE WHEN v_index <= 2 THEN 'ZZ-REPETIDO' ELSE 'ZZ-SKU-' || v_index END, 100);
    INSERT INTO public.sale_transactions(id, org_id, source, created_by, occurred_at)
      VALUES (v_tx, v_org, 'pos', v_user, '2026-09-15 12:00:00-03');
    PERFORM set_config('gestiona.sale_transaction_id', v_tx::text, true);
    INSERT INTO public.sales(org_id, user_id, product_id, variant_id, product_name, quantity, unit_price_ars,
      total_ars, cost_of_goods_ars, payment_method, paid, source, sale_transaction_id, date)
      VALUES (v_org, v_user, v_product, v_variant, 'ZZ Profit dimension line', 1, 10, 10, 3,
        'efectivo', true, 'pos', v_tx, '2026-09-15 12:00:00-03');
  END LOOP;
  FOR v_index IN 1..2 LOOP
    v_order := gen_random_uuid();
    INSERT INTO public.ecommerce_orders(id, org_id, store_id, customer_name, customer_email,
      items, subtotal, total, payment_method)
      VALUES (v_order, v_org, CASE WHEN v_index = 1 THEN v_store ELSE v_inactive END,
        'ZZ Profit customer', 'zz-profit@example.invalid', '[]'::jsonb, 10 + 10 * v_index, 10 + 10 * v_index, 'efectivo');
    PERFORM set_config('gestiona.sale_transaction_id', '', true);
    INSERT INTO public.sales(org_id, user_id, product_id, variant_id, product_name, quantity, unit_price_ars,
      total_ars, cost_of_goods_ars, payment_method, paid, source, ecommerce_order_id, date)
      VALUES (v_org, v_user, v_product, CASE WHEN v_index = 1 THEN v_first ELSE v_second END,
        'ZZ Profit store line', 1, 10 + 10 * v_index, 10 + 10 * v_index, 3,
        'efectivo', true, 'tienda_online', v_order, '2026-09-15 12:00:00-03');
  END LOOP;
  v_tx := gen_random_uuid();
  INSERT INTO public.sale_transactions(id, org_id, source, created_by, occurred_at)
    VALUES (v_tx, v_org, 'pos', v_user, '2026-09-15 12:00:00-03');
  PERFORM set_config('gestiona.sale_transaction_id', v_tx::text, true);
  INSERT INTO public.sales(org_id, user_id, product_id, product_name, quantity, unit_price_ars,
    total_ars, cost_of_goods_ars, payment_method, paid, source, sale_transaction_id, date, returned, returned_quantity)
    VALUES (v_org, v_user, v_product, 'ZZ Profit unidentified variant', 1, 10, 10, 0,
      'efectivo', true, 'pos', v_tx, '2026-09-15 12:00:00-03', true, 1);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  FOREACH v_role IN ARRAY ARRAY['owner', 'admin', 'vendedor', 'viewer'] LOOP
    UPDATE public.memberships SET role = v_role::public.org_role WHERE org_id = v_org AND user_id = v_user;
    SET LOCAL ROLE authenticated;
    v_period := public.get_profit_period(v_org, '2026-09-01', '2026-09-30');
    ASSERT (v_period->'coverage'->>'lines')::integer = 35, 'Legacy API population changed';
    ASSERT (v_period->'coverage'->>'revenueARS')::numeric = 380, 'Canonical total changed';
    ASSERT (v_period->>'productCount')::integer = 2, 'Product/channel groups incorrect';
    v_sku := public.get_profit_period_dimensions(v_org, NULL, NULL, 1, 1, 100, '{"groupBy":"sku"}');
    ASSERT (v_sku->>'productCount')::integer = 35, 'Variant identities merged, lost or hidden';
    ASSERT v_sku->'coverage' = v_period->'coverage', 'SKU mode changed canonical money';
    SELECT sum((item->>'revenueARS')::numeric) INTO v_sum FROM jsonb_array_elements(v_sku->'products') item;
    ASSERT v_sum = 380, 'SKU detail does not reconcile';
    SELECT count(*) INTO v_count FROM jsonb_array_elements(v_sku->'products') item
      WHERE item->>'sku' = 'ZZ-REPETIDO' AND item->>'channel' = 'pos';
    ASSERT v_count = 2, 'Duplicate SKU strings merged variants';
    ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v_sku->'products') item
      WHERE item->'variantId' = 'null'::jsonb AND item->'contributionMarginARS' = 'null'::jsonb
        AND item->'pendingCodes' ? 'devolucion_neta'), 'Unidentified/returned line disappeared';
    ASSERT jsonb_array_length(v_sku->'stores') = 2, 'Store options leaked another tenant';
    v_next := public.get_profit_period_dimensions(v_org, NULL, NULL, 1, 1, 25, '{"groupBy":"sku"}');
    v_sku := public.get_profit_period_dimensions(v_org, NULL, NULL, 2, 1, 25, '{"groupBy":"sku"}');
    ASSERT jsonb_array_length(v_sku->'products') = 10, 'SKU last page incorrect';
    ASSERT v_sku->'coverage' = v_next->'coverage', 'SKU pagination changed totals';
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_next->'products') a
      JOIN jsonb_array_elements(v_sku->'products') b ON a->>'productId' = b->>'productId'
        AND a->'variantId' = b->'variantId' AND a->>'channel' = b->>'channel'), 'SKU pages overlap';
    v_next := public.get_profit_period_dimensions(v_org, NULL, NULL, 1, 1, 25, jsonb_build_object('storeId', v_store, 'groupBy', 'sku'));
    ASSERT (v_next->'coverage'->>'revenueARS')::numeric = 20 AND (v_next->>'operationCount')::integer = 1, 'Store filter split or lost ticket';
    ASSERT v_next->'filters'->>'storeId' = v_store::text, 'Store scope not echoed';
    v_next := public.get_profit_period_dimensions(v_org, NULL, NULL, 1, 1, 25, jsonb_build_object('storeId', v_inactive));
    ASSERT (v_next->'coverage'->>'revenueARS')::numeric = 30, 'Inactive store history excluded';
    v_next := public.get_profit_period_dimensions(v_org, NULL, NULL, 1, 1, 25, '{"channel":"pos"}');
    ASSERT (v_next->'coverage'->>'revenueARS')::numeric = 330, 'Channel filter incorrect';
    v_next := public.get_profit_period_dimensions(v_org, NULL, NULL, 1, 1, 25, jsonb_build_object('storeId', v_store, 'channel', 'pos'));
    ASSERT (v_next->'coverage'->>'lines')::integer = 0 AND v_next->'coverage'->'contributionMarginARS' = 'null'::jsonb, 'Incompatible filters became guessed money';
    v_denied := false;
    BEGIN PERFORM public.get_profit_period_dimensions(v_org, NULL, NULL, 1, 1, 25, jsonb_build_object('storeId', v_foreign_store));
    EXCEPTION WHEN invalid_parameter_value THEN v_denied := true; END;
    ASSERT v_denied, 'Cross-tenant store accepted';
    v_denied := false;
    BEGIN PERFORM public.get_profit_period_dimensions(v_other, NULL, NULL, 1, 1, 25, '{}'::jsonb);
    EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
    ASSERT v_denied, 'Cross-tenant RPC accepted';
    RESET ROLE;
    INSERT INTO public.role_permissions(org_id, role, module, can_view)
      VALUES (v_org, CASE WHEN v_role = 'owner' THEN 'admin' ELSE v_role END, 'analytics', false)
      ON CONFLICT (org_id, role, module) DO UPDATE SET can_view = false;
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM public.sale_margin_dimensions WHERE org_id = v_org;
    ASSERT v_count = 0, 'Dimensions ignored explicit denial';
    SELECT count(*) INTO v_count FROM public.profit_store_options WHERE org_id = v_org;
    ASSERT v_count = 0, 'Store names ignored explicit denial';
    v_denied := false;
    BEGIN PERFORM public.get_profit_period_dimensions(v_org, NULL, NULL, 1, 1, 25, '{}'::jsonb);
    EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
    ASSERT v_denied, 'Filtered RPC ignored explicit denial';
    RESET ROLE;
    DELETE FROM public.role_permissions WHERE org_id = v_org AND module = 'analytics';
  END LOOP;
  UPDATE public.memberships SET role = 'owner' WHERE org_id = v_org AND user_id = v_user;
  SET LOCAL ROLE authenticated;
  v_period := public.get_profit_period_dimensions(v_org, NULL, NULL, 1, 1, 100, '{"groupBy":"sku"}');
  RESET ROLE;
  UPDATE public.products SET cost_ars = 999 WHERE id = v_product;
  UPDATE public.product_variants SET sku = 'ZZ-RENAMED' WHERE id = v_first;
  SET LOCAL ROLE authenticated;
  v_next := public.get_profit_period_dimensions(v_org, NULL, NULL, 1, 1, 100, '{"groupBy":"sku"}');
  ASSERT v_next->'coverage' = v_period->'coverage', 'Current catalog cost rewrote historical money';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v_next->'products') item WHERE item->>'sku' = 'ZZ-RENAMED'
    AND item->>'skuSource' = 'current_catalog'), 'Catalog provenance missing';
  FOR v_period IN SELECT value FROM jsonb_array_elements('[null,[],{"channel":"unknown"},{"groupBy":"bad"},{"storeId":"bad"},{"cost":0}]') LOOP
    v_denied := false;
    BEGIN PERFORM public.get_profit_period_dimensions(v_org, NULL, NULL, 1, 1, 25, v_period);
    EXCEPTION WHEN invalid_parameter_value THEN v_denied := true; END;
    ASSERT v_denied, 'Invalid filters accepted';
  END LOOP;
  RESET ROLE;
  ASSERT NOT has_function_privilege('anon', 'public.get_profit_period_dimensions(uuid,date,date,integer,integer,integer,jsonb)', 'EXECUTE'), 'Anonymous filtered RPC permitted';
  ASSERT NOT has_table_privilege('anon', 'public.sale_margin_dimensions', 'SELECT'), 'Anonymous dimension view permitted';
  ASSERT NOT has_table_privilege('anon', 'public.profit_store_options', 'SELECT'), 'Anonymous store names permitted';
  RAISE NOTICE 'PASS: four roles, two tenants, 35 lines, duplicate SKUs, inactive store, atomic totals, paging, NULL, historic costs, filter validation and explicit denies';
END;
$verify$;
ROLLBACK;
SELECT count(*) AS remaining_test_organizations FROM public.organizations WHERE name = 'ZZ Profit dimensions';
