-- Simulacro de 20261030001400 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Sin sesión no se aplica saldo; un pedido ajeno tampoco.
--   2. $ 300 de saldo en un pedido de $ 1.000 por transferencia: queda
--      aplicado una vez y el comprador lo ve en su pedido.
--   3. Al confirmarse la transferencia, la venta reparte saldo y medio y el
--      asiento manda 300 a Deudores por ventas y 700 al Banco.
--   4. Si el saldo cubre todo, el pedido queda pagado en el acto.
--   5. Un pedido con saldo aplicado que falla devuelve el saldo una sola vez.
DO $$
DECLARE
  v_owner uuid; v_comp uuid; v_email text; v_org uuid; v_store uuid; v_a uuid; v_cli uuid;
  v_o1 uuid; v_o2 uuid; v_o3 uuid; v_entry uuid; r jsonb; v_ok text := ''; v_saldo numeric; v_num text; v_n1 text;
  v_slug text := 'zz-parcial-' || substr(md5(random()::text), 1, 8);
  v_envio jsonb := '{"provincia": "Buenos Aires"}'::jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id, lower(email) INTO v_comp, v_email FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Parcial', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  PERFORM public.ledger_plan_default(v_org);
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_cost, shipping_mode, pickup_enabled)
  VALUES (v_org, v_slug, 'ZZ Parcial', true, ARRAY['efectivo', 'transferencia'], 0, 'free', true) RETURNING id INTO v_store;
  -- Cobrar por transferencia exige CBU o alias (trg_ecommerce_order_exige_pay).
  INSERT INTO public.settings (org_id, user_id, bank_cbu, bank_alias, bank_holder)
  VALUES (v_org, v_owner, '0000003100000000000012', 'ZZ.PARCIAL', 'ZZ SRL')
  ON CONFLICT (org_id) DO UPDATE SET bank_cbu = EXCLUDED.bank_cbu, bank_alias = EXCLUDED.bank_alias, bank_holder = EXCLUDED.bank_holder;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Campera', 1000, 20) RETURNING id INTO v_a;
  INSERT INTO public.customers (org_id, user_id, name, email) VALUES (v_org, v_owner, 'ZZ Compradora', v_email) RETURNING id INTO v_cli;
  INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por)
  VALUES (v_org, v_cli, 'ZZ Compradora', 300, 'ZZ crédito por un cambio', v_owner);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  RESET ROLE;
  v_n1 := r->>'order_number';
  SELECT id INTO v_o1 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_n1;

  -- 1
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.aplicar_saldo_a_pedido(v_slug, v_n1);
    RAISE EXCEPTION 'FALLA 1a: un anónimo aplicó saldo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.aplicar_saldo_a_pedido(v_slug, v_n1);
    RAISE EXCEPTION 'FALLA 1b: aplicó saldo a un pedido ajeno';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '1 ';

  -- 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.aplicar_saldo_a_pedido(v_slug, v_n1);
  IF (r->>'aplicado')::numeric <> 300 OR (r->>'resta')::numeric <> 700 THEN RAISE EXCEPTION 'FALLA 2a: %', r; END IF;
  r := public.aplicar_saldo_a_pedido(v_slug, v_n1);
  IF NOT COALESCE((r->>'ya_aplicado')::boolean, false) THEN RAISE EXCEPTION 'FALLA 2b: se aplicó dos veces: %', r; END IF;
  IF (SELECT saldo_aplicado FROM public.get_store_order_secure(v_slug, v_n1, NULL, v_email)) <> 300 THEN
    RAISE EXCEPTION 'FALLA 2c: el comprador no ve el saldo aplicado';
  END IF;
  RESET ROLE;
  SELECT sum(monto_ars) INTO v_saldo FROM public.saldo_a_favor_movimientos WHERE customer_id = v_cli;
  IF v_saldo <> 0 THEN RAISE EXCEPTION 'FALLA 2d: el saldo no bajó: %', v_saldo; END IF;
  IF (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_o1) <> 'pending' THEN RAISE EXCEPTION 'FALLA 2e: quedó pagado sin la transferencia'; END IF;
  v_ok := v_ok || '2 ';

  -- 3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirmar_pago_manual_tienda(v_o1, 'ZZ');
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.sales WHERE ecommerce_order_id = v_o1
                  AND split_payments @> '[{"method": "saldo_a_favor", "amount": 300}]'::jsonb
                  AND split_payments @> '[{"method": "transferencia", "amount": 700}]'::jsonb) THEN
    RAISE EXCEPTION 'FALLA 3a: la venta no repartió saldo y transferencia: %',
      (SELECT jsonb_agg(split_payments) FROM public.sales WHERE ecommerce_order_id = v_o1);
  END IF;
  v_entry := public.ledger_asentar_orden_pagada(jsonb_build_object(
    'org_id', v_org, 'occurred_at', now(), 'data', jsonb_build_object('order_id', v_o1)));
  IF NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id
                  WHERE l.entry_id = v_entry AND a.codigo = '1.2.01' AND l.debe = 300)
     OR NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id
                     WHERE l.entry_id = v_entry AND a.codigo = '1.1.02' AND l.debe = 700) THEN
    RAISE EXCEPTION 'FALLA 3b: el asiento no repartió el cobro: %',
      (SELECT jsonb_agg(jsonb_build_object('cuenta', a.codigo, 'debe', l.debe, 'haber', l.haber))
         FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id WHERE l.entry_id = v_entry);
  END IF;
  v_ok := v_ok || '3 ';

  -- 4
  INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por)
  VALUES (v_org, v_cli, 'ZZ Compradora', 2000, 'ZZ otro crédito', v_owner);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'efectivo');
  v_num := r->>'order_number';
  r := public.aplicar_saldo_a_pedido(v_slug, v_num);
  RESET ROLE;
  IF NOT (r->>'pagado')::boolean THEN RAISE EXCEPTION 'FALLA 4a: %', r; END IF;
  SELECT id INTO v_o2 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  IF (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_o2) <> 'paid'
     OR NOT EXISTS (SELECT 1 FROM public.sales WHERE ecommerce_order_id = v_o2 AND payment_method = 'saldo_a_favor' AND paid) THEN
    RAISE EXCEPTION 'FALLA 4b: el pedido cubierto con saldo no quedó pagado con saldo';
  END IF;
  v_ok := v_ok || '4 ';

  -- 5: quedan 1000 de saldo; un pedido de 2000 usa todo y falla.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 2)), 'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  v_num := r->>'order_number';
  r := public.aplicar_saldo_a_pedido(v_slug, v_num);
  RESET ROLE;
  IF (r->>'aplicado')::numeric <> 1000 OR (r->>'resta')::numeric <> 1000 THEN RAISE EXCEPTION 'FALLA 5a: %', r; END IF;
  SELECT id INTO v_o3 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  UPDATE public.ecommerce_orders SET payment_status = 'failed' WHERE id = v_o3;
  UPDATE public.ecommerce_orders SET fulfillment_status = 'cancelled' WHERE id = v_o3;
  SELECT sum(monto_ars) INTO v_saldo FROM public.saldo_a_favor_movimientos WHERE customer_id = v_cli;
  IF v_saldo <> 1000 THEN RAISE EXCEPTION 'FALLA 5b: el saldo no volvió una vez (queda %)', v_saldo; END IF;
  v_ok := v_ok || '5';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
