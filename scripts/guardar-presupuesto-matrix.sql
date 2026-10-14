-- Simulacro de 20261014001000 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ con dos productos (uno con
-- variante) y otro negocio con un producto ajeno.
--   1. Crear: la base recalcula renglones y totales (ignora los del navegador),
--      numera y completa SKU y unidad desde el catálogo.
--   2. Un ítem libre (sin producto) se guarda tal cual.
--   3. Un producto de otro negocio se rechaza.
--   4. Una variante de otro producto se rechaza.
--   5. Un descuento general mayor al subtotal se rechaza.
--   6. Editar un presupuesto recalcula y conserva el número.
--   7. Un presupuesto vendido no se puede editar.
--   8. Un lector no puede crear presupuestos.
DO $$
DECLARE
  v_user uuid; v_lector uuid; v_org uuid; v_org2 uuid; p1 uuid; p2 uuid; v2 uuid; ajeno uuid; v_r jsonb; v_id uuid; v_num text;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_lector FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ presupuestos 2', 'zz-gp-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ otro', 'zz-gp2-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_lector, 'viewer'), (v_org2, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, sku, unidad_medida, sale_price_ars) VALUES (v_org, v_user, 'ZZ Cable', 'CAB-1', 'metro', 100) RETURNING id INTO p1;
  INSERT INTO public.products (org_id, user_id, name, sku, sale_price_ars) VALUES (v_org, v_user, 'ZZ Remera', 'REM', 5000) RETURNING id INTO p2;
  INSERT INTO public.product_variants (org_id, user_id, product_id, variant_name, sku) VALUES (v_org, v_user, p2, 'Talle M', 'REM-M') RETURNING id INTO v2;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars) VALUES (v_org2, v_user, 'ZZ Ajeno', 10) RETURNING id INTO ajeno;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1 y 2
  v_r := public.guardar_presupuesto(v_org, NULL, jsonb_build_object(
    'customer_name', 'ZZ Cliente', 'discount_amount', 100, 'subtotal', 1, 'total', 1,
    'items', jsonb_build_array(
      jsonb_build_object('productId', p1, 'qty', 12.5, 'unitPrice', 100, 'discountPct', 10, 'total', 1),
      jsonb_build_object('productId', p2, 'variantId', v2, 'qty', 2, 'unitPrice', 5000),
      jsonb_build_object('description', 'ZZ Flete', 'qty', 1, 'unitPrice', 3000))));
  v_id := (v_r->>'id')::uuid; v_num := v_r->>'quote_number';
  IF (v_r->>'subtotal')::numeric <> 14125 OR (v_r->>'total')::numeric <> 14025 OR v_num IS NULL OR v_num NOT LIKE 'PRE-%'
     OR v_r->'items'->0->>'description' <> 'ZZ Cable' OR v_r->'items'->0->>'unidad' <> 'metro' OR (v_r->'items'->0->>'total')::numeric <> 1125
     OR v_r->'items'->1->>'description' <> 'ZZ Remera · Talle M' OR v_r->'items'->1->>'sku' <> 'REM-M'
     OR v_r->'items'->2->>'description' <> 'ZZ Flete' OR v_r->'items'->2 ? 'productId' THEN
    RAISE EXCEPTION 'FALLA 1-2: %', v_r; END IF;

  -- 3
  BEGIN
    PERFORM public.guardar_presupuesto(v_org, NULL, jsonb_build_object('customer_name', 'ZZ', 'items', jsonb_build_array(jsonb_build_object('productId', ajeno, 'qty', 1, 'unitPrice', 1))));
    RAISE EXCEPTION 'FALLA 3: aceptó un producto ajeno';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 4
  BEGIN
    PERFORM public.guardar_presupuesto(v_org, NULL, jsonb_build_object('customer_name', 'ZZ', 'items', jsonb_build_array(jsonb_build_object('productId', p1, 'variantId', v2, 'qty', 1, 'unitPrice', 1))));
    RAISE EXCEPTION 'FALLA 4: aceptó una variante de otro producto';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 5
  BEGIN
    PERFORM public.guardar_presupuesto(v_org, NULL, jsonb_build_object('customer_name', 'ZZ', 'discount_amount', 999, 'items', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unitPrice', 10))));
    RAISE EXCEPTION 'FALLA 5: descuento mayor al subtotal';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 6
  v_r := public.guardar_presupuesto(v_org, v_id, jsonb_build_object('customer_name', 'ZZ Cliente', 'items', jsonb_build_array(jsonb_build_object('productId', p1, 'qty', 1, 'unitPrice', 100))));
  IF (v_r->>'total')::numeric <> 100 OR v_r->>'quote_number' <> v_num THEN RAISE EXCEPTION 'FALLA 6: %', v_r; END IF;

  -- 7
  RESET ROLE;
  PERFORM set_config('gestiona.presupuesto_convirtiendo', v_id::text, true);
  UPDATE public.quotes SET converted_transaction_id = gen_random_uuid(), converted_at = now() WHERE id = v_id;
  PERFORM set_config('gestiona.presupuesto_convirtiendo', '', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.guardar_presupuesto(v_org, v_id, jsonb_build_object('customer_name', 'ZZ Cliente', 'items', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unitPrice', 1))));
    RAISE EXCEPTION 'FALLA 7: editó un vendido';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  RESET ROLE;

  -- 8
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lector, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.guardar_presupuesto(v_org, NULL, jsonb_build_object('customer_name', 'ZZ', 'items', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unitPrice', 1))));
    RAISE EXCEPTION 'FALLA 8: un lector creó';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  RAISE EXCEPTION 'OK 1-8';
END $$;

ROLLBACK;
