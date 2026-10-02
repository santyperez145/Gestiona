-- Reversible synthetic evidence only; never emits a payment, invoice or email.
BEGIN;
DO $verify$
DECLARE
  v_org uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); v_user uuid;
  v_fifo uuid := gen_random_uuid(); v_unknown uuid := gen_random_uuid(); v_return uuid := gen_random_uuid();
  v_negative uuid := gen_random_uuid(); v_broken uuid := gen_random_uuid(); v_ambiguous uuid := gen_random_uuid();
  v_variant_product uuid := gen_random_uuid(); v_variant1 uuid := gen_random_uuid(); v_variant2 uuid := gen_random_uuid();
  v_large uuid := gen_random_uuid(); v_product uuid; v_role text; v_result jsonb; v_before jsonb; v_next jsonb;
  v_capture jsonb; v_denied boolean; v_count integer; v_row jsonb;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'Fixture requires a technical owner';
  INSERT INTO public.organizations(id,name,slug,owner_user_id) VALUES
    (v_org,'ZZ Inventory capital','zz-capital-' || v_org,v_user),(v_other,'ZZ Inventory capital','zz-capital-' || v_other,v_user);
  INSERT INTO public.memberships(org_id,user_id,role) VALUES (v_org,v_user,'owner');
  DELETE FROM public.role_permissions WHERE org_id = v_org AND module IN ('inventory','analytics');
  INSERT INTO public.products(id,org_id,user_id,name,stock,cost_ars,cost_currency,sku) VALUES
    (v_fifo,v_org,v_user,'ZZ FIFO',8,999,'ARS','ZZ-FIFO'),
    (v_unknown,v_org,v_user,'ZZ Unknown opening',7,999,'ARS',NULL),
    (v_return,v_org,v_user,'ZZ Return',3,999,'ARS',NULL),
    (v_negative,v_org,v_user,'ZZ Negative',-2,999,'ARS',NULL),
    (v_broken,v_org,v_user,'ZZ Broken',5,999,'ARS',NULL),
    (v_ambiguous,v_org,v_user,'ZZ Simultaneous',2,999,'ARS',NULL),
    (v_variant_product,v_org,v_user,'ZZ Variants',5,999,'ARS',NULL),
    (v_large,v_org,v_user,'ZZ Large stream',1007,999,'ARS',NULL);
  INSERT INTO public.product_variants(id,product_id,org_id,user_id,variant_name,sku,stock) VALUES
    (v_variant1,v_variant_product,v_org,v_user,'ZZ S','ZZ-DUPLICATE',2),
    (v_variant2,v_variant_product,v_org,v_user,'ZZ M','ZZ-DUPLICATE',3);
  -- Precisely sequenced frozen facts. Direct fixture writes are postgres-only and rolled back.
  INSERT INTO public.stock_movements(org_id,product_id,variant_id,product_name,movement_type,quantity,stock_before,stock_after,unit_cost_ars,created_at) VALUES
    (v_org,v_fifo,NULL,'ZZ FIFO','purchase',10,0,10,100,'2026-07-01T12:00:00Z'),
    (v_org,v_fifo,NULL,'ZZ FIFO','sale',-5,10,5,888,'2026-07-02T12:00:00Z'),
    (v_org,v_fifo,NULL,'ZZ FIFO','purchase',3,5,8,200,'2026-07-03T12:00:00Z'),
    (v_org,v_fifo,NULL,'ZZ FIFO','transfer_out',-3,8,5,999,'2026-07-04T12:00:00Z'),
    (v_org,v_fifo,NULL,'ZZ FIFO','transfer_in',3,5,8,999,'2026-07-04T12:00:00Z'),
    (v_org,v_unknown,NULL,'ZZ Unknown','sale',-2,3,1,NULL,'2026-07-01T12:00:00Z'),
    (v_org,v_unknown,NULL,'ZZ Unknown','purchase',6,1,7,10,'2026-07-02T12:00:00Z'),
    (v_org,v_return,NULL,'ZZ Return','purchase',2,0,2,30,'2026-07-01T12:00:00Z'),
    (v_org,v_return,NULL,'ZZ Return','sale',-1,2,1,30,'2026-07-02T12:00:00Z'),
    (v_org,v_return,NULL,'ZZ Return','sale_edited',2,1,3,999,'2026-07-03T12:00:00Z'),
    (v_org,v_broken,NULL,'ZZ Broken','purchase',4,0,4,10,'2026-07-01T12:00:00Z'),
    (v_org,v_ambiguous,NULL,'ZZ Simultaneous','purchase',1,0,1,10,'2026-07-01T12:00:00Z'),
    (v_org,v_ambiguous,NULL,'ZZ Simultaneous','purchase',1,1,2,20,'2026-07-01T12:00:00Z'),
    (v_org,v_variant_product,v_variant1,'ZZ Variant','purchase',2,0,2,20,'2026-07-01T12:00:00Z'),
    (v_org,v_variant_product,v_variant2,'ZZ Variant','purchase',3,0,3,30,'2026-07-01T12:00:00Z');
  INSERT INTO public.stock_movements(org_id,product_id,product_name,movement_type,quantity,stock_before,stock_after,unit_cost_ars,created_at)
    SELECT v_org,v_large,'ZZ Large stream','purchase',1,index-1,index,1.23,'2026-07-01T12:00:00Z'::timestamptz + index * interval '1 second' FROM generate_series(1,1007) index;
  FOR index IN 1..25 LOOP
    v_product := gen_random_uuid();
    INSERT INTO public.products(id,org_id,user_id,name,stock) VALUES (v_product,v_org,v_user,'ZZ Untracked ' || lpad(index::text,2,'0'),1);
  END LOOP;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  FOREACH v_role IN ARRAY ARRAY['owner','admin','vendedor','viewer'] LOOP
    UPDATE public.memberships SET role = v_role::public.org_role WHERE org_id = v_org AND user_id = v_user;
    SET LOCAL ROLE authenticated;
    v_result := public.get_inventory_capital(v_org,'',1,25,1);
    ASSERT (v_result->>'itemCount')::integer = 34, 'Lost variant/untracked/negative rows';
    ASSERT jsonb_array_length(v_result->'items') = 25, 'Page not bounded';
    ASSERT v_result->'summary'->'valueARS' = 'null'::jsonb, 'Partial capital presented as complete';
    ASSERT (v_result->'summary'->>'measuredValueARS')::numeric = 2558.61, 'Full population not valued';
    v_next := public.get_inventory_capital(v_org,'',2,25,1);
    ASSERT v_next->'summary' = v_result->'summary', 'Pagination rewrote total';
    ASSERT jsonb_array_length(v_next->'items') = 9, 'Wrong final page';
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'items') a JOIN jsonb_array_elements(v_next->'items') b
      ON a->>'product_id' = b->>'product_id' AND a->'variant_id' = b->'variant_id'), 'Pages overlap';
    v_before := public.get_inventory_capital(v_org,'ZZ FIFO',1,25,1);
    v_row := v_before->'items'->0;
    ASSERT (v_row->>'value_ars')::numeric = 1100 AND (v_row->>'known_units')::integer = 8, 'FIFO remaining cost wrong or transfer changed capital';
    ASSERT jsonb_array_length(v_before->'layers') = 2 AND (v_before->'layers'->0->>'remainingUnits')::integer = 5, 'Purchased quantities falsely shown as remaining';
    v_next := public.get_inventory_capital(v_org,'ZZ Unknown',1,25,1);
    ASSERT (v_next->'items'->0->>'known_units')::integer = 6 AND (v_next->'items'->0->>'unvalued_units')::integer = 1, 'Untracked opening lost';
    ASSERT v_next->'items'->0->'value_ars' = 'null'::jsonb AND (v_next->'items'->0->>'measured_value_ars')::numeric = 60, 'Opening cost guessed';
    v_next := public.get_inventory_capital(v_org,'ZZ Return',1,25,1);
    ASSERT (v_next->'items'->0->>'measured_value_ars')::numeric = 30 AND (v_next->'items'->0->>'unvalued_units')::integer = 2, 'Return valued at current cost';
    v_next := public.get_inventory_capital(v_org,'ZZ Negative',1,25,1);
    ASSERT (v_next->'items'->0->>'stock_units')::integer = -2 AND v_next->'items'->0->'reasons' ? 'negative_stock', 'Negative stock clamped';
    v_next := public.get_inventory_capital(v_org,'ZZ Broken',1,25,1);
    ASSERT v_next->'items'->0->'reasons' ? 'movement_reconciliation' AND v_next->'items'->0->'measured_value_ars' = 'null'::jsonb, 'Broken chain valued';
    v_next := public.get_inventory_capital(v_org,'ZZ Simultaneous',1,25,1);
    ASSERT v_next->'items'->0->'reasons' ? 'movement_order', 'UUID order invented a FIFO sequence';
    v_next := public.get_inventory_capital(v_org,'ZZ-DUPLICATE',1,25,1);
    ASSERT (v_next->>'itemCount')::integer = 2 AND (v_next->'summary'->>'valueARS')::numeric = 130, 'Repeated SKU merged variants';
    v_next := public.get_inventory_capital(v_org,'ZZ Large',1,25,1);
    ASSERT (v_next->'summary'->>'valueARS')::numeric = 1238.61 AND (v_next->>'layerCount')::integer = 1007 AND jsonb_array_length(v_next->'layers') = 25, 'Movement stream truncated or detail unbounded';
    v_before := public.get_inventory_capital(v_org,'ZZ Large',1,25,1,41);
    ASSERT jsonb_array_length(v_before->'layers') = 7 AND v_before->'summary' = v_next->'summary', 'Last layer page wrong or changed total';
    ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_before->'layers') a JOIN jsonb_array_elements(v_next->'layers') b ON a->>'movementId' = b->>'movementId'), 'Layer pages overlap';
    v_denied := false;
    BEGIN PERFORM public.get_inventory_capital(v_other,'',1,25,1); EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
    ASSERT v_denied, 'Foreign tenant read';
    RESET ROLE;
    INSERT INTO public.role_permissions(org_id,role,module,can_view) VALUES
      (v_org,CASE WHEN v_role = 'owner' THEN 'admin' ELSE v_role END,'analytics',false)
      ON CONFLICT(org_id,role,module) DO UPDATE SET can_view = false;
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM public.inventory_capital_items WHERE org_id = v_org;
    ASSERT v_count = 0, 'Explicit deny ignored by view';
    v_denied := false;
    BEGIN PERFORM public.get_inventory_capital(v_org,'',1,25,1); EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
    ASSERT v_denied, 'Explicit deny ignored by RPC';
    RESET ROLE;
    DELETE FROM public.role_permissions WHERE org_id = v_org AND module = 'analytics';
  END LOOP;
  UPDATE public.memberships SET role = 'owner' WHERE org_id = v_org AND user_id = v_user;
  SET LOCAL ROLE authenticated;
  v_before := public.get_inventory_capital(v_org,'ZZ FIFO',1,25,1);
  v_capture := public.capture_inventory_capital(v_org,(now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
  ASSERT v_capture->>'status' = 'recorded', 'Capture not persisted';
  v_capture := public.capture_inventory_capital(v_org,(now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
  ASSERT v_capture->>'status' = 'already_recorded', 'Capture not idempotent';
  v_result := public.get_inventory_capital(v_org,'ZZ FIFO',1,25,1);
  ASSERT (v_result->>'historyCount')::integer = 1 AND (v_result->'history'->0->>'products')::integer = 33, 'Capture incorrectly scoped to a filtered page';
  ASSERT v_result->'history'->0->'value_ars' = 'null'::jsonb, 'Partial history closed as complete';
  v_denied := false;
  BEGIN UPDATE public.inventory_snapshots SET stock_value = 0 WHERE org_id = v_org; EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'Browser can rewrite snapshots';
  RESET ROLE;
  UPDATE public.products SET cost_ars = 99999,sale_price_ars = 999999 WHERE id = v_fifo;
  SET LOCAL ROLE authenticated;
  v_next := public.get_inventory_capital(v_org,'ZZ FIFO',1,25,1);
  ASSERT v_next->'summary' = v_before->'summary', 'Current price/cost rewrote capital';
  ASSERT v_next->'history' = v_result->'history', 'Current price/cost rewrote captured history';
  RESET ROLE;
  INSERT INTO public.inventory_snapshots(org_id,product_id,snapshot_date,stock_quantity,stock_value) VALUES (v_org,v_fifo,current_date - 1,8,0);
  SET LOCAL ROLE authenticated;
  v_next := public.get_inventory_capital(v_org,'',1,25,1);
  ASSERT v_next->'history'->1->'value_ars' = 'null'::jsonb AND v_next->'history'->1->'measured_value_ars' = 'null'::jsonb, 'Legacy zero accepted as evidence';
  RESET ROLE;
  INSERT INTO public.role_permissions(org_id,role,module,can_create) VALUES (v_org,'admin','inventory',false)
    ON CONFLICT(org_id,role,module) DO UPDATE SET can_create = false;
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN PERFORM public.capture_inventory_capital(v_org,(now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date); EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'Capture ignored explicit write denial';
  RESET ROLE;
  ASSERT NOT has_function_privilege('anon','public.get_inventory_capital(uuid,text,integer,integer,integer,integer)','EXECUTE'), 'Anonymous read allowed';
  ASSERT NOT has_function_privilege('anon','public.capture_inventory_capital(uuid,date)','EXECUTE'), 'Anonymous capture allowed';
  RAISE NOTICE 'PASS: four roles, two tenants, 1007 movements, FIFO layers, unknown opening, returns, variants, negatives, transfers, history and idempotent captures';
END;
$verify$;
ROLLBACK;
SELECT count(*) AS remaining_test_organizations FROM public.organizations WHERE name = 'ZZ Inventory capital';
