-- Cantidades fraccionadas por unidad de medida. Datos ZZ; ROLLBACK.
-- Para ensayar la migración completa, ejecutar en el mismo BEGIN la captura
-- de permisos (zz_grants_antes) antes de 20261009000800 y este bloque después.
BEGIN;
DO $$
DECLARE
  v_org uuid := gen_random_uuid(); v_owner uuid; v_tx uuid := gen_random_uuid();
  v_cable uuid := gen_random_uuid(); v_martillo uuid := gen_random_uuid(); v_denied boolean;
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES (v_org, 'ZZ Fraccion', 'zz-fraccion-' || v_org, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner');
  INSERT INTO public.products(id, org_id, user_id, name, sale_price_ars, unidad_medida) VALUES
    (v_cable, v_org, v_owner, 'ZZ Cable 2,5mm', 850, 'metro'),
    (v_martillo, v_org, v_owner, 'ZZ Martillo', 9000, 'unidad');

  PERFORM public.record_stock_movement(v_org, v_cable, NULL, 'ZZ Cable', NULL, 'adjustment', 100.5, 'zz', NULL, NULL, NULL, 'zz', v_owner, NULL);
  ASSERT (SELECT stock FROM public.products WHERE id = v_cable) = 100.5, 'Stock fraccionado no registrado';

  v_denied := false;
  BEGIN PERFORM public.record_stock_movement(v_org, v_martillo, NULL, 'ZZ Martillo', NULL, 'adjustment', 1.5, 'zz', NULL, NULL, NULL, 'zz', v_owner, NULL);
  EXCEPTION WHEN raise_exception THEN v_denied := SQLERRM LIKE '%por unidad%'; END;
  ASSERT v_denied, 'Un producto por unidad aceptó una fracción';

  v_denied := false;
  BEGIN PERFORM public.record_stock_movement(v_org, v_cable, NULL, 'ZZ Cable', NULL, 'adjustment', 0.0001, 'zz', NULL, NULL, NULL, 'zz', v_owner, NULL);
  EXCEPTION WHEN raise_exception THEN v_denied := true; END;
  ASSERT v_denied, 'Más de tres decimales aceptados';

  -- Venta de 12,75 m por el trigger de ventas (misma autoridad que el POS).
  INSERT INTO public.sale_transactions(id, org_id, created_by, source) VALUES (v_tx, v_org, v_owner, 'pos');
  PERFORM set_config('gestiona.sale_transaction_id', v_tx::text, true);
  INSERT INTO public.sales(org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, payment_method, paid, source, sale_transaction_id)
  VALUES (v_org, v_owner, v_cable, 'ZZ Cable 2,5mm', 12.75, 850, 10837.5, 'efectivo', true, 'pos', v_tx);
  PERFORM set_config('gestiona.sale_transaction_id', '', true);
  ASSERT (SELECT stock FROM public.products WHERE id = v_cable) = 87.75, 'La venta fraccionada no descontó: ' || (SELECT stock FROM public.products WHERE id = v_cable);
  ASSERT EXISTS (SELECT 1 FROM public.stock_movements WHERE product_id = v_cable AND quantity = -12.75 AND stock_after = 87.75), 'Kardex fraccionado';

  -- Producto por unidad: el stock entero sigue funcionando igual.
  PERFORM public.record_stock_movement(v_org, v_martillo, NULL, 'ZZ Martillo', NULL, 'adjustment', 3, 'zz', NULL, NULL, NULL, 'zz', v_owner, NULL);
  ASSERT (SELECT stock FROM public.products WHERE id = v_martillo) = 3, 'Stock entero';
  RAISE NOTICE 'OK: metro fraccionado, unidad entera, tres decimales, venta y Kardex';
END;
$$;
ROLLBACK;
SELECT count(*) AS remaining_synthetic_organizations FROM public.organizations WHERE slug LIKE 'zz-fraccion-%';
