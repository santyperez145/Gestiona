BEGIN;
DO $verify$
DECLARE
  v_org uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_user uuid;
  v_night uuid := gen_random_uuid();
  v_after uuid := gen_random_uuid();
  v_role text;
  v_app_role text;
  v_period jsonb;
  v_next jsonb;
  v_denied boolean;
  v_count integer;
  v_sum numeric;
  v_tx record;
  v_index integer := 0;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'Requires a fixture owner';
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Profit period authority', 'zz-profit-' || v_org, v_user),
    (v_other, 'ZZ Profit period authority', 'zz-profit-' || v_other, v_user);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  DELETE FROM public.role_permissions WHERE org_id = v_org AND module = 'analytics';
  INSERT INTO public.products(id, org_id, user_id, name, stock)
    VALUES (v_product, v_org, v_user, 'ZZ Profit product', 3000);
  INSERT INTO public.sale_transactions(id, org_id, source, created_by, occurred_at)
    SELECT gen_random_uuid(), v_org, 'pos', v_user, '2026-09-01 12:00:00-03'::timestamptz FROM generate_series(1, 1005);
  FOR v_tx IN SELECT id, occurred_at FROM public.sale_transactions WHERE org_id = v_org ORDER BY id LOOP
    v_index := v_index + 1;
    PERFORM set_config('gestiona.sale_transaction_id', v_tx.id::text, true);
    INSERT INTO public.sales(org_id, user_id, product_id, product_name, quantity, unit_price_ars,
      total_ars, cost_of_goods_ars, payment_method, paid, source, sale_transaction_id, date)
      VALUES (v_org, v_user, v_product, 'ZZ Profit line', 1, 10.01, 10.01,
        CASE WHEN v_index = 1 THEN 0 ELSE 3.01 END,
        'efectivo', true, 'pos', v_tx.id, v_tx.occurred_at);
  END LOOP;
  INSERT INTO public.sale_transactions(id, org_id, source, created_by, occurred_at) VALUES
    (v_night, v_org, 'pos', v_user, '2026-09-30 23:59:59.999-03'),
    (v_after, v_org, 'pos', v_user, '2026-10-01 00:00:00-03');
  PERFORM set_config('gestiona.sale_transaction_id', v_night::text, true);
  INSERT INTO public.sales(org_id, user_id, product_id, product_name, quantity, unit_price_ars,
    total_ars, cost_of_goods_ars, payment_method, paid, source, sale_transaction_id, date,
    returned, returned_quantity) VALUES
    (v_org, v_user, v_product, 'ZZ Profit night', 1, 20, 20, 5, 'efectivo', true, 'pos', v_night, '2026-09-30 23:59:59.999-03', false, 0),
    (v_org, v_user, v_product, 'ZZ Profit night', 1, 30, 30, 5, 'efectivo', true, 'pos', v_night, '2026-10-01 00:00:00.001-03', true, 1);
  PERFORM set_config('gestiona.sale_transaction_id', v_after::text, true);
  INSERT INTO public.sales(org_id, user_id, product_id, product_name, quantity, unit_price_ars,
    total_ars, cost_of_goods_ars, payment_method, paid, source, sale_transaction_id, date)
    VALUES (v_org, v_user, v_product, 'ZZ Profit after', 1, 99, 99, 5, 'efectivo', true, 'pos', v_after, '2026-10-01 00:00:00-03');
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  FOREACH v_role IN ARRAY ARRAY['owner', 'admin', 'vendedor', 'viewer'] LOOP
    UPDATE public.memberships SET role = v_role::public.org_role WHERE org_id = v_org AND user_id = v_user;
    v_app_role := CASE WHEN v_role = 'owner' THEN 'admin' ELSE v_role END;
    SET LOCAL ROLE authenticated;
    v_period := public.get_profit_period(v_org, '2026-09-01', '2026-09-30');
    ASSERT (v_period->'coverage'->>'lines')::integer = 1007, 'Population truncated or midnight ticket split';
    ASSERT (v_period->>'operationCount')::integer = 1006, 'Operations population incorrect';
    ASSERT (v_period->'coverage'->>'revenueARS')::numeric = 10110.05, 'Period total differs from canonical lines';
    ASSERT v_period->'coverage'->'contributionMarginARS' = 'null'::jsonb, 'Unknown/returned contribution became zero';
    ASSERT jsonb_array_length(v_period->'operations') = 25, 'Detail not paginated';
    SELECT sum((product->>'revenueARS')::numeric) INTO v_sum FROM jsonb_array_elements(v_period->'products') product;
    ASSERT v_sum = (v_period->'coverage'->>'revenueARS')::numeric,
      format('Product aggregate does not reconcile: subtotal %s, total %s, groups %s, products %s',
        v_sum, v_period->'coverage'->>'revenueARS', v_period->>'productCount', v_period->'products');
    v_next := public.get_profit_period(v_org, '2026-09-01', '2026-09-30', 1, 2, 25);
    ASSERT v_next->'coverage' = v_period->'coverage', 'Paging changed totals';
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_period->'operations') a
      JOIN jsonb_array_elements(v_next->'operations') b ON a->>'operation_key' = b->>'operation_key'), 'Page duplicates';
    v_next := public.get_profit_period(v_org, '2026-09-01', '2026-09-30', 99, 999, 25);
    ASSERT (v_next->>'operationPage')::integer = 41 AND jsonb_array_length(v_next->'operations') = 6, 'Last page clamp incorrect';
    v_next := public.get_profit_period(v_org, '2026-09-30', '2026-09-30');
    ASSERT (v_next->'coverage'->>'lines')::integer = 2 AND (v_next->'coverage'->>'revenueARS')::numeric = 50,
      'Fractional end of day excluded or partial ticket';
    v_next := public.get_profit_period(v_org, '2026-10-01', '2026-10-01');
    ASSERT (v_next->'coverage'->>'revenueARS')::numeric = 99, 'Ticket counted again on next day';
    v_next := public.get_profit_period(v_org, '2026-08-01', '2026-08-01');
    ASSERT (v_next->'coverage'->>'lines')::integer = 0 AND v_next->'coverage'->'measuredContributionARS' = 'null'::jsonb, 'Empty became measured zero';
    v_denied := false;
    BEGIN PERFORM public.get_profit_period(v_other); EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
    ASSERT v_denied, 'Cross-tenant RPC permitted';
    RESET ROLE;
    INSERT INTO public.role_permissions(org_id, role, module, can_view)
      VALUES (v_org, v_app_role, 'analytics', false) ON CONFLICT (org_id, role, module) DO UPDATE SET can_view = false;
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM public.sale_margin_facts WHERE org_id = v_org;
    ASSERT v_count = 0, 'Explicit denial ignored by line view';
    SELECT count(*) INTO v_count FROM public.sale_margin_operations WHERE org_id = v_org;
    ASSERT v_count = 0, 'Explicit denial ignored by operation view';
    SELECT count(*) INTO v_count FROM public.organization_margin_coverage WHERE org_id = v_org;
    ASSERT v_count = 0, 'Coverage bypassed denial';
    v_denied := false;
    BEGIN PERFORM public.get_profit_period(v_org); EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
    ASSERT v_denied, 'Explicit denial ignored by RPC';
    RESET ROLE;
    DELETE FROM public.role_permissions WHERE org_id = v_org AND module = 'analytics';
  END LOOP;
  DELETE FROM public.memberships WHERE org_id = v_org AND user_id = v_user;
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN PERFORM public.get_profit_period(v_org); EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'Non-member permitted';
  RESET ROLE;
  ASSERT NOT has_function_privilege('anon', 'public.get_profit_period(uuid,date,date,integer,integer,integer)', 'EXECUTE'), 'Anonymous execute permitted';
  ASSERT NOT has_table_privilege('authenticated', 'public._sale_margin_facts_effective', 'SELECT'), 'Internal facts exposed';
  RAISE NOTICE 'PASS: 4 roles, explicit denies, tenant scope, 1007 lines, period/page reconciliation, midnight and fractional boundaries, NULL preserved';
END;
$verify$;
ROLLBACK;
SELECT count(*) AS remaining_test_organizations FROM public.organizations WHERE name = 'ZZ Profit period authority';
