-- Simulacro de 20261030002000 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Un pedido pagado con preventa está en la vista `preventa` y en su
--      conteo; uno común pagado, no.
--   2. Despachado, sale de la vista.
--   3. Una vista desconocida sigue rechazada.
DO $$
DECLARE
  v_owner uuid; v_comp uuid; v_email text; v_org uuid; v_store uuid; v_p uuid; v_q uuid;
  v_o1 uuid; v_o2 uuid; r jsonb; v_ok text := '';
  v_slug text := 'zz-cola-prev-' || substr(md5(random()::text), 1, 8);
  v_envio jsonb := '{"provincia": "Buenos Aires"}'::jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id, lower(email) INTO v_comp, v_email FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Cola preventa', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  PERFORM public.ledger_plan_default(v_org);
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_cost, shipping_mode, pickup_enabled)
  VALUES (v_org, v_slug, 'ZZ Cola preventa', true, ARRAY['transferencia'], 0, 'free', true) RETURNING id INTO v_store;
  -- Cobrar por transferencia exige CBU o alias (trg_ecommerce_order_exige_pay).
  INSERT INTO public.settings (org_id, user_id, bank_cbu, bank_alias, bank_holder)
  VALUES (v_org, v_owner, '0000003100000000000012', 'ZZ.COLA', 'ZZ SRL')
  ON CONFLICT (org_id) DO UPDATE SET bank_cbu = EXCLUDED.bank_cbu, bank_alias = EXCLUDED.bank_alias, bank_holder = EXCLUDED.bank_holder;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, preventa_cupo, expected_restock_at)
  VALUES (v_org, v_owner, 'ZZ Consola', 1000, 0, 5, public.hoy_ar() + 20) RETURNING id INTO v_p;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Cable', 100, 10) RETURNING id INTO v_q;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_p, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  SELECT id INTO v_o1 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = r->>'order_number';
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_q, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  RESET ROLE;
  SELECT id INTO v_o2 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = r->>'order_number';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirmar_pago_manual_tienda(v_o1, 'ZZ');
  PERFORM public.confirmar_pago_manual_tienda(v_o2, 'ZZ');

  -- 1
  r := public.store_order_queue(v_org, v_store, '', 'preventa', 'recientes', 'todos', 1, NULL);
  IF (r->'counts'->>'preventa')::int <> 1 OR jsonb_array_length(r->'rows') <> 1
     OR r->'rows'->0->>'id' <> v_o1::text THEN
    RESET ROLE;
    RAISE EXCEPTION 'FALLA 1: %', jsonb_build_object('counts', r->'counts', 'filas', jsonb_array_length(r->'rows'));
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  RESET ROLE;
  UPDATE public.ecommerce_orders SET fulfillment_status = 'shipped' WHERE id = v_o1;
  SET LOCAL ROLE authenticated;
  r := public.store_order_queue(v_org, v_store, '', 'preventa', 'recientes', 'todos', 1, NULL);
  IF (r->'counts'->>'preventa')::int <> 0 OR jsonb_array_length(r->'rows') <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'FALLA 2: el despachado sigue en la vista: %', r->'counts';
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  BEGIN
    PERFORM public.store_order_queue(v_org, v_store, '', 'cualquiera', 'recientes', 'todos', 1, NULL);
    RAISE EXCEPTION 'FALLA 3: aceptó una vista desconocida';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  RESET ROLE;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
