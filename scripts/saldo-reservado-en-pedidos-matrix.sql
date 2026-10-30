-- Simulacro de 20261030001500 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Un pago rechazado deja el saldo reservado: si la transferencia llega
--      después, la venta reparte saldo y transferencia como antes.
--   2. Cancelado sin pagar: el saldo vuelve una vez y el pedido deja de
--      tenerlo aplicado; no se vuelve a aplicar (ni cancelado ni descancelado).
--   3. Reintegrado: el saldo vuelve y el pedido conserva lo que pagó con saldo.
--   4. Contracargo: no vuelve solo; el comprador no puede devolvérselo y el
--      dueño sí, una vez y con auditoría.
--   5. Siete días impago: el saldo vuelve solo; uno reciente sigue reservado.
--   6. Las funciones internas no se exponen, el cron existe y el disparador
--      corre antes de escribir.
DO $$
DECLARE
  v_owner uuid; v_comp uuid; v_email text; v_org uuid; v_store uuid; v_a uuid; v_cli uuid;
  v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid; v_o5 uuid; v_o6 uuid;
  r jsonb; v_ok text := ''; v_saldo numeric; v_num text;
  v_slug text := 'zz-reserva-' || substr(md5(random()::text), 1, 8);
  v_envio jsonb := '{"provincia": "Buenos Aires"}'::jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id, lower(email) INTO v_comp, v_email FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Reserva', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  PERFORM public.ledger_plan_default(v_org);
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_cost, shipping_mode, pickup_enabled)
  VALUES (v_org, v_slug, 'ZZ Reserva', true, ARRAY['efectivo', 'transferencia'], 0, 'free', true) RETURNING id INTO v_store;
  -- Cobrar por transferencia exige CBU o alias (trg_ecommerce_order_exige_pay).
  INSERT INTO public.settings (org_id, user_id, bank_cbu, bank_alias, bank_holder)
  VALUES (v_org, v_owner, '0000003100000000000012', 'ZZ.RESERVA', 'ZZ SRL')
  ON CONFLICT (org_id) DO UPDATE SET bank_cbu = EXCLUDED.bank_cbu, bank_alias = EXCLUDED.bank_alias, bank_holder = EXCLUDED.bank_holder;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Campera', 1000, 50) RETURNING id INTO v_a;
  INSERT INTO public.customers (org_id, user_id, name, email) VALUES (v_org, v_owner, 'ZZ Compradora', v_email) RETURNING id INTO v_cli;
  INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por)
  VALUES (v_org, v_cli, 'ZZ Compradora', 300, 'ZZ crédito por un cambio', v_owner);

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  v_num := r->>'order_number';
  r := public.aplicar_saldo_a_pedido(v_slug, v_num);
  RESET ROLE;
  IF (r->>'aplicado')::numeric <> 300 THEN RAISE EXCEPTION 'FALLA 1a: %', r; END IF;
  SELECT id INTO v_o1 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  UPDATE public.ecommerce_orders SET payment_status = 'failed' WHERE id = v_o1;
  SELECT COALESCE(sum(monto_ars), 0) INTO v_saldo FROM public.saldo_a_favor_movimientos WHERE customer_id = v_cli;
  IF v_saldo <> 0 OR (SELECT saldo_aplicado_ars FROM public.ecommerce_orders WHERE id = v_o1) <> 300 THEN
    RAISE EXCEPTION 'FALLA 1b: el rechazo soltó la reserva (saldo %)', v_saldo;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirmar_pago_manual_tienda(v_o1, 'ZZ');
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.sales WHERE ecommerce_order_id = v_o1
                  AND split_payments @> '[{"method": "saldo_a_favor", "amount": 300}]'::jsonb
                  AND split_payments @> '[{"method": "transferencia", "amount": 700}]'::jsonb) THEN
    RAISE EXCEPTION 'FALLA 1c: la venta no repartió saldo y transferencia: %',
      (SELECT jsonb_agg(split_payments) FROM public.sales WHERE ecommerce_order_id = v_o1);
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por)
  VALUES (v_org, v_cli, 'ZZ Compradora', 500, 'ZZ otro crédito', v_owner);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  v_num := r->>'order_number';
  r := public.aplicar_saldo_a_pedido(v_slug, v_num);
  RESET ROLE;
  IF (r->>'aplicado')::numeric <> 500 THEN RAISE EXCEPTION 'FALLA 2a: %', r; END IF;
  SELECT id INTO v_o2 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  UPDATE public.ecommerce_orders SET fulfillment_status = 'cancelled' WHERE id = v_o2;
  UPDATE public.ecommerce_orders SET payment_status = 'failed' WHERE id = v_o2;
  UPDATE public.ecommerce_orders SET payment_status = 'pending' WHERE id = v_o2;
  SELECT COALESCE(sum(monto_ars), 0) INTO v_saldo FROM public.saldo_a_favor_movimientos WHERE customer_id = v_cli;
  IF v_saldo <> 500 OR (SELECT saldo_aplicado_ars FROM public.ecommerce_orders WHERE id = v_o2) <> 0 THEN
    RAISE EXCEPTION 'FALLA 2b: la cancelación no devolvió una vez (saldo %, aplicado %)', v_saldo,
      (SELECT saldo_aplicado_ars FROM public.ecommerce_orders WHERE id = v_o2);
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.aplicar_saldo_a_pedido(v_slug, v_num);
    RAISE EXCEPTION 'FALLA 2c: aplicó saldo a un pedido cancelado';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%cancelado%' THEN RAISE EXCEPTION 'FALLA 2c: %', SQLERRM; END IF;
  END;
  RESET ROLE;
  UPDATE public.ecommerce_orders SET fulfillment_status = 'pending' WHERE id = v_o2;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.aplicar_saldo_a_pedido(v_slug, v_num);
    RAISE EXCEPTION 'FALLA 2d: aplicó dos veces el saldo al mismo pedido';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%ya usó tu saldo%' THEN RAISE EXCEPTION 'FALLA 2d: %', SQLERRM; END IF;
  END;
  RESET ROLE;
  v_ok := v_ok || '2 ';

  -- 3: quedan 500; un pedido en efectivo los usa, se cobra y se reintegra.
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'efectivo');
  v_num := r->>'order_number';
  r := public.aplicar_saldo_a_pedido(v_slug, v_num);
  RESET ROLE;
  SELECT id INTO v_o3 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirmar_pago_manual_tienda(v_o3, 'ZZ');
  RESET ROLE;
  UPDATE public.ecommerce_orders SET payment_status = 'refunded' WHERE id = v_o3;
  SELECT COALESCE(sum(monto_ars), 0) INTO v_saldo FROM public.saldo_a_favor_movimientos WHERE customer_id = v_cli;
  IF v_saldo <> 500 OR (SELECT saldo_aplicado_ars FROM public.ecommerce_orders WHERE id = v_o3) <> 500 THEN
    RAISE EXCEPTION 'FALLA 3: el reintegro no devolvió el saldo o borró el dato (saldo %)', v_saldo;
  END IF;
  v_ok := v_ok || '3 ';

  -- 4: contracargo de un pedido cobrado con saldo y transferencia.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  v_num := r->>'order_number';
  r := public.aplicar_saldo_a_pedido(v_slug, v_num);
  RESET ROLE;
  SELECT id INTO v_o4 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirmar_pago_manual_tienda(v_o4, 'ZZ');
  RESET ROLE;
  PERFORM public.handle_store_order_payment_reversal(v_o4, NULL, 'charged_back', 'ZZ contracargo');
  SELECT COALESCE(sum(monto_ars), 0) INTO v_saldo FROM public.saldo_a_favor_movimientos WHERE customer_id = v_cli;
  IF v_saldo <> 0 THEN RAISE EXCEPTION 'FALLA 4a: el contracargo devolvió el saldo solo (saldo %)', v_saldo; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.devolver_saldo_del_pedido(v_o4);
    RAISE EXCEPTION 'FALLA 4b: el comprador se devolvió el saldo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.devolver_saldo_del_pedido(v_o4);
  IF (r->>'devuelto')::numeric <> 500 THEN RAISE EXCEPTION 'FALLA 4c: %', r; END IF;
  r := public.devolver_saldo_del_pedido(v_o4);
  IF (r->>'devuelto')::numeric <> 0 THEN RAISE EXCEPTION 'FALLA 4d: devolvió dos veces: %', r; END IF;
  BEGIN
    PERFORM public.devolver_saldo_del_pedido(v_o3);
    RAISE EXCEPTION 'FALLA 4e: devolvió a mano el saldo de un pedido sin contracargo';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  SELECT COALESCE(sum(monto_ars), 0) INTO v_saldo FROM public.saldo_a_favor_movimientos WHERE customer_id = v_cli;
  IF v_saldo <> 500 OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE org_id = v_org AND action = 'store_credit_returned' AND entity_id = v_o4) THEN
    RAISE EXCEPTION 'FALLA 4f: saldo % o falta la auditoría', v_saldo;
  END IF;
  v_ok := v_ok || '4 ';

  -- 5: uno impago hace 8 días y otro reciente.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  v_num := r->>'order_number';
  PERFORM public.aplicar_saldo_a_pedido(v_slug, v_num);
  RESET ROLE;
  SELECT id INTO v_o5 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por)
  VALUES (v_org, v_cli, 'ZZ Compradora', 200, 'ZZ crédito chico', v_owner);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'efectivo');
  v_num := r->>'order_number';
  PERFORM public.aplicar_saldo_a_pedido(v_slug, v_num);
  RESET ROLE;
  SELECT id INTO v_o6 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  UPDATE public.saldo_a_favor_movimientos SET created_at = now() - interval '8 days'
   WHERE ecommerce_order_id = v_o5 AND monto_ars < 0;
  PERFORM public.liberar_saldo_de_pedidos_impagos();
  PERFORM public.liberar_saldo_de_pedidos_impagos();
  SELECT COALESCE(sum(monto_ars), 0) INTO v_saldo FROM public.saldo_a_favor_movimientos WHERE customer_id = v_cli;
  IF v_saldo <> 500
     OR (SELECT saldo_aplicado_ars FROM public.ecommerce_orders WHERE id = v_o5) <> 0
     OR (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_o5) <> 'pending'
     OR (SELECT saldo_aplicado_ars FROM public.ecommerce_orders WHERE id = v_o6) <> 200 THEN
    RAISE EXCEPTION 'FALLA 5: saldo %, vencido %, reciente %', v_saldo,
      (SELECT saldo_aplicado_ars FROM public.ecommerce_orders WHERE id = v_o5),
      (SELECT saldo_aplicado_ars FROM public.ecommerce_orders WHERE id = v_o6);
  END IF;
  v_ok := v_ok || '5 ';

  -- 6
  IF has_function_privilege('authenticated', 'public.liberar_saldo_de_pedidos_impagos()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.liberar_saldo_de_pedidos_impagos()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.devolver_saldo_usado_en_pedido(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.devolver_saldo_del_pedido(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLA 6a: una función interna quedó expuesta';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'liberar-saldo-de-pedidos-impagos') THEN
    RAISE EXCEPTION 'FALLA 6b: falta el cron';
  END IF;
  IF (SELECT tgtype & 2 FROM pg_trigger WHERE tgname = 'trg_pedido_devuelve_saldo' AND tgrelid = 'public.ecommerce_orders'::regclass) <> 2 THEN
    RAISE EXCEPTION 'FALLA 6c: el disparador no corre antes de escribir';
  END IF;
  v_ok := v_ok || '6';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
