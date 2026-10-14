-- Simulacro de 20261014001200 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ con un producto y otro
-- negocio con un producto ajeno.
--   1. Crear: renglones y totales calculados en la base (antes quedaban en 0),
--      numeración OC-.
--   2. Editar reemplaza los renglones de una vez y conserva el número.
--   3. Un renglón inválido al editar no toca nada (todo o nada).
--   4. Un producto de otro negocio se rechaza.
--   5. Una orden con recepción parcial no se edita.
--   6. Un lector no crea órdenes.
DO $$
DECLARE
  v_user uuid; v_lector uuid; v_org uuid; v_org2 uuid; p1 uuid; ajeno uuid; v_r jsonb; v_id uuid; v_num text;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_lector FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ compras', 'zz-oc-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ otro', 'zz-oc2-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_lector, 'viewer'), (v_org2, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, sku) VALUES (v_org, v_user, 'ZZ Tornillo', 'TOR-6') RETURNING id INTO p1;
  INSERT INTO public.products (org_id, user_id, name) VALUES (v_org2, v_user, 'ZZ Ajeno') RETURNING id INTO ajeno;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  v_r := public.guardar_orden_de_compra(v_org, NULL, jsonb_build_object('supplier_name', 'ZZ Proveedor', 'currency', 'ARS', 'items', jsonb_build_array(
    jsonb_build_object('product_id', p1, 'quantity_ordered', 10, 'unit_cost', 2.5, 'tax_rate', 21),
    jsonb_build_object('product_name', 'ZZ Flete', 'quantity_ordered', 3, 'unit_cost', 100, 'tax_rate', 10.5))));
  v_id := (v_r->>'id')::uuid; v_num := v_r->>'order_number';
  IF (v_r->>'subtotal')::numeric <> 325 OR (v_r->>'tax_amount')::numeric <> 36.75 OR (v_r->>'total_amount')::numeric <> 361.75
     OR v_num NOT LIKE 'OC-%' OR (v_r->>'renglones')::int <> 2
     OR (SELECT sum(total_cost) FROM public.purchase_order_items WHERE order_id = v_id) <> 325
     OR (SELECT product_name || '|' || sku FROM public.purchase_order_items WHERE order_id = v_id AND product_id = p1) <> 'ZZ Tornillo|TOR-6' THEN
    RAISE EXCEPTION 'FALLA 1: %', v_r; END IF;

  -- 2
  v_r := public.guardar_orden_de_compra(v_org, v_id, jsonb_build_object('supplier_name', 'ZZ Proveedor', 'currency', 'ARS', 'items', jsonb_build_array(
    jsonb_build_object('product_id', p1, 'quantity_ordered', 4, 'unit_cost', 10, 'tax_rate', 0))));
  IF v_r->>'order_number' <> v_num OR (v_r->>'total_amount')::numeric <> 40
     OR (SELECT count(*) FROM public.purchase_order_items WHERE order_id = v_id) <> 1 THEN RAISE EXCEPTION 'FALLA 2: %', v_r; END IF;

  -- 3
  BEGIN
    PERFORM public.guardar_orden_de_compra(v_org, v_id, jsonb_build_object('supplier_name', 'ZZ', 'items', jsonb_build_array(
      jsonb_build_object('product_name', 'x', 'quantity_ordered', 0, 'unit_cost', 1))));
    RAISE EXCEPTION 'FALLA 3: aceptó cantidad cero';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF (SELECT count(*) FROM public.purchase_order_items WHERE order_id = v_id) <> 1 THEN RAISE EXCEPTION 'FALLA 3: se perdieron renglones'; END IF;

  -- 4
  BEGIN
    PERFORM public.guardar_orden_de_compra(v_org, NULL, jsonb_build_object('supplier_name', 'ZZ', 'items', jsonb_build_array(
      jsonb_build_object('product_id', ajeno, 'quantity_ordered', 1, 'unit_cost', 1))));
    RAISE EXCEPTION 'FALLA 4: aceptó un producto ajeno';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 5
  RESET ROLE;
  PERFORM set_config('gestiona.po_receipt_authority', 'on', true);
  UPDATE public.purchase_orders SET status = 'partially_received' WHERE id = v_id;
  PERFORM set_config('gestiona.po_receipt_authority', '', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.guardar_orden_de_compra(v_org, v_id, jsonb_build_object('supplier_name', 'ZZ', 'items', jsonb_build_array(
      jsonb_build_object('product_name', 'x', 'quantity_ordered', 1, 'unit_cost', 1))));
    RAISE EXCEPTION 'FALLA 5: editó una orden con recepción parcial';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  RESET ROLE;

  -- 6
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lector, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.guardar_orden_de_compra(v_org, NULL, jsonb_build_object('supplier_name', 'ZZ', 'items', jsonb_build_array(
      jsonb_build_object('product_name', 'x', 'quantity_ordered', 1, 'unit_cost', 1))));
    RAISE EXCEPTION 'FALLA 6: un lector creó una orden';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  RAISE EXCEPTION 'OK 1-6';
END $$;

ROLLBACK;
