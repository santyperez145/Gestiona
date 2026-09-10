-- Read-only RPC exercised with synthetic orders; all inserts roll back.
BEGIN;
DO $verify$
DECLARE
  v_org uuid := gen_random_uuid();
  v_other_org uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_other_store uuid := gen_random_uuid();
  v_owner uuid;
  v_slug text := 'zz-queue-' || substr(v_org::text, 1, 8);
  v_result jsonb;
  v_page_one jsonb;
  v_denied boolean;
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_owner IS NOT NULL, 'fixture requires an existing owner';
  INSERT INTO public.organizations(id, name, slug, owner_user_id)
    VALUES (v_org, 'ZZ Queue verification', v_slug, v_owner),
      (v_other_org, 'ZZ Queue verification', v_slug || '-other', v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner');
  INSERT INTO public.ecommerce_stores(id, org_id, name, slug, is_active)
    VALUES (v_store, v_org, 'ZZ Queue', v_slug, true),
      (v_other_store, v_org, 'ZZ Queue secondary', v_slug || '-two', true);
  INSERT INTO public.ecommerce_orders(org_id, store_id, order_number, customer_email, customer_name,
    items, subtotal, total, payment_method, payment_status, fulfillment_status, created_at)
    SELECT v_org, v_store, 'ZZ-QUEUE-' || n, 'zz-queue@example.invalid', 'ZZ Queue ' || n,
      '[]'::jsonb, n, n, 'efectivo', 'paid', 'delivered', now() - interval '1 hour'
    FROM generate_series(1, 250) n;
  INSERT INTO public.ecommerce_orders(org_id, store_id, order_number, customer_email, customer_name,
    items, subtotal, total, payment_method, payment_status, fulfillment_status, carrier, created_at)
    VALUES (v_org, v_store, 'ZZ-QUEUE-OLD', 'zz-old@example.invalid', U&'Jos\00e9 %_ Queue',
      '[]', 15000, 15000, 'efectivo', 'paid', 'pending', 'retiro', now() - interval '5 days'),
      (v_org, v_other_store, 'ZZ-QUEUE-OTHER', 'zz-other@example.invalid', 'ZZ Other store',
      '[]', 15000, 15000, 'efectivo', 'paid', 'pending', 'retiro', now() - interval '5 days');
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_result := public.store_order_queue(v_org, v_store);
  ASSERT (v_result->>'total')::int = 251 AND jsonb_array_length(v_result->'rows') = 50, 'history is capped or page unbounded';
  ASSERT (v_result->>'attention')::int = 1, 'overdue order counted twice';
  ASSERT (v_result->'counts'->>'atrasados')::int = 1, 'oldest order missing from counts';
  ASSERT NOT (v_result->'rows'->0 ? 'public_access_token'), 'token exposed';
  v_page_one := v_result->'rows';
  v_result := public.store_order_queue(v_org, v_store, p_page => 2);
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_page_one) a
    JOIN jsonb_array_elements(v_result->'rows') b ON a->>'id' = b->>'id'), 'unstable pagination at equal timestamps';
  v_result := public.store_order_queue(v_org, v_store, p_page => 2147483647);
  ASSERT (v_result->>'page')::int = 6 AND jsonb_array_length(v_result->'rows') = 1, 'last page not clamped';
  ASSERT v_result->'rows'->0->>'order_number' = 'ZZ-QUEUE-OLD', 'old order not reachable';
  v_result := public.store_order_queue(v_org, v_store, p_view => 'atrasados');
  ASSERT (v_result->>'total')::int = 1 AND v_result->'rows'->0->>'order_number' = 'ZZ-QUEUE-OLD', 'overdue view lost history';
  v_result := public.store_order_queue(v_org, v_store, p_query => 'jose %_');
  ASSERT (v_result->>'total')::int = 1, 'accent or literal search broken';
  v_result := public.store_order_queue(v_org, v_store, p_query => '%');
  ASSERT (v_result->>'total')::int = 1, 'wildcard interpreted as SQL';
  v_result := public.store_order_queue(v_org, v_store, p_query => '$15.000', p_amount => 15000);
  ASSERT (v_result->>'total')::int = 1, 'amount search broken';
  v_result := public.store_order_queue(v_org, v_store, p_sort => 'mayor');
  ASSERT (v_result->'rows'->0->>'total')::numeric = 15000, 'descending amount sort broken';
  v_result := public.store_order_queue(v_org, v_store, p_sort => 'menor');
  ASSERT (v_result->'rows'->0->>'total')::numeric = 1, 'ascending amount sort broken';
  v_result := public.store_order_queue(v_org, v_store, p_medio => 'digital');
  ASSERT (v_result->>'total')::int = 0 AND (v_result->>'store_total')::int = 251, 'filtered empty mistaken for empty store';
  v_result := public.store_order_queue(v_org, v_other_store);
  ASSERT (v_result->>'total')::int = 1, 'secondary store inherited orders';
  v_denied := false;
  BEGIN
    PERFORM public.store_order_queue(v_other_org, v_store);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  ASSERT v_denied, 'cross-organization read allowed';
  v_denied := false;
  BEGIN
    PERFORM public.store_order_queue(v_org, gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  ASSERT v_denied, 'unknown store accepted';
  v_denied := false;
  BEGIN
    PERFORM public.store_order_queue(v_org, v_store, p_page => 0);
  EXCEPTION WHEN invalid_parameter_value THEN v_denied := true;
  END;
  ASSERT v_denied, 'invalid pagination accepted';
  RESET ROLE;
  INSERT INTO public.role_permissions(org_id, role, module, can_view)
    VALUES (v_org, 'admin', 'ecommerce', false)
    ON CONFLICT (org_id, role, module) DO UPDATE SET can_view = false;
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN
    PERFORM public.store_order_queue(v_org, v_store);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  ASSERT v_denied, 'member without view permission read orders';
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN
    PERFORM public.store_order_queue(v_org, v_store);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  ASSERT v_denied, 'outsider read allowed';
  RESET ROLE;
  SET LOCAL ROLE anon;
  v_denied := false;
  BEGIN
    PERFORM public.store_order_queue(v_org, v_store);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  ASSERT v_denied, 'anonymous read allowed';
  RESET ROLE;
  RAISE NOTICE 'store_order_queue: history, search, paging, counts and isolation passed';
END;
$verify$;
ROLLBACK;
SELECT count(*) AS fixture_organizations_remaining FROM public.organizations WHERE name = 'ZZ Queue verification';
