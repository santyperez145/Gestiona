-- Simulacro de 20261031000200 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
-- Un pedido pagado con 3 cables y 2 consolas en preventa.
--   1. Sale una parte con los cables: el pedido sigue «en preparación» y
--      quedan las 2 consolas.
--   2. No sale más de lo que queda, ni un renglón que no es del pedido, ni
--      una parte vacía.
--   3. Preparar, cargar seguimiento o marcar en camino el pedido entero se
--      niegan mientras hay partes.
--   4. La última parte deja el pedido en camino con su seguimiento; marcarlo
--      otra vez es idempotente y «entregado» alcanza a las dos partes.
--   5. El comprador ve las dos partes con sus productos.
--   6. Una entrega preparada y sin despachar pasa a ser la parte 1; un pedido
--      que salió entero no se despacha en partes.
--   7. La compradora no despacha; anon no llama; el aviso por parte se
--      reserva una vez y un evento inventado se rechaza.
DO $$
DECLARE
  v_owner uuid; v_comp uuid; v_email text; v_org uuid; v_store uuid; v_cable uuid; v_consola uuid;
  v_o1 uuid; v_o2 uuid; v_o3 uuid; v_n1 text; v_n2 text; v_n3 text; r jsonb; v_ok text := '';
  v_slug text := 'zz-partes-' || substr(md5(random()::text), 1, 8);
  v_envio jsonb := '{"provincia": "Buenos Aires", "ciudad": "La Plata", "calle": "Calle ZZ 123"}'::jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id, lower(email) INTO v_comp, v_email FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Partes', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  PERFORM public.ledger_plan_default(v_org);
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_cost, shipping_mode, pickup_enabled)
  VALUES (v_org, v_slug, 'ZZ Partes', true, ARRAY['transferencia'], 0, 'free', true) RETURNING id INTO v_store;
  INSERT INTO public.settings (org_id, user_id, bank_cbu, bank_alias, bank_holder)
  VALUES (v_org, v_owner, '0000003100000000000012', 'ZZ.PARTES', 'ZZ SRL')
  ON CONFLICT (org_id) DO UPDATE SET bank_cbu = EXCLUDED.bank_cbu, bank_alias = EXCLUDED.bank_alias, bank_holder = EXCLUDED.bank_holder;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Cable', 100, 20) RETURNING id INTO v_cable;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, preventa_cupo, expected_restock_at)
  VALUES (v_org, v_owner, 'ZZ Consola', 1000, 0, 5, public.hoy_ar() + 20) RETURNING id INTO v_consola;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(
         jsonb_build_object('product_id', v_cable, 'quantity', 3), jsonb_build_object('product_id', v_consola, 'quantity', 2)),
       'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  v_n1 := r->>'order_number';
  r := public.create_store_order(v_slug, jsonb_build_array(
         jsonb_build_object('product_id', v_cable, 'quantity', 1), jsonb_build_object('product_id', v_consola, 'quantity', 1)),
       'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  v_n2 := r->>'order_number';
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_cable, 'quantity', 2)),
       'ZZ Compradora', v_email, NULL, v_envio, 'transferencia');
  v_n3 := r->>'order_number';
  RESET ROLE;
  SELECT id INTO v_o1 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_n1;
  SELECT id INTO v_o2 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_n2;
  SELECT id INTO v_o3 FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = v_n3;
  IF (SELECT items->0->>'name' FROM public.ecommerce_orders WHERE id = v_o1) <> 'ZZ Cable' THEN
    RAISE EXCEPTION 'FALLA 0: el primer renglón no es el cable: %', (SELECT items FROM public.ecommerce_orders WHERE id = v_o1);
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirmar_pago_manual_tienda(v_o1, 'ZZ');
  PERFORM public.confirmar_pago_manual_tienda(v_o2, 'ZZ');
  PERFORM public.confirmar_pago_manual_tienda(v_o3, 'ZZ');

  -- 1
  r := public.despachar_parte_del_pedido(v_o1, '[{"linea": 0, "cantidad": 3}]'::jsonb, 'andreani', 'AND123');
  IF (r->>'completo')::boolean OR (r->>'parte')::int <> 1 OR (r->>'quedan')::numeric <> 2
     OR (SELECT fulfillment_status FROM public.ecommerce_orders WHERE id = v_o1) <> 'processing'
     OR (SELECT falta FROM public.pendiente_de_despacho(v_o1) WHERE linea = 0) <> 0
     OR (SELECT falta FROM public.pendiente_de_despacho(v_o1) WHERE linea = 1) <> 2
     OR (SELECT external_tracking FROM public.deliveries WHERE id = (r->>'delivery_id')::uuid) <> 'AND123'
     OR (SELECT status FROM public.deliveries WHERE id = (r->>'delivery_id')::uuid) <> 'in_transit' THEN
    RESET ROLE;
    RAISE EXCEPTION 'FALLA 1: %', r;
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  BEGIN
    PERFORM public.despachar_parte_del_pedido(v_o1, '[{"linea": 1, "cantidad": 3}]'::jsonb, 'andreani', 'X');
    RAISE EXCEPTION 'FALLA 2: despachó más de lo que queda';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%quedan 2 por despachar%' THEN RAISE EXCEPTION 'FALLA 2: mensaje %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.despachar_parte_del_pedido(v_o1, '[{"linea": 7, "cantidad": 1}]'::jsonb);
    RAISE EXCEPTION 'FALLA 2: despachó un renglón ajeno';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.despachar_parte_del_pedido(v_o1, '[]'::jsonb);
    RAISE EXCEPTION 'FALLA 2: despachó una parte vacía';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_ok := v_ok || '2 ';

  -- 3
  BEGIN
    PERFORM public.set_order_tracking(v_o1, 'oca', 'OCA999');
    RAISE EXCEPTION 'FALLA 3: cargó un seguimiento entero encima de las partes';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.prepare_order_shipment(v_o1, 'propio', NULL);
    RAISE EXCEPTION 'FALLA 3: preparó el pedido entero con partes';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.update_store_order_fulfillment(v_o1, 'shipped');
    RAISE EXCEPTION 'FALLA 3: marcó en camino el pedido entero con partes';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_ok := v_ok || '3 ';

  -- 4
  r := public.despachar_parte_del_pedido(v_o1, '[{"linea": 1, "cantidad": 2}]'::jsonb, 'andreani', 'AND456');
  IF NOT (r->>'completo')::boolean OR (r->>'parte')::int <> 2 OR r->>'tracking_code' <> 'ENV-' || v_n1 || '-2'
     OR (SELECT fulfillment_status FROM public.ecommerce_orders WHERE id = v_o1) <> 'shipped'
     OR (SELECT tracking_number FROM public.ecommerce_orders WHERE id = v_o1) <> 'AND456' THEN
    RESET ROLE;
    RAISE EXCEPTION 'FALLA 4: %', r;
  END IF;
  r := public.update_store_order_fulfillment(v_o1, 'shipped');
  IF (r->>'changed')::boolean THEN RESET ROLE; RAISE EXCEPTION 'FALLA 4: volver a marcar en camino cambió algo: %', r; END IF;
  PERFORM public.update_store_order_fulfillment(v_o1, 'delivered');
  IF (SELECT count(*) FROM public.deliveries WHERE ecommerce_order_id = v_o1 AND status = 'delivered') <> 2
     OR (SELECT fulfillment_status FROM public.ecommerce_orders WHERE id = v_o1) <> 'delivered' THEN
    RESET ROLE;
    RAISE EXCEPTION 'FALLA 4: entregado no alcanzó a las dos partes';
  END IF;
  v_ok := v_ok || '4 ';

  -- 5
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  r := public.get_order_tracking(v_n1, v_email);
  RESET ROLE;
  IF jsonb_array_length(r->'envios') <> 2 OR r->'envios'->0->'productos'->0->>'nombre' <> 'ZZ Cable'
     OR (r->'envios'->0->'productos'->0->>'cantidad')::numeric <> 3 OR r->'envios'->1->>'tracking' <> 'AND456' THEN
    RAISE EXCEPTION 'FALLA 5: %', r;
  END IF;
  v_ok := v_ok || '5 ';

  -- 6
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.prepare_order_shipment(v_o2, 'propio', NULL);
  r := public.despachar_parte_del_pedido(v_o2, '[{"linea": 0, "cantidad": 1}]'::jsonb, NULL, NULL);
  IF (SELECT count(*) FROM public.deliveries WHERE ecommerce_order_id = v_o2) <> 1
     OR (SELECT parte FROM public.deliveries WHERE ecommerce_order_id = v_o2) <> 1
     OR r->>'tracking_code' <> 'ENV-' || v_n2 THEN
    RESET ROLE;
    RAISE EXCEPTION 'FALLA 6: no usó la entrega preparada: %', r;
  END IF;
  PERFORM public.prepare_order_shipment(v_o3, 'propio', NULL);
  PERFORM public.set_order_tracking(v_o3, 'oca', 'OCA777');
  BEGIN
    PERFORM public.despachar_parte_del_pedido(v_o3, '[{"linea": 0, "cantidad": 1}]'::jsonb);
    RAISE EXCEPTION 'FALLA 6: despachó en partes un pedido que salió entero';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_ok := v_ok || '6 ';

  -- 7
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.despachar_parte_del_pedido(v_o2, '[{"linea": 1, "cantidad": 1}]'::jsonb);
    RAISE EXCEPTION 'FALLA 7: la compradora despachó';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  IF has_function_privilege('anon', 'public.despachar_parte_del_pedido(uuid, jsonb, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.pendiente_de_despacho(uuid)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM public.audit_funciones_expuestas WHERE funcion IN ('despachar_parte_del_pedido', 'get_order_tracking')) THEN
    RAISE EXCEPTION 'FALLA 7: permisos o contrato';
  END IF;
  r := public.claim_store_order_email(v_o2, 'buyer', 'parte_1', v_email, 300);
  IF NOT (r->>'claimed')::boolean THEN RAISE EXCEPTION 'FALLA 7: no reservó el aviso de la parte: %', r; END IF;
  r := public.claim_store_order_email(v_o2, 'buyer', 'parte_1', v_email, 300);
  IF (r->>'claimed')::boolean THEN RAISE EXCEPTION 'FALLA 7: reservó dos veces el aviso de la parte'; END IF;
  BEGIN
    PERFORM public.claim_store_order_email(v_o2, 'buyer', 'parte_x', v_email, 300);
    RAISE EXCEPTION 'FALLA 7: aceptó un evento inventado';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_ok := v_ok || '7';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
