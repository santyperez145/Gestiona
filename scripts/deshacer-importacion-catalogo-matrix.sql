-- Simulacro de 20261030000300 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Una importación actualiza dos productos y crea dos.
--   2. Después alguien cambia el precio de uno y se vende otro.
--   3. Deshacer: vuelve lo que nadie tocó, respeta lo cambiado, desactiva lo
--      creado sin movimientos, conserva lo que ya se movió, revierte el stock
--      sólo donde sigue igual. Una sola vez y sólo owner/admin.
DO $$
DECLARE
  v_owner uuid; v_view uuid; v_org uuid; v_p1 uuid; v_p2 uuid; v_q uuid; v_r uuid; v_batch uuid;
  v_slug text := 'zz-deshacer-' || substr(md5(random()::text), 1, 8);
  r jsonb; v_ok text := '';
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_view FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Deshacer', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_view, 'viewer') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  INSERT INTO public.products (org_id, user_id, name, sku, sale_price_ars, stock, description)
  VALUES (v_org, v_owner, 'ZZ Uno', 'ZZ-1', 100, 0, 'original') RETURNING id INTO v_p1;
  INSERT INTO public.products (org_id, user_id, name, sku, sale_price_ars, stock)
  VALUES (v_org, v_owner, 'ZZ Dos', 'ZZ-2', 300, 0) RETURNING id INTO v_p2;
  PERFORM public.record_stock_movement(v_org, v_p1, NULL, 'ZZ Uno', NULL, 'adjustment', 5, 'zz', NULL, NULL, NULL, 'ZZ', v_owner, NULL);
  PERFORM public.record_stock_movement(v_org, v_p2, NULL, 'ZZ Dos', NULL, 'adjustment', 5, 'zz', NULL, NULL, NULL, 'ZZ', v_owner, NULL);

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.stage_product_import(v_org, 'zz-tiendanube.csv', 'csv', jsonb_build_array(
    jsonb_build_object('name', 'ZZ Uno', 'sku', 'ZZ-1', 'sale_price_ars', 150, 'stock', 8, 'description', 'importada', 'provided', jsonb_build_array('name', 'sku', 'sale_price_ars', 'stock', 'description')),
    jsonb_build_object('name', 'ZZ Dos', 'sku', 'ZZ-2', 'sale_price_ars', 350, 'stock', 9, 'provided', jsonb_build_array('name', 'sku', 'sale_price_ars', 'stock')),
    jsonb_build_object('name', 'ZZ Nuevo', 'sku', 'ZZ-3', 'sale_price_ars', 50, 'stock', 3, 'provided', jsonb_build_array('name', 'sku', 'sale_price_ars', 'stock')),
    jsonb_build_object('name', 'ZZ Vendido', 'sku', 'ZZ-4', 'sale_price_ars', 60, 'stock', 4, 'provided', jsonb_build_array('name', 'sku', 'sale_price_ars', 'stock'))
  ));
  v_batch := (r->>'batch_id')::uuid;
  r := public.apply_product_import(v_batch, false);
  RESET ROLE;
  IF (SELECT sale_price_ars FROM public.products WHERE id = v_p1) <> 150 OR (SELECT stock FROM public.products WHERE id = v_p1) <> 8 THEN
    RAISE EXCEPTION 'FALLA 1a: la importación no se aplicó: %', r;
  END IF;
  IF (SELECT producto_antes->>'description' FROM public.product_import_rows WHERE batch_id = v_batch AND target_product_id = v_p1) <> 'original' THEN
    RAISE EXCEPTION 'FALLA 1b: no guardó la foto del producto';
  END IF;
  SELECT id INTO v_q FROM public.products WHERE org_id = v_org AND sku = 'ZZ-3';
  SELECT id INTO v_r FROM public.products WHERE org_id = v_org AND sku = 'ZZ-4';
  v_ok := v_ok || '1 ';

  -- 2: después de importar
  UPDATE public.products SET sale_price_ars = 999 WHERE id = v_p2;
  PERFORM public.record_stock_movement(v_org, v_p2, NULL, 'ZZ Dos', NULL, 'sale', -1, 'sale', NULL, NULL, NULL, 'ZZ', v_owner, NULL);
  PERFORM public.record_stock_movement(v_org, v_r, NULL, 'ZZ Vendido', NULL, 'sale', -1, 'sale', NULL, NULL, NULL, 'ZZ', v_owner, NULL);
  v_ok := v_ok || '2 ';

  -- 3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.deshacer_importacion_catalogo(v_batch);
    RAISE EXCEPTION 'FALLA 3a: un lector deshizo la importación';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.deshacer_importacion_catalogo(v_batch);
  RESET ROLE;
  IF (SELECT sale_price_ars FROM public.products WHERE id = v_p1) <> 100
     OR (SELECT description FROM public.products WHERE id = v_p1) <> 'original'
     OR (SELECT stock FROM public.products WHERE id = v_p1) <> 5 THEN
    RAISE EXCEPTION 'FALLA 3b: no volvió el producto intacto: %', r;
  END IF;
  IF (SELECT sale_price_ars FROM public.products WHERE id = v_p2) <> 999 OR (SELECT stock FROM public.products WHERE id = v_p2) <> 8 THEN
    RAISE EXCEPTION 'FALLA 3c: pisó cambios posteriores: %', r;
  END IF;
  IF (SELECT is_active FROM public.products WHERE id = v_q) OR (SELECT stock FROM public.products WHERE id = v_q) <> 0 THEN
    RAISE EXCEPTION 'FALLA 3d: el creado sin movimientos sigue activo o con stock: %', r;
  END IF;
  IF NOT (SELECT is_active FROM public.products WHERE id = v_r) THEN
    RAISE EXCEPTION 'FALLA 3e: desactivó un producto que ya vendió';
  END IF;
  IF (r->>'restaurados')::int <> 2 OR (r->>'con_cambios_posteriores')::int <> 1 OR (r->>'desactivados')::int <> 1
     OR (r->>'conservados_con_movimientos')::int <> 1 OR (r->>'stock_revertido')::int <> 2 OR (r->>'stock_cambiado_despues')::int <> 2 THEN
    RAISE EXCEPTION 'FALLA 3f: resumen %', r;
  END IF;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.deshacer_importacion_catalogo(v_batch);
    RAISE EXCEPTION 'FALLA 3g: se deshizo dos veces';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
