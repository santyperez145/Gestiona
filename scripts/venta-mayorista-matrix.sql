-- Simulacro de 20261023000600 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. La cuenta corriente entra en los medios de la tienda sólo si se acepta,
--      y nunca en la lista pública.
--   2. El comprador no puede aprobarse solo; pide el alta con CUIT válido.
--   3. Aprobado con lista: el carrito le cobra su precio con tramos por
--      cantidad; un anónimo sigue pagando el minorista.
--   4. La compra mínima mayorista se exige en el checkout.
--   5. A cuenta corriente: entra si alcanza el crédito, el segundo pedido que
--      lo supera se rechaza, y al aprobarlo nace la venta sin cobrar con su deuda.
--   6. Un vendedor sin permiso no aprueba pedidos ni cuentas; en modo
--      exclusivo un anónimo no compra.
DO $$
DECLARE
  v_owner uuid; v_comp uuid; v_vend uuid; v_org uuid; v_store uuid; v_a uuid; v_b uuid; v_lista uuid; v_ficha uuid; v_cli uuid;
  v_slug text := 'zz-mayor-' || substr(md5(random()::text), 1, 8);
  r jsonb; v_pedido jsonb; v_order uuid; n numeric; v_ok text := '';
  v_items jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_comp FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id NOT IN (v_owner, v_comp) ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Mayorista', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_cost, shipping_mode, pickup_enabled, mayorista_modo, mayorista_minimo_ars, mayorista_cuenta_corriente)
  VALUES (v_org, v_slug, 'ZZ Mayorista', true, ARRAY['efectivo'], 0, 'free', true, 'mixto', 10000, true) RETURNING id INTO v_store;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Tornillo caja', 1000, 100) RETURNING id INTO v_a;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Tarugo caja', 500, 100) RETURNING id INTO v_b;
  INSERT INTO public.price_lists (org_id, name, discount_type, discount_value, is_active) VALUES (v_org, 'ZZ Mayorista 20', 'percentage', 20, true) RETURNING id INTO v_lista;
  INSERT INTO public.price_list_items (price_list_id, org_id, product_id, custom_price, discount_pct, min_quantity) VALUES
    (v_lista, v_org, v_a, NULL, 10, 1),
    (v_lista, v_org, v_a, 700, NULL, 10);

  -- 1
  IF NOT ((SELECT payment_methods FROM public.ecommerce_stores WHERE id = v_store) @> ARRAY['cuenta_corriente']) THEN RAISE EXCEPTION 'FALLA 1a: no agregó la cuenta corriente'; END IF;
  IF 'cuenta_corriente' = ANY(public.medios_de_pago_vivos(v_org, ARRAY['efectivo', 'cuenta_corriente'])) THEN RAISE EXCEPTION 'FALLA 1b: la cuenta corriente quedó en la lista pública'; END IF;
  UPDATE public.ecommerce_stores SET mayorista_cuenta_corriente = false WHERE id = v_store;
  IF (SELECT payment_methods FROM public.ecommerce_stores WHERE id = v_store) @> ARRAY['cuenta_corriente'] THEN RAISE EXCEPTION 'FALLA 1c: no la sacó al apagarla'; END IF;
  UPDATE public.ecommerce_stores SET mayorista_cuenta_corriente = true WHERE id = v_store;
  v_ok := v_ok || '1 ';

  -- 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.store_customers (store_id, org_id, user_id, email, mayorista_estado) VALUES (v_store, v_org, v_comp, 'comprador@invalid.test', 'aprobado') RETURNING id INTO v_ficha;
  UPDATE public.store_customers SET mayorista_estado = 'aprobado', phone = '1155555555' WHERE id = v_ficha;
  RESET ROLE;
  IF (SELECT mayorista_estado FROM public.store_customers WHERE id = v_ficha) <> 'ninguno' THEN RAISE EXCEPTION 'FALLA 2a: el comprador se aprobó solo'; END IF;
  IF (SELECT phone FROM public.store_customers WHERE id = v_ficha) <> '1155555555' THEN RAISE EXCEPTION 'FALLA 2b: no dejó editar su teléfono'; END IF;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.solicitar_cuenta_mayorista(v_slug, 'ZZ Ferretería del Centro SA', '30712345670');
    RAISE EXCEPTION 'FALLA 2c: aceptó un CUIT inválido';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.solicitar_cuenta_mayorista(v_slug, 'ZZ Ferretería del Centro SA', '30-71234567-1', '1155555555', 'Somos ferretería');
  IF r->>'estado' <> 'pendiente' THEN RAISE EXCEPTION 'FALLA 2d: %', r; END IF;
  RESET ROLE;
  -- Pendiente: todavía minorista. resolve_store_line es interna (la llama el
  -- checkout con privilegios): se prueba con la sesión del comprador puesta.
  PERFORM set_config('nerqia.store_id', v_store::text, true);
  r := public.resolve_store_line(v_org, v_a, NULL, 1);
  IF (r->'line'->>'unit_price')::numeric <> 1000 THEN RAISE EXCEPTION 'FALLA 2e: pendiente ya pagaba mayorista: %', r; END IF;
  v_ok := v_ok || '2 ';

  -- 6a: un vendedor no aprueba cuentas
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.resolver_cuenta_mayorista(v_ficha, true, NULL, v_lista, 15000, true);
    RAISE EXCEPTION 'FALLA 6a: un vendedor aprobó una cuenta';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  -- 3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.resolver_cuenta_mayorista(v_ficha, true, NULL, v_lista, 15000, true);
  RESET ROLE;
  v_cli := (r->>'customer_id')::uuid;
  IF (SELECT tax_id FROM public.customers WHERE id = v_cli) <> '30712345671' OR (SELECT price_list_id FROM public.customers WHERE id = v_cli) <> v_lista THEN
    RAISE EXCEPTION 'FALLA 3a: cliente mal creado: %', r;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  IF (public.resolve_store_line(v_org, v_a, NULL, 1)->'line'->>'unit_price')::numeric <> 900 THEN RAISE EXCEPTION 'FALLA 3b: tramo 1'; END IF;
  IF (public.resolve_store_line(v_org, v_a, NULL, 10)->'line'->>'unit_price')::numeric <> 700 THEN RAISE EXCEPTION 'FALLA 3c: tramo 10'; END IF;
  IF (public.resolve_store_line(v_org, v_b, NULL, 1)->'line'->>'unit_price')::numeric <> 400 THEN RAISE EXCEPTION 'FALLA 3d: descuento de la lista'; END IF;
  IF NOT (public.resolve_store_line(v_org, v_b, NULL, 1)->'line'->>'mayorista')::boolean THEN RAISE EXCEPTION 'FALLA 3e: no marca la línea mayorista'; END IF;
  SET LOCAL ROLE authenticated;
  r := public.get_store_precios_mayoristas(v_slug, ARRAY[v_a, v_b]);
  IF jsonb_array_length(r) <> 2 OR NOT (r @> jsonb_build_array(jsonb_build_object('product_id', v_a, 'tramos', jsonb_build_array(jsonb_build_object('desde', 1, 'precio', 900), jsonb_build_object('desde', 10, 'precio', 700))))) THEN
    RAISE EXCEPTION 'FALLA 3f: precios mayoristas: %', r;
  END IF;
  r := public.get_store_mayorista(v_slug);
  IF r->'comprador'->>'estado' <> 'aprobado' OR (r->'comprador'->>'credito_disponible')::numeric <> 15000 OR NOT (r->'comprador'->>'cuenta_corriente')::boolean THEN
    RAISE EXCEPTION 'FALLA 3g: estado del comprador: %', r;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF (public.resolve_store_line(v_org, v_a, NULL, 10)->'line'->>'unit_price')::numeric <> 1000 THEN RAISE EXCEPTION 'FALLA 3h: un anónimo pagó mayorista'; END IF;
  SET LOCAL ROLE anon;
  IF jsonb_array_length(public.get_store_precios_mayoristas(v_slug, ARRAY[v_a])) <> 0 THEN RAISE EXCEPTION 'FALLA 3i: un anónimo vio precios mayoristas'; END IF;
  RESET ROLE;
  v_ok := v_ok || '3 ';

  -- 4
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 5)),
      'ZZ Comprador', 'comprador@invalid.test', '1155555555', '{"provincia": "Buenos Aires"}'::jsonb, 'efectivo');
    RAISE EXCEPTION 'FALLA 4: aceptó un pedido mayorista debajo del mínimo';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE 'La compra mínima mayorista es de $ 10.000%' THEN RAISE EXCEPTION 'FALLA 4b: mensaje %', SQLERRM; END IF;
  END;
  v_ok := v_ok || '4 ';

  -- 5: 10 × 700 + 10 × 400 = 11.000, dentro de 15.000
  v_items := jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 10), jsonb_build_object('product_id', v_b, 'quantity', 10));
  v_pedido := public.create_store_order(v_slug, v_items, 'ZZ Comprador', 'comprador@invalid.test', '1155555555', '{"provincia": "Buenos Aires"}'::jsonb, 'cuenta_corriente');
  IF (v_pedido->>'subtotal')::numeric <> 11000 THEN RAISE EXCEPTION 'FALLA 5a: subtotal %', v_pedido; END IF;
  BEGIN
    PERFORM public.create_store_order(v_slug, v_items, 'ZZ Comprador', 'comprador@invalid.test', '1155555555', '{"provincia": "Buenos Aires"}'::jsonb, 'cuenta_corriente');
    RAISE EXCEPTION 'FALLA 5b: el segundo pedido superó el crédito';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE 'El pedido supera tu crédito disponible: te quedan $ 4.000 de $ 15.000%' THEN RAISE EXCEPTION 'FALLA 5c: mensaje %', SQLERRM; END IF;
  END;
  RESET ROLE;
  SELECT id INTO v_order FROM public.ecommerce_orders WHERE org_id = v_org AND payment_method = 'cuenta_corriente';

  -- 6b: un vendedor no aprueba el pedido
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.confirmar_pedido_cuenta_corriente(v_order);
    RAISE EXCEPTION 'FALLA 6b: un vendedor aprobó un pedido a cuenta';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.confirmar_pedido_cuenta_corriente(v_order);
  RESET ROLE;
  IF (r->>'ventas_creadas')::int <> 2 THEN RAISE EXCEPTION 'FALLA 5d: %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.sales WHERE ecommerce_order_id = v_order AND (paid OR customer_id <> v_cli OR payment_method <> 'cuenta_corriente')) THEN
    RAISE EXCEPTION 'FALLA 5e: las ventas no quedaron a cuenta del cliente';
  END IF;
  SELECT sum(remaining_ars) INTO n FROM public.debts WHERE customer_id = v_cli AND status = 'pending';
  IF n <> 11000 THEN RAISE EXCEPTION 'FALLA 5f: deuda %', n; END IF;
  IF (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_order) <> 'paid' THEN RAISE EXCEPTION 'FALLA 5g: el pedido no quedó aprobado'; END IF;
  v_ok := v_ok || '5 ';

  -- 5h: «Confirmar cobro» de un pedido en efectivo, por el comerciante logueado
  -- (antes chocaba siempre con la guardia de ventas).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_pedido := public.create_store_order(v_slug, v_items, 'ZZ Comprador', 'comprador@invalid.test', '1155555555', '{"provincia": "Buenos Aires"}'::jsonb, 'efectivo');
  RESET ROLE;
  SELECT id INTO v_order FROM public.ecommerce_orders WHERE org_id = v_org AND order_number = v_pedido->>'order_number';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.confirmar_pago_manual_tienda(v_order, 'ZZ efectivo en el local');
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.sales WHERE ecommerce_order_id = v_order AND paid) THEN RAISE EXCEPTION 'FALLA 5h: no confirmó el cobro en efectivo: %', r; END IF;
  IF current_setting('nerqia.cobro_servidor', true) = 'on' THEN RAISE EXCEPTION 'FALLA 5i: quedó encendida la marca de cobro del servidor'; END IF;

  -- 6c: modo exclusivo, un anónimo no compra
  UPDATE public.ecommerce_stores SET mayorista_modo = 'exclusivo' WHERE id = v_store;
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 20)),
      'ZZ Anónimo', 'anon@invalid.test', NULL, '{"provincia": "Buenos Aires"}'::jsonb, 'efectivo');
    RAISE EXCEPTION 'FALLA 6c: un anónimo compró en una tienda exclusiva';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '6';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
