-- Simulacro de 20261031000100 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ con una remera (costo en
-- pesos), una gorra (sin costo: adopta dólares) y una taza; otro negocio.
--   1. Flete en dólares pagado, por valor: parte exacta a cada renglón, costo
--      puesto en pesos y en dólares, egreso por banco.
--   2. Despachante a pagar, por cantidad, con IVA: el IVA va a la cuenta del
--      despachante y no al costo; la cuenta no se cuelga de la compra.
--   3. Por peso: sin pesos se rechaza con los productos; con pesos reparte.
--      «Ya registrado» no crea cuenta ni egreso.
--   4. Una compra posterior de la gorra fija su costo: un gasto nuevo de la
--      compra vieja no lo pisa.
--   5. Redondeo: $100 entre tres renglones iguales suma exacto.
--   6. Quitar un gasto recalcula y borra su egreso; con pagos se niega.
--   7. Anular la compra se niega si un gasto tiene pagos; si no, se lleva los
--      gastos, su cuenta y su egreso.
--   8. Un vendedor no carga gastos; otro negocio no ve la compra; el navegador
--      no escribe la tabla ni llama al reparto.
DO $$
DECLARE
  v_user uuid; v_vend uuid; v_org uuid; v_org2 uuid;
  pa uuid; pb uuid; pc uuid; prov uuid; desp uuid;
  c1 uuid; c3 uuid; v_r jsonb; g_flete uuid; g_desp uuid; v_deuda uuid;
  v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ gastos', 'zz-gc-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ gastos otro', 'zz-gc2-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor'), (v_org2, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, stock, cost_ars, cost_currency) VALUES (v_org, v_user, 'ZZ Remera', 0, 1, 'ARS') RETURNING id INTO pa;
  INSERT INTO public.products (org_id, user_id, name, stock) VALUES (v_org, v_user, 'ZZ Gorra', 0) RETURNING id INTO pb;
  INSERT INTO public.products (org_id, user_id, name, stock, cost_ars, cost_currency) VALUES (v_org, v_user, 'ZZ Taza', 0, 1, 'ARS') RETURNING id INTO pc;
  INSERT INTO public.suppliers (org_id, name) VALUES (v_org, 'ZZ Fábrica') RETURNING id INTO prov;
  INSERT INTO public.suppliers (org_id, name) VALUES (v_org, 'ZZ Despachante') RETURNING id INTO desp;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- La compra: 10 remeras y 30 gorras a USD 10, cotización 1000.
  v_r := public.registrar_compra(v_org, jsonb_build_object('proveedor_id', prov, 'comprobante', 'E-0001-7', 'moneda', 'USD', 'cotizacion', 1000,
    'fecha', '2026-10-20', 'medio', 'transferencia', 'items', jsonb_build_array(
      jsonb_build_object('producto_id', pa, 'cantidad', 10, 'costo_unitario', 10),
      jsonb_build_object('producto_id', pb, 'cantidad', 30, 'costo_unitario', 10))));
  c1 := (v_r->>'compra_id')::uuid;

  -- 1
  v_r := public.agregar_gasto_a_compra(v_org, c1, jsonb_build_object('concepto', 'flete', 'moneda', 'USD', 'monto', 40, 'cotizacion', 1000,
    'reparto', 'valor', 'pago', 'pagado', 'medio', 'transferencia', 'proveedor', 'ZZ Forwarder'));
  g_flete := (v_r->>'gasto_id')::uuid;
  RESET ROLE;
  IF (SELECT gastos_ars FROM public.purchases WHERE compra_id = c1 AND product_id = pa) <> 10000
     OR (SELECT gastos_ars FROM public.purchases WHERE compra_id = c1 AND product_id = pb) <> 30000
     OR (SELECT gastos_usd FROM public.purchases WHERE compra_id = c1 AND product_id = pb) <> 30
     OR (SELECT cost_ars FROM public.products WHERE id = pa) <> 11000
     OR (SELECT total_cost_usd FROM public.products WHERE id = pb) <> 11
     OR (SELECT cost_usd FROM public.products WHERE id = pb) <> 11
     OR (SELECT amount_ars FROM public.financial_movements WHERE org_id = v_org AND source_id = g_flete) <> 40000
     OR (SELECT channel FROM public.financial_movements WHERE org_id = v_org AND source_id = g_flete) <> 'bank'
     OR (v_r->>'costos_actualizados')::int <> 2 THEN
    RAISE EXCEPTION 'FALLA 1: % · remera % · gorra %', v_r,
      (SELECT cost_ars FROM public.products WHERE id = pa), (SELECT total_cost_usd FROM public.products WHERE id = pb);
  END IF;
  v_ok := v_ok || '1';
  SET LOCAL ROLE authenticated;

  -- 2
  v_r := public.agregar_gasto_a_compra(v_org, c1, jsonb_build_object('concepto', 'despachante', 'moneda', 'ARS', 'monto', 12000, 'impuestos', 2520,
    'cotizacion', 1000, 'reparto', 'cantidad', 'pago', 'a_pagar', 'proveedor_id', desp, 'comprobante', 'A-0003-55', 'vencimiento', '2026-11-30'));
  g_desp := (v_r->>'gasto_id')::uuid;
  v_deuda := (v_r->>'deuda_id')::uuid;
  RESET ROLE;
  IF (SELECT amount_ars FROM public.supplier_debts WHERE id = v_deuda) <> 14520
     OR (SELECT purchase_id FROM public.supplier_debts WHERE id = v_deuda) IS NOT NULL
     OR (SELECT supplier_name FROM public.supplier_debts WHERE id = v_deuda) <> 'ZZ Despachante'
     OR (SELECT cost_ars FROM public.products WHERE id = pa) <> 11300
     OR (SELECT total_cost_usd FROM public.products WHERE id = pb) <> 11.3
     OR (SELECT count(*) FROM public.financial_movements WHERE org_id = v_org) <> 2 THEN
    RAISE EXCEPTION 'FALLA 2: % · remera %', v_r, (SELECT cost_ars FROM public.products WHERE id = pa);
  END IF;
  v_ok := v_ok || '2';
  SET LOCAL ROLE authenticated;

  -- 3
  BEGIN
    PERFORM public.agregar_gasto_a_compra(v_org, c1, jsonb_build_object('concepto', 'deposito', 'monto', 5000, 'reparto', 'peso', 'pago', 'registrado'));
    RAISE EXCEPTION 'FALLA 3: repartió por peso sin pesos';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%cargá el peso de%ZZ%' THEN RAISE EXCEPTION 'FALLA 3: mensaje %', SQLERRM; END IF;
  END;
  RESET ROLE;
  UPDATE public.products SET weight_kg = 0.2 WHERE id = pa;
  UPDATE public.products SET weight_kg = 0.1 WHERE id = pb;
  SET LOCAL ROLE authenticated;
  v_r := public.agregar_gasto_a_compra(v_org, c1, jsonb_build_object('concepto', 'deposito', 'monto', 5000, 'cotizacion', 1000,
    'reparto', 'peso', 'pago', 'registrado'));
  RESET ROLE;
  -- Pesos: remeras 10 × 0,2 = 2 kg; gorras 30 × 0,1 = 3 kg.
  IF (SELECT gastos_ars FROM public.purchases WHERE compra_id = c1 AND product_id = pa) <> 15000
     OR (SELECT cost_ars FROM public.products WHERE id = pa) <> 11500
     OR (SELECT total_cost_usd FROM public.products WHERE id = pb) <> 11.4
     OR (SELECT count(*) FROM public.supplier_debts WHERE org_id = v_org) <> 1
     OR (SELECT count(*) FROM public.financial_movements WHERE org_id = v_org) <> 2 THEN
    RAISE EXCEPTION 'FALLA 3: % · remera %', v_r, (SELECT cost_ars FROM public.products WHERE id = pa);
  END IF;
  v_ok := v_ok || '3';
  SET LOCAL ROLE authenticated;

  -- 4
  PERFORM public.registrar_compra(v_org, jsonb_build_object('moneda', 'ARS', 'cotizacion', 1000, 'fecha', '2026-10-25',
    'items', jsonb_build_array(jsonb_build_object('producto_id', pb, 'cantidad', 5, 'costo_unitario', 12000))));
  v_r := public.agregar_gasto_a_compra(v_org, c1, jsonb_build_object('concepto', 'seguro', 'monto', 4000, 'cotizacion', 1000,
    'reparto', 'valor', 'pago', 'registrado'));
  RESET ROLE;
  IF (SELECT total_cost_usd FROM public.products WHERE id = pb) <> 12
     OR (SELECT cost_ars FROM public.products WHERE id = pa) <> 11600
     OR (v_r->>'con_compra_posterior')::int <> 1 OR (v_r->>'costos_actualizados')::int <> 1 THEN
    RAISE EXCEPTION 'FALLA 4: % · gorra %', v_r, (SELECT total_cost_usd FROM public.products WHERE id = pb);
  END IF;
  v_ok := v_ok || '4';
  SET LOCAL ROLE authenticated;

  -- 5
  v_r := public.registrar_compra(v_org, jsonb_build_object('moneda', 'ARS', 'items', jsonb_build_array(
    jsonb_build_object('producto_id', pc, 'cantidad', 1, 'costo_unitario', 100),
    jsonb_build_object('producto_id', pc, 'cantidad', 1, 'costo_unitario', 100),
    jsonb_build_object('producto_id', pc, 'cantidad', 1, 'costo_unitario', 100))));
  c3 := (v_r->>'compra_id')::uuid;
  PERFORM public.agregar_gasto_a_compra(v_org, c3, jsonb_build_object('concepto', 'flete_local', 'monto', 100, 'pago', 'registrado'));
  IF (SELECT count(*) FROM public.compra_gastos WHERE compra_id = c3) <> 1 THEN
    RAISE EXCEPTION 'FALLA 5: el dueño no lee los gastos';
  END IF;
  RESET ROLE;
  IF (SELECT sum(gastos_ars) FROM public.purchases WHERE compra_id = c3) <> 100
     OR (SELECT min(gastos_ars) FROM public.purchases WHERE compra_id = c3) < 33.33
     OR (SELECT max(gastos_ars) FROM public.purchases WHERE compra_id = c3) > 33.34
     OR (SELECT cost_ars FROM public.products WHERE id = pc) <> 133.33 THEN
    RAISE EXCEPTION 'FALLA 5: % · taza %', (SELECT array_agg(gastos_ars) FROM public.purchases WHERE compra_id = c3),
      (SELECT cost_ars FROM public.products WHERE id = pc);
  END IF;
  v_ok := v_ok || '5';
  SET LOCAL ROLE authenticated;

  -- 6
  v_r := public.quitar_gasto_de_compra(v_org, g_flete);
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.financial_movements WHERE source_id = g_flete)
     OR (SELECT cost_ars FROM public.products WHERE id = pa) <> 10600
     OR (SELECT total_cost_usd FROM public.products WHERE id = pb) <> 12 THEN
    RAISE EXCEPTION 'FALLA 6: % · remera %', v_r, (SELECT cost_ars FROM public.products WHERE id = pa);
  END IF;
  UPDATE public.supplier_debts SET paid_ars = 100 WHERE id = v_deuda;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.quitar_gasto_de_compra(v_org, g_desp);
    RAISE EXCEPTION 'FALLA 6: quitó un gasto con pagos';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_ok := v_ok || '6';

  -- 7
  BEGIN
    PERFORM public.anular_compra(v_org, c1);
    RAISE EXCEPTION 'FALLA 7: anuló con un gasto pagado';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%gastos de esta compra%' THEN RAISE EXCEPTION 'FALLA 7: mensaje %', SQLERRM; END IF;
  END;
  RESET ROLE;
  UPDATE public.supplier_debts SET paid_ars = 0 WHERE id = v_deuda;
  SET LOCAL ROLE authenticated;
  v_r := public.anular_compra(v_org, c1);
  RESET ROLE;
  IF (v_r->>'gastos')::int <> 3
     OR EXISTS (SELECT 1 FROM public.compra_gastos WHERE compra_id = c1)
     OR EXISTS (SELECT 1 FROM public.supplier_debts WHERE id = v_deuda)
     OR EXISTS (SELECT 1 FROM public.purchases WHERE compra_id = c1)
     OR EXISTS (SELECT 1 FROM public.financial_movements WHERE org_id = v_org AND source_id = c1)
     OR (SELECT stock FROM public.products WHERE id = pa) <> 0 THEN
    RAISE EXCEPTION 'FALLA 7: %', v_r;
  END IF;
  v_ok := v_ok || '7';

  -- 8
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.agregar_gasto_a_compra(v_org, c3, jsonb_build_object('concepto', 'flete', 'monto', 1, 'pago', 'registrado'));
    RAISE EXCEPTION 'FALLA 8: un vendedor cargó un gasto';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.agregar_gasto_a_compra(v_org2, c3, jsonb_build_object('concepto', 'flete', 'monto', 1, 'pago', 'registrado'));
    RAISE EXCEPTION 'FALLA 8: cargó un gasto a la compra de otro negocio';
  EXCEPTION WHEN no_data_found THEN NULL; END;
  BEGIN
    INSERT INTO public.compra_gastos (org_id, compra_id, concepto, monto, monto_ars, pago, fecha)
    VALUES (v_org, c3, 'flete', 1, 1, 'registrado', current_date);
    RAISE EXCEPTION 'FALLA 8: el navegador escribió la tabla';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.agregar_gasto_a_compra(v_org, c3, jsonb_build_object('concepto', 'otro', 'monto', 1, 'pago', 'registrado'));
    RAISE EXCEPTION 'FALLA 8: aceptó «otro» sin detalle';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  IF has_function_privilege('authenticated', 'public.repartir_gastos_de_compra(uuid, uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.agregar_gasto_a_compra(uuid, uuid, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.quitar_gasto_de_compra(uuid, uuid, boolean)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM public.audit_funciones_expuestas WHERE funcion IN ('agregar_gasto_a_compra', 'quitar_gasto_de_compra', 'anular_compra')) THEN
    RAISE EXCEPTION 'FALLA 8: permisos de las funciones';
  END IF;
  v_ok := v_ok || '8';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
