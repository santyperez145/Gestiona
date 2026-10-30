-- Simulacro de 20261030000200 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. El saldo a favor está entre los medios de la tienda pero no en los públicos.
--   2. Un cambio se pide con el detalle y dentro del plazo de la tienda.
--   3. Una devolución resuelta con crédito en tienda acredita el saldo una vez.
--   4. El comprador ve su saldo y paga con él cuando cubre el total: el pedido
--      queda pagado con su total completo y el saldo baja.
--   5. Si no alcanza, no se crea el pedido; un anónimo no puede usar saldo.
DO $$
DECLARE
  v_owner uuid; v_comp uuid; v_email text; v_org uuid; v_store uuid; v_a uuid; v_cli uuid; v_order uuid; v_rr uuid;
  v_slug text := 'zz-cambio-' || substr(md5(random()::text), 1, 8);
  r jsonb; n numeric; v_ok text := ''; v_pedidos integer;
  v_envio jsonb := '{"provincia": "Buenos Aires"}'::jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id, lower(email) INTO v_comp, v_email FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Cambios', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_cost, shipping_mode, pickup_enabled)
  VALUES (v_org, v_slug, 'ZZ Cambios', true, ARRAY['efectivo'], 0, 'free', true) RETURNING id INTO v_store;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Remera', 400, 10) RETURNING id INTO v_a;
  INSERT INTO public.customers (org_id, user_id, name, email) VALUES (v_org, v_owner, 'ZZ Compradora', v_email) RETURNING id INTO v_cli;

  -- 1
  IF NOT ((SELECT payment_methods FROM public.ecommerce_stores WHERE id = v_store) @> ARRAY['saldo_a_favor']) THEN RAISE EXCEPTION 'FALLA 1a: falta el medio interno'; END IF;
  IF public.medios_de_pago_vivos(v_org, ARRAY['efectivo', 'saldo_a_favor', 'cuenta_corriente']) <> ARRAY['efectivo'] THEN RAISE EXCEPTION 'FALLA 1b: medios públicos %', public.medios_de_pago_vivos(v_org, ARRAY['efectivo', 'saldo_a_favor']); END IF;
  v_ok := v_ok || '1 ';

  -- 2: un pedido pagado en efectivo
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'efectivo');
  RESET ROLE;
  SELECT id INTO v_order FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = r->>'order_number';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirmar_pago_manual_tienda(v_order, 'ZZ');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.request_store_return(v_slug, r->>'order_number', v_email, 'cambio', v_a, NULL, 1, 'Me queda chica');
    RAISE EXCEPTION 'FALLA 2a: un cambio sin detalle';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.request_store_return(v_slug, r->>'order_number', v_email, 'cambio', v_a, NULL, 1, 'Me queda chica', 'Talle M');
  RESET ROLE;
  SELECT id INTO v_rr FROM public.return_requests WHERE ecommerce_order_id = v_order;
  IF (SELECT tipo FROM public.return_requests WHERE id = v_rr) <> 'cambio' OR (SELECT cambio_por FROM public.return_requests WHERE id = v_rr) <> 'Talle M' THEN
    RAISE EXCEPTION 'FALLA 2b: %', r;
  END IF;
  UPDATE public.ecommerce_stores SET plazo_cambio_dias = 0 WHERE id = v_store;
  UPDATE public.return_requests SET status = 'cancelled' WHERE id = v_rr;
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.request_store_return(v_slug, r->>'order_number', v_email, 'cambio', v_a, NULL, 1, NULL, 'Talle M');
    RAISE EXCEPTION 'FALLA 2c: aceptó un cambio con la tienda sin cambios';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  UPDATE public.ecommerce_stores SET plazo_cambio_dias = 30 WHERE id = v_store;
  v_ok := v_ok || '2 ';

  -- 3: el comercio resuelve con crédito en tienda
  UPDATE public.return_requests SET status = 'approved', resolution = 'store_credit', refund_amount = 500 WHERE id = v_rr;
  IF EXISTS (SELECT 1 FROM public.saldo_a_favor_movimientos WHERE return_request_id = v_rr) THEN RAISE EXCEPTION 'FALLA 3a: acreditó antes de resolver'; END IF;
  UPDATE public.return_requests SET status = 'resolved', resolved_at = now() WHERE id = v_rr;
  UPDATE public.return_requests SET status = 'closed' WHERE id = v_rr;
  SELECT count(*), sum(monto_ars) INTO v_pedidos, n FROM public.saldo_a_favor_movimientos WHERE return_request_id = v_rr;
  IF v_pedidos <> 1 OR n <> 500 THEN RAISE EXCEPTION 'FALLA 3b: % movimientos por %', v_pedidos, n; END IF;
  v_ok := v_ok || '3 ';

  -- 4
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF (public.mi_saldo_en_tienda(v_slug)->>'saldo')::numeric <> 500 THEN RAISE EXCEPTION 'FALLA 4a: saldo %', public.mi_saldo_en_tienda(v_slug); END IF;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'saldo_a_favor');
  IF NOT (r->>'pagado_con_saldo')::boolean OR (r->>'total')::numeric <> 400 THEN RAISE EXCEPTION 'FALLA 4b: %', r; END IF;
  IF (public.mi_saldo_en_tienda(v_slug)->>'saldo')::numeric <> 100 THEN RAISE EXCEPTION 'FALLA 4c: el saldo no bajó'; END IF;
  RESET ROLE;
  SELECT id INTO v_order FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = r->>'order_number';
  IF (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_order) <> 'paid' OR (SELECT total FROM public.ecommerce_orders WHERE id = v_order) <> 400 THEN
    RAISE EXCEPTION 'FALLA 4d: el pedido no quedó pagado por su total';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales WHERE ecommerce_order_id = v_order AND paid AND payment_method = 'saldo_a_favor') THEN
    RAISE EXCEPTION 'FALLA 4e: la venta no quedó pagada con saldo';
  END IF;
  v_ok := v_ok || '4 ';

  -- 5
  SELECT count(*) INTO v_pedidos FROM public.ecommerce_orders WHERE store_id = v_store;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'saldo_a_favor');
    RAISE EXCEPTION 'FALLA 5a: pagó con un saldo que no alcanzaba';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Anónimo', 'anon@invalid.test', NULL, v_envio, 'saldo_a_favor');
    RAISE EXCEPTION 'FALLA 5b: un anónimo pagó con saldo';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  IF (SELECT count(*) FROM public.ecommerce_orders WHERE store_id = v_store) <> v_pedidos THEN RAISE EXCEPTION 'FALLA 5c: quedó un pedido a medias'; END IF;
  v_ok := v_ok || '5';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
