-- Simulacro de 20261030001900 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Un producto con 2 en stock y cupo de preventa 5: un pedido de 4 entra;
--      la línea dice 2 de preventa y cuándo llegan; el disponible queda en -2.
--   2. Otro pedido de 4 no entra (quedan 3); uno de 3 sí: el disponible llega
--      justo al cupo.
--   3. Cobrado el primero, el stock queda en -2 y stock_negativo no lo
--      cuenta: es preventa vigente.
--   4. Sin preventa, o vencida la fecha, no se vende de más; vencida con
--      faltantes, stock_negativo lo muestra.
--   5. get_store_preventas muestra lo que está en preventa (no lo vencido ni
--      lo que tiene variantes) y la puede leer cualquiera.
--   6. cupo_de_preventa es interna.
DO $$
DECLARE
  v_owner uuid; v_comp uuid; v_email text; v_org uuid; v_store uuid; v_p uuid; v_q uuid; v_v uuid;
  v_o1 uuid; r jsonb; v_ok text := ''; v_num text; v_llega date := public.hoy_ar() + 20;
  v_slug text := 'zz-preventa-' || substr(md5(random()::text), 1, 8);
  v_envio jsonb := '{"provincia": "Buenos Aires"}'::jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id, lower(email) INTO v_comp, v_email FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Preventa', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  PERFORM public.ledger_plan_default(v_org);
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_cost, shipping_mode, pickup_enabled)
  VALUES (v_org, v_slug, 'ZZ Preventa', true, ARRAY['transferencia'], 0, 'free', true) RETURNING id INTO v_store;
  -- Cobrar por transferencia exige CBU o alias (trg_ecommerce_order_exige_pay).
  INSERT INTO public.settings (org_id, user_id, bank_cbu, bank_alias, bank_holder)
  VALUES (v_org, v_owner, '0000003100000000000012', 'ZZ.PREVENTA', 'ZZ SRL')
  ON CONFLICT (org_id) DO UPDATE SET bank_cbu = EXCLUDED.bank_cbu, bank_alias = EXCLUDED.bank_alias, bank_holder = EXCLUDED.bank_holder;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, preventa_cupo, expected_restock_at)
  VALUES (v_org, v_owner, 'ZZ Consola', 1000, 2, 5, v_llega) RETURNING id INTO v_p;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Joystick', 500, 1) RETURNING id INTO v_q;

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_p, 'quantity', 4)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  RESET ROLE;
  v_num := r->>'order_number';
  SELECT id INTO v_o1 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  IF (SELECT items->0->'preventa'->>'cantidad' FROM public.ecommerce_orders WHERE id = v_o1)::numeric <> 2
     OR (SELECT items->0->'preventa'->>'llega' FROM public.ecommerce_orders WHERE id = v_o1)::date <> v_llega THEN
    RAISE EXCEPTION 'FALLA 1a: la línea no dice la preventa: %', (SELECT items FROM public.ecommerce_orders WHERE id = v_o1);
  END IF;
  IF public.stock_disponible(v_p, NULL) <> -2 THEN
    RAISE EXCEPTION 'FALLA 1b: el disponible quedó en %', public.stock_disponible(v_p, NULL);
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_p, 'quantity', 4)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
    RAISE EXCEPTION 'FALLA 2a: vendió por encima del cupo';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%quedan 3 y se piden 4%' THEN RAISE EXCEPTION 'FALLA 2a: %', SQLERRM; END IF;
  END;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_p, 'quantity', 3)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  RESET ROLE;
  IF public.stock_disponible(v_p, NULL) <> -5 THEN
    RAISE EXCEPTION 'FALLA 2b: el disponible quedó en %', public.stock_disponible(v_p, NULL);
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirmar_pago_manual_tienda(v_o1, 'ZZ');
  RESET ROLE;
  IF (SELECT stock FROM public.products WHERE id = v_p) <> -2
     OR EXISTS (SELECT 1 FROM public.stock_negativo WHERE product_id = v_p) THEN
    RAISE EXCEPTION 'FALLA 3: stock % y en stock_negativo: %', (SELECT stock FROM public.products WHERE id = v_p),
      EXISTS (SELECT 1 FROM public.stock_negativo WHERE product_id = v_p);
  END IF;
  v_ok := v_ok || '3 ';

  -- 4
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_q, 'quantity', 2)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
    RAISE EXCEPTION 'FALLA 4a: vendió de más sin preventa';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Sin stock disponible%' THEN RAISE EXCEPTION 'FALLA 4a: %', SQLERRM; END IF;
  END;
  RESET ROLE;
  UPDATE public.products SET expected_restock_at = public.hoy_ar() - 1 WHERE id = v_p;
  IF public.cupo_de_preventa(v_p, NULL) <> 0 THEN RAISE EXCEPTION 'FALLA 4b: la preventa vencida sigue con cupo'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stock_negativo WHERE product_id = v_p) THEN
    RAISE EXCEPTION 'FALLA 4c: vencida con faltantes no aparece en stock_negativo';
  END IF;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_p, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
    RAISE EXCEPTION 'FALLA 4d: vendió una preventa vencida';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Sin stock disponible%' THEN RAISE EXCEPTION 'FALLA 4d: %', SQLERRM; END IF;
  END;
  RESET ROLE;
  UPDATE public.products SET expected_restock_at = v_llega WHERE id = v_p;
  v_ok := v_ok || '4 ';

  -- 5: una preventa con variantes no se lista.
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, preventa_cupo, expected_restock_at)
  VALUES (v_org, v_owner, 'ZZ Remera', 300, 0, 10, v_llega) RETURNING id INTO v_v;
  INSERT INTO public.product_variants (org_id, user_id, product_id, variant_name, stock, active)
  VALUES (v_org, v_owner, v_v, 'ZZ talle M', 0, true);
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  IF (SELECT count(*) FROM public.get_store_preventas(v_slug)) <> 1
     OR (SELECT llega FROM public.get_store_preventas(v_slug) WHERE product_id = v_p) <> v_llega
     OR (SELECT vendible FROM public.get_store_preventas(v_slug) WHERE product_id = v_p) <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'FALLA 5: %', (SELECT json_agg(x) FROM public.get_store_preventas(v_slug) x);
  END IF;
  RESET ROLE;
  v_ok := v_ok || '5 ';

  -- 6
  IF has_function_privilege('anon', 'public.cupo_de_preventa(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cupo_de_preventa(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLA 6: cupo_de_preventa quedó expuesta';
  END IF;
  v_ok := v_ok || '6';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
