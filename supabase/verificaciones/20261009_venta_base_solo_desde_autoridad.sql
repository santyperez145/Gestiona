-- La v1 no es invocable por usuarios; v2/v3 siguen vendiendo. ROLLBACK.
BEGIN;
DO $$
DECLARE v_org uuid := gen_random_uuid(); v_owner uuid; v_product uuid := gen_random_uuid(); v_denied boolean; v_result jsonb;
BEGIN
  ASSERT NOT has_function_privilege('authenticated', 'public.create_sales_transaction(uuid,jsonb,text)', 'EXECUTE'), 'v1 expuesta';
  ASSERT has_function_privilege('authenticated', 'public.create_sales_transaction_v3(uuid,jsonb,text)', 'EXECUTE'), 'v3 inaccesible';
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES (v_org, 'ZZ Venta base', 'zz-venta-base-' || v_org, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner');
  INSERT INTO public.products(id, org_id, user_id, name, sale_price_ars, maneja_stock) VALUES (v_product, v_org, v_owner, 'ZZ P', 90000, false);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN PERFORM public.create_sales_transaction(v_org, jsonb_build_array(jsonb_build_object('product_id', v_product, 'product_name', 'ZZ P', 'quantity', 1, 'unit_price_ars', 1, 'total_ars', 1)), 'pos');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'Un usuario llamó la venta base directo';
  v_result := public.create_sales_transaction_v3(v_org, jsonb_build_array(jsonb_build_object('product_id', v_product, 'product_name', 'ZZ P', 'quantity', 1, 'payment_method', 'efectivo', 'paid', true)), 'pos');
  RESET ROLE;
  ASSERT (v_result->>'transaction_id') IS NOT NULL, 'v3 no registró la venta: ' || v_result;
  -- Precio de lista 90.000 con el descuento por medio que tenga configurado el comercio.
  ASSERT (SELECT total_ars BETWEEN 1000 AND 90000 FROM public.sales WHERE sale_transaction_id = (v_result->>'transaction_id')::uuid), 'v3 no usó el precio autoritativo';
  RAISE NOTICE 'OK: v1 cerrada, v3 vende al precio autoritativo';
END;
$$;
ROLLBACK;
SELECT count(*) AS remaining_synthetic_organizations FROM public.organizations WHERE slug LIKE 'zz-venta-base-%';
