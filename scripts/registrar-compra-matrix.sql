-- Simulacro de 20261014001500 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ con un tornillo (stock 5) y un
-- cable por metro (stock 0); otro negocio con un producto ajeno.
--   1. Compra pagada en pesos de dos productos: suma el stock, guarda el
--      comprobante y anota el egreso con el medio.
--   2. Compra a pagar: crea la cuenta del proveedor y no anota egreso.
--   3. Compra en dólares: guarda dólares y pesos con la cotización.
--   4. Producto ajeno o cantidad cero se rechazan; nada queda a medias.
--   5. Un vendedor no registra compras.
DO $$
DECLARE
  v_user uuid; v_vend uuid; v_org uuid; v_org2 uuid; p1 uuid; p2 uuid; ajeno uuid; prov uuid; v_r jsonb;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ compras 2', 'zz-rc-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ otro', 'zz-rc2-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor'), (v_org2, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, stock) VALUES (v_org, v_user, 'ZZ Tornillo', 5) RETURNING id INTO p1;
  INSERT INTO public.products (org_id, user_id, name, stock, unidad_medida) VALUES (v_org, v_user, 'ZZ Cable', 0, 'metro') RETURNING id INTO p2;
  INSERT INTO public.products (org_id, user_id, name) VALUES (v_org2, v_user, 'ZZ Ajeno') RETURNING id INTO ajeno;
  INSERT INTO public.suppliers (org_id, name) VALUES (v_org, 'ZZ Distribuidora') RETURNING id INTO prov;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  v_r := public.registrar_compra(v_org, jsonb_build_object('proveedor_id', prov, 'comprobante', 'A-0001-123', 'moneda', 'ARS', 'cotizacion', 1000,
    'medio', 'transferencia', 'items', jsonb_build_array(
      jsonb_build_object('producto_id', p1, 'cantidad', 10, 'costo_unitario', 100),
      jsonb_build_object('producto_id', p2, 'cantidad', 12.5, 'costo_unitario', 40))));
  RESET ROLE;
  IF (v_r->>'total_ars')::numeric <> 1500 OR (SELECT stock FROM public.products WHERE id = p1) <> 15 OR (SELECT stock FROM public.products WHERE id = p2) <> 12.5
     OR (SELECT count(*) FROM public.purchases WHERE org_id = v_org AND batch_name = 'A-0001-123' AND supplier = 'ZZ Distribuidora') <> 2
     OR (SELECT amount_ars FROM public.financial_movements WHERE org_id = v_org AND source_type = 'supplier_payment') <> 1500
     OR (SELECT channel FROM public.financial_movements WHERE org_id = v_org) <> 'bank' THEN
    RAISE EXCEPTION 'FALLA 1: %', v_r; END IF;
  SET LOCAL ROLE authenticated;

  -- 2
  v_r := public.registrar_compra(v_org, jsonb_build_object('proveedor_id', prov, 'comprobante', 'A-0001-124', 'a_pagar', true, 'vencimiento', '2026-11-30',
    'items', jsonb_build_array(jsonb_build_object('producto_id', p1, 'cantidad', 1, 'costo_unitario', 500))));
  RESET ROLE;
  IF (SELECT remaining_ars FROM public.supplier_debts WHERE id = (v_r->>'deuda_id')::uuid) <> 500
     OR (SELECT count(*) FROM public.financial_movements WHERE org_id = v_org) <> 1 THEN RAISE EXCEPTION 'FALLA 2: %', v_r; END IF;
  SET LOCAL ROLE authenticated;

  -- 3
  v_r := public.registrar_compra(v_org, jsonb_build_object('moneda', 'USD', 'cotizacion', 1200,
    'items', jsonb_build_array(jsonb_build_object('producto_id', p1, 'cantidad', 2, 'costo_unitario', 3.5))));
  RESET ROLE;
  IF (v_r->>'total_ars')::numeric <> 8400 OR (SELECT total_usd FROM public.purchases WHERE org_id = v_org AND total_ars = 8400) <> 7 THEN RAISE EXCEPTION 'FALLA 3: %', v_r; END IF;
  SET LOCAL ROLE authenticated;

  -- 4
  BEGIN
    PERFORM public.registrar_compra(v_org, jsonb_build_object('items', jsonb_build_array(
      jsonb_build_object('producto_id', p1, 'cantidad', 1, 'costo_unitario', 1),
      jsonb_build_object('producto_id', ajeno, 'cantidad', 1, 'costo_unitario', 1))));
    RAISE EXCEPTION 'FALLA 4: aceptó un producto ajeno';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.registrar_compra(v_org, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('producto_id', p1, 'cantidad', 0, 'costo_unitario', 1))));
    RAISE EXCEPTION 'FALLA 4: cantidad cero';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  IF (SELECT stock FROM public.products WHERE id = p1) <> 18 THEN RAISE EXCEPTION 'FALLA 4: quedó stock a medias (%)', (SELECT stock FROM public.products WHERE id = p1); END IF;

  -- 5
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.registrar_compra(v_org, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('producto_id', p1, 'cantidad', 1, 'costo_unitario', 1))));
    RAISE EXCEPTION 'FALLA 5: un vendedor registró una compra';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  RAISE EXCEPTION 'OK 1-5';
END $$;

ROLLBACK;
