-- Simulacro de 20261014001600 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ sin cotización cargada, con un
-- tornillo (stock 5) y un cable por metro (stock 0).
--   1. Una compra de dos productos comparte compra_id y el egreso la referencia.
--   2. Anular una compra pagada revierte el stock y borra el egreso.
--   3. Anular una compra a pagar sin pagos borra la cuenta del proveedor.
--   4. Con un pago registrado al proveedor, anular se rechaza y nada cambia.
--   5. Un vendedor no anula compras.
--   6. Recibir una orden en pesos sin cotización: 12,5 m entran como 12,5 (no
--      12), el costo queda en pesos y el número de la orden es el comprobante.
--   7. Lo recibido por una orden no se anula ni se borra desde Compras.
--   8. Una orden en dólares sin cotización no se recibe.
DO $$
DECLARE
  v_user uuid; v_vend uuid; v_org uuid; p1 uuid; p2 uuid; prov uuid; v_r jsonb; v_c1 uuid; v_c2 uuid; v_oc jsonb; v_oc_id uuid; v_item uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ compra completa', 'zz-cc-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;
  UPDATE public.settings SET exchange_rate = 0 WHERE org_id = v_org;
  INSERT INTO public.products (org_id, user_id, name, stock) VALUES (v_org, v_user, 'ZZ Tornillo', 5) RETURNING id INTO p1;
  INSERT INTO public.products (org_id, user_id, name, stock, unidad_medida) VALUES (v_org, v_user, 'ZZ Cable', 0, 'metro') RETURNING id INTO p2;
  INSERT INTO public.suppliers (org_id, name) VALUES (v_org, 'ZZ Distribuidora') RETURNING id INTO prov;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  v_r := public.registrar_compra(v_org, jsonb_build_object('proveedor_id', prov, 'comprobante', 'A-1', 'medio', 'efectivo', 'items', jsonb_build_array(
    jsonb_build_object('producto_id', p1, 'cantidad', 10, 'costo_unitario', 100),
    jsonb_build_object('producto_id', p2, 'cantidad', 2.5, 'costo_unitario', 40))));
  v_c1 := (v_r->>'compra_id')::uuid;
  RESET ROLE;
  IF v_c1 IS NULL OR (SELECT count(*) FROM public.purchases WHERE compra_id = v_c1) <> 2
     OR (SELECT source_id FROM public.financial_movements WHERE org_id = v_org) <> v_c1 THEN RAISE EXCEPTION 'FALLA 1: %', v_r; END IF;
  SET LOCAL ROLE authenticated;

  -- 2
  v_r := public.anular_compra(v_org, v_c1);
  RESET ROLE;
  IF (v_r->>'renglones')::int <> 2 OR (SELECT stock FROM public.products WHERE id = p1) <> 5 OR (SELECT stock FROM public.products WHERE id = p2) <> 0
     OR EXISTS (SELECT 1 FROM public.financial_movements WHERE org_id = v_org) OR EXISTS (SELECT 1 FROM public.purchases WHERE org_id = v_org)
     OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE org_id = v_org AND entity_type = 'purchase' AND entity_id = v_c1::text) THEN
    RAISE EXCEPTION 'FALLA 2: %', v_r; END IF;
  SET LOCAL ROLE authenticated;

  -- 3
  v_r := public.registrar_compra(v_org, jsonb_build_object('proveedor_id', prov, 'a_pagar', true, 'items', jsonb_build_array(
    jsonb_build_object('producto_id', p1, 'cantidad', 3, 'costo_unitario', 50))));
  PERFORM public.anular_compra(v_org, (v_r->>'compra_id')::uuid);
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.supplier_debts WHERE org_id = v_org) OR (SELECT stock FROM public.products WHERE id = p1) <> 5 THEN RAISE EXCEPTION 'FALLA 3'; END IF;
  SET LOCAL ROLE authenticated;

  -- 4
  v_r := public.registrar_compra(v_org, jsonb_build_object('proveedor_id', prov, 'a_pagar', true, 'items', jsonb_build_array(
    jsonb_build_object('producto_id', p1, 'cantidad', 4, 'costo_unitario', 50))));
  v_c2 := (v_r->>'compra_id')::uuid;
  UPDATE public.supplier_debts SET paid_ars = 100, status = 'partial' WHERE id = (v_r->>'deuda_id')::uuid;
  BEGIN
    PERFORM public.anular_compra(v_org, v_c2);
    RAISE EXCEPTION 'FALLA 4: anuló con pagos';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  IF (SELECT stock FROM public.products WHERE id = p1) <> 9 OR NOT EXISTS (SELECT 1 FROM public.supplier_debts WHERE purchase_id IS NOT NULL AND org_id = v_org) THEN RAISE EXCEPTION 'FALLA 4: cambió algo'; END IF;

  -- 5
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.anular_compra(v_org, v_c2);
    RAISE EXCEPTION 'FALLA 5: un vendedor anuló';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 6
  v_oc := public.guardar_orden_de_compra(v_org, NULL, jsonb_build_object('supplier_name', 'ZZ Distribuidora', 'currency', 'ARS', 'items', jsonb_build_array(
    jsonb_build_object('product_id', p2, 'quantity_ordered', 20, 'unit_cost', 40, 'tax_rate', 0))));
  v_oc_id := (v_oc->>'id')::uuid;
  UPDATE public.purchase_orders SET status = 'confirmed' WHERE id = v_oc_id;
  SELECT id INTO v_item FROM public.purchase_order_items WHERE order_id = v_oc_id;
  v_r := public.receive_purchase_order(v_oc_id, jsonb_build_array(jsonb_build_object('item_id', v_item, 'quantity', 12.5)));
  RESET ROLE;
  IF (SELECT stock FROM public.products WHERE id = p2) <> 12.5
     OR (SELECT quantity FROM public.purchases WHERE compra_id = (v_r->>'compra_id')::uuid) <> 12.5
     OR (SELECT total_ars FROM public.purchases WHERE compra_id = (v_r->>'compra_id')::uuid) <> 500
     OR (SELECT batch_name FROM public.purchases WHERE compra_id = (v_r->>'compra_id')::uuid) <> v_oc->>'order_number'
     OR v_r->>'status' <> 'partially_received' THEN
    RAISE EXCEPTION 'FALLA 6: % / stock %', v_r, (SELECT stock FROM public.products WHERE id = p2); END IF;
  SET LOCAL ROLE authenticated;

  -- 7
  BEGIN
    PERFORM public.anular_compra(v_org, (v_r->>'compra_id')::uuid);
    RAISE EXCEPTION 'FALLA 7: anuló lo recibido por una orden';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    DELETE FROM public.purchases WHERE compra_id = (v_r->>'compra_id')::uuid;
    RAISE EXCEPTION 'FALLA 7: borró lo recibido por una orden';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RESET ROLE;
  IF (SELECT stock FROM public.products WHERE id = p2) <> 12.5 THEN RAISE EXCEPTION 'FALLA 7: cambió el stock'; END IF;
  SET LOCAL ROLE authenticated;

  -- 8
  v_oc := public.guardar_orden_de_compra(v_org, NULL, jsonb_build_object('supplier_name', 'ZZ Distribuidora', 'currency', 'USD', 'items', jsonb_build_array(
    jsonb_build_object('product_id', p1, 'quantity_ordered', 2, 'unit_cost', 3, 'tax_rate', 0))));
  UPDATE public.purchase_orders SET status = 'confirmed' WHERE id = (v_oc->>'id')::uuid;
  SELECT id INTO v_item FROM public.purchase_order_items WHERE order_id = (v_oc->>'id')::uuid;
  BEGIN
    PERFORM public.receive_purchase_order((v_oc->>'id')::uuid, jsonb_build_array(jsonb_build_object('item_id', v_item, 'quantity', 2)));
    RAISE EXCEPTION 'FALLA 8: recibió en dólares sin cotización';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  RAISE EXCEPTION 'OK 1-8';
END $$;

ROLLBACK;
