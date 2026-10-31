-- Simulacro de 20261030001700 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Un pedido de Nerqia Pay usa el saldo y la intención de pago registra
--      sólo lo que resta.
--   2. Con un pago de Mercado Pago abierto no se aplica saldo; vencido el
--      pago, sí, y el intento viejo queda vencido.
--   3. Mercado Pago informa lo que resta: se acredita y la venta reparte
--      saldo y Mercado Pago.
--   4. Mercado Pago informa el total: se acredita y el saldo vuelve.
--   5. Otro importe: no se acredita y avisa al dueño. Sin saldo, como siempre.
--   6. Reintegro: parcial no; completo sí, por lo que cobró Mercado Pago; el
--      pedido queda reintegrado y el saldo vuelve.
--   7. Cancelar sin pagar vence el pago abierto.
--   8. A los 7 días se espera si hay un pago en curso; vencido, se libera.
--   9. acreditar_pago_de_pedido sólo para el servicio.
DO $$
DECLARE
  v_owner uuid; v_comp uuid; v_email text; v_org uuid; v_store uuid; v_a uuid; v_cli uuid;
  v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid; v_o5 uuid; v_o6 uuid; v_rma uuid; v_refund uuid;
  r jsonb; v_ok text := ''; v_num text; v_suf text := substr(md5(random()::text), 1, 8); v_slug text;
  v_envio jsonb := '{"provincia": "Buenos Aires"}'::jsonb;
BEGIN
  v_slug := 'zz-saldo-mp-' || v_suf;
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id, lower(email) INTO v_comp, v_email FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Saldo MP', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  PERFORM public.ledger_plan_default(v_org);
  -- Nerqia Pay listo sin red: proveedor habilitado y conectado, con token.
  INSERT INTO public.org_payment_providers (org_id, provider, habilitado, cuenta)
  VALUES (v_org, 'mercadopago', true, 'manual');
  INSERT INTO public.payment_connections (org_id, provider, external_id, access_token, live_mode)
  VALUES (v_org, 'mercadopago', 'zz-mp-' || v_suf, 'ZZ-TOKEN-' || v_suf, false);
  UPDATE public.org_payment_providers SET conectado_at = now() WHERE org_id = v_org AND provider = 'mercadopago';
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_cost, shipping_mode, pickup_enabled)
  VALUES (v_org, v_slug, 'ZZ Saldo MP', true, ARRAY['gestiona_pay'], 0, 'free', true) RETURNING id INTO v_store;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Zapatilla', 1000, 50) RETURNING id INTO v_a;
  INSERT INTO public.customers (org_id, user_id, name, email) VALUES (v_org, v_owner, 'ZZ Compradora', v_email) RETURNING id INTO v_cli;

  -- 1
  INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por)
  VALUES (v_org, v_cli, 'ZZ Compradora', 300, 'ZZ crédito 1', v_owner);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'gestiona_pay');
  v_num := r->>'order_number';
  r := public.aplicar_saldo_a_pedido(v_slug, v_num);
  RESET ROLE;
  IF (r->>'aplicado')::numeric <> 300 OR (r->>'resta')::numeric <> 700 THEN RAISE EXCEPTION 'FALLA 1a: %', r; END IF;
  SELECT id INTO v_o1 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  r := public.pago_intento_preparar(v_o1, 'mercadopago', 1, 'zz-o1-' || v_suf);
  IF (SELECT monto FROM public.payment_intents WHERE id = (r->>'intent_id')::uuid) <> 700 THEN
    RAISE EXCEPTION 'FALLA 1b: la intención registra % en vez de lo que resta',
      (SELECT monto FROM public.payment_intents WHERE id = (r->>'intent_id')::uuid);
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por)
  VALUES (v_org, v_cli, 'ZZ Compradora', 300, 'ZZ crédito 2', v_owner);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'gestiona_pay');
  v_num := r->>'order_number';
  RESET ROLE;
  SELECT id INTO v_o2 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  r := public.pago_intento_preparar(v_o2, 'mercadopago', 1, 'zz-o2-' || v_suf);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.aplicar_saldo_a_pedido(v_slug, v_num);
    RAISE EXCEPTION 'FALLA 2a: aplicó saldo con un pago abierto';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%Ya abriste el pago%' THEN RAISE EXCEPTION 'FALLA 2a: %', SQLERRM; END IF;
  END;
  RESET ROLE;
  UPDATE public.payment_intents SET expira_at = now() - interval '1 minute' WHERE order_id = v_o2;
  SET LOCAL ROLE authenticated;
  r := public.aplicar_saldo_a_pedido(v_slug, v_num);
  RESET ROLE;
  IF (r->>'aplicado')::numeric <> 300 THEN RAISE EXCEPTION 'FALLA 2b: %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.payment_intents WHERE order_id = v_o2 AND estado IN ('pendiente', 'procesando')) THEN
    RAISE EXCEPTION 'FALLA 2c: el pago vencido siguió vivo';
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  r := public.acreditar_pago_de_pedido(v_o1, 'zz-pay-1-' || v_suf, 700);
  IF (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_o1) <> 'paid' THEN RAISE EXCEPTION 'FALLA 3a: %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales WHERE ecommerce_order_id = v_o1
                  AND split_payments @> '[{"method": "saldo_a_favor", "amount": 300}]'::jsonb
                  AND split_payments @> '[{"method": "mercado_pago", "amount": 700}]'::jsonb) THEN
    RAISE EXCEPTION 'FALLA 3b: la venta no repartió saldo y Mercado Pago: %',
      (SELECT jsonb_agg(split_payments) FROM public.sales WHERE ecommerce_order_id = v_o1);
  END IF;
  v_ok := v_ok || '3 ';

  -- 4: el pedido 2 tiene 300 de saldo y Mercado Pago cobra el total.
  r := public.acreditar_pago_de_pedido(v_o2, 'zz-pay-2-' || v_suf, 1000);
  IF (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_o2) <> 'paid'
     OR (SELECT saldo_aplicado_ars FROM public.ecommerce_orders WHERE id = v_o2) <> 0
     OR (SELECT COALESCE(sum(monto_ars), 0) FROM public.saldo_a_favor_movimientos WHERE ecommerce_order_id = v_o2) <> 0
     OR COALESCE((r->>'saldo_devuelto')::numeric, 0) <> 300 THEN
    RAISE EXCEPTION 'FALLA 4a: %', r;
  END IF;
  IF EXISTS (SELECT 1 FROM public.sales WHERE ecommerce_order_id = v_o2
              AND split_payments @> '[{"method": "saldo_a_favor"}]'::jsonb) THEN
    RAISE EXCEPTION 'FALLA 4b: la venta repartió un saldo que volvió';
  END IF;
  v_ok := v_ok || '4 ';

  -- 5: quedan 300 (los que volvieron); otro pedido los usa y llega otro importe.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'gestiona_pay');
  v_num := r->>'order_number';
  PERFORM public.aplicar_saldo_a_pedido(v_slug, v_num);
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'gestiona_pay');
  RESET ROLE;
  SELECT id INTO v_o3 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  SELECT id INTO v_o4 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = r->>'order_number';
  r := public.acreditar_pago_de_pedido(v_o3, 'zz-pay-3-' || v_suf, 500);
  IF COALESCE((r->>'ok')::boolean, true) OR r->>'motivo' <> 'monto_distinto'
     OR (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_o3) = 'paid' THEN
    RAISE EXCEPTION 'FALLA 5a: %', r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE org_id = v_org AND user_id = v_owner
                  AND entity_id = v_o3::text AND title = 'Cobro con un importe distinto') THEN
    RAISE EXCEPTION 'FALLA 5b: el dueño no se enteró';
  END IF;
  r := public.acreditar_pago_de_pedido(v_o4, 'zz-pay-4-' || v_suf, 1);
  IF (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_o4) <> 'paid' THEN
    RAISE EXCEPTION 'FALLA 5c: un pedido sin saldo dejó de acreditarse como siempre: %', r;
  END IF;
  v_ok := v_ok || '5 ';

  -- 6: el pedido 1 (300 de saldo + 700 por Mercado Pago) se devuelve.
  INSERT INTO public.return_requests (
    org_id, rma_number, ecommerce_order_id, tipo, customer_name, customer_email, product_id, product_name, quantity,
    condition, resolution, refund_amount, refund_method, status, reason_text, approved_by, approved_at
  ) VALUES (
    v_org, 'ZZRMA-' || v_suf, v_o1, 'arrepentimiento', 'ZZ Compradora', v_email, v_a, 'ZZ Zapatilla', 1,
    'unopened', 'refund', 400, 'original_payment', 'approved', 'ZZ parcial', v_owner, now()
  ) RETURNING id INTO v_rma;
  BEGIN
    PERFORM public.pago_reintegro_preparar(v_rma, v_owner);
    RAISE EXCEPTION 'FALLA 6a: preparó un reintegro parcial de un pedido con saldo';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%una devolución parcial se resuelve con saldo a favor%' THEN RAISE EXCEPTION 'FALLA 6a: %', SQLERRM; END IF;
  END;
  UPDATE public.return_requests SET refund_amount = 1000 WHERE id = v_rma;
  r := public.pago_reintegro_preparar(v_rma, v_owner);
  IF (r->>'amount')::numeric <> 700 OR NOT (r->>'is_total')::boolean THEN RAISE EXCEPTION 'FALLA 6b: %', r; END IF;
  v_refund := (r->>'refund_id')::uuid;
  r := public.pago_reintegro_resultado(v_refund, 'refunded', 'zz-refund-' || v_suf, NULL, NULL);
  IF (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_o1) <> 'refunded'
     OR (SELECT COALESCE(sum(monto_ars), 0) FROM public.saldo_a_favor_movimientos WHERE ecommerce_order_id = v_o1) <> 0 THEN
    RAISE EXCEPTION 'FALLA 6c: el pedido quedó % y el saldo usado neto es %',
      (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_o1),
      (SELECT COALESCE(sum(monto_ars), 0) FROM public.saldo_a_favor_movimientos WHERE ecommerce_order_id = v_o1);
  END IF;
  v_ok := v_ok || '6 ';

  -- 7: vuelven 300 del pedido 1; un pedido nuevo los usa, abre el pago y se cancela.
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'gestiona_pay');
  v_num := r->>'order_number';
  PERFORM public.aplicar_saldo_a_pedido(v_slug, v_num);
  RESET ROLE;
  SELECT id INTO v_o5 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  PERFORM public.pago_intento_preparar(v_o5, 'mercadopago', 1, 'zz-o5-' || v_suf);
  UPDATE public.ecommerce_orders SET fulfillment_status = 'cancelled' WHERE id = v_o5;
  IF EXISTS (SELECT 1 FROM public.payment_intents WHERE order_id = v_o5 AND estado IN ('pendiente', 'procesando'))
     OR (SELECT saldo_aplicado_ars FROM public.ecommerce_orders WHERE id = v_o5) <> 0 THEN
    RAISE EXCEPTION 'FALLA 7: la cancelación dejó vivo el pago o el saldo aplicado';
  END IF;
  v_ok := v_ok || '7 ';

  -- 8: vuelven los 300; un pedido los usa y abre el pago; pasan 8 días.
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'gestiona_pay');
  v_num := r->>'order_number';
  PERFORM public.aplicar_saldo_a_pedido(v_slug, v_num);
  RESET ROLE;
  SELECT id INTO v_o6 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_num;
  PERFORM public.pago_intento_preparar(v_o6, 'mercadopago', 1, 'zz-o6-' || v_suf);
  UPDATE public.saldo_a_favor_movimientos SET created_at = now() - interval '8 days'
   WHERE ecommerce_order_id = v_o6 AND monto_ars < 0;
  PERFORM public.liberar_saldo_de_pedidos_impagos();
  IF (SELECT saldo_aplicado_ars FROM public.ecommerce_orders WHERE id = v_o6) <> 300 THEN
    RAISE EXCEPTION 'FALLA 8a: liberó el saldo con un pago en curso';
  END IF;
  UPDATE public.payment_intents SET expira_at = now() - interval '1 minute' WHERE order_id = v_o6;
  PERFORM public.liberar_saldo_de_pedidos_impagos();
  IF (SELECT saldo_aplicado_ars FROM public.ecommerce_orders WHERE id = v_o6) <> 0
     OR EXISTS (SELECT 1 FROM public.payment_intents WHERE order_id = v_o6 AND estado IN ('pendiente', 'procesando')) THEN
    RAISE EXCEPTION 'FALLA 8b: no liberó el saldo ni venció el pago';
  END IF;
  v_ok := v_ok || '8 ';

  -- 9
  IF has_function_privilege('authenticated', 'public.acreditar_pago_de_pedido(uuid, text, numeric, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.acreditar_pago_de_pedido(uuid, text, numeric, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.vencer_intentos_de_pago_del_pedido(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.acreditar_pago_de_pedido(uuid, text, numeric, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLA 9: permisos de acreditar_pago_de_pedido';
  END IF;
  v_ok := v_ok || '9';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
