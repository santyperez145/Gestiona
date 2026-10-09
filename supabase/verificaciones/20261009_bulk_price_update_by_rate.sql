-- Actualización de precios por cotización. Datos ZZ; ROLLBACK.
BEGIN;
DO $$
DECLARE
  v_org uuid := gen_random_uuid(); v_other uuid := gen_random_uuid();
  v_owner uuid; v_viewer uuid; v_result jsonb; v_denied boolean;
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  SELECT id INTO v_viewer FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Bulk price', 'zz-bulk-price-' || v_org, v_owner), (v_other, 'ZZ Bulk other', 'zz-bulk-price-' || v_other, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_viewer, 'viewer'), (v_other, v_owner, 'owner');
  -- 1.500 productos: más que el tope de 1.000 que tenía la pantalla.
  INSERT INTO public.products(org_id, user_id, name, sale_price_ars, category, maneja_stock)
  SELECT v_org, v_owner, 'ZZ P' || g, 100, CASE WHEN g <= 500 THEN 'zz-herramientas' ELSE 'zz-otros' END, false
  FROM generate_series(1, 1500) g;
  INSERT INTO public.products(org_id, user_id, name, sale_price_ars, maneja_stock) VALUES (v_other, v_owner, 'ZZ Ajeno', 100, false);

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN PERFORM public.actualizar_precios_por_cotizacion(v_org, 'ZZ', 1000, 1100, 'keep_margin', 0);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'Un viewer actualizó precios';

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_result := public.actualizar_precios_por_cotizacion(v_org, 'ZZ dólar', 1000, 1100, 'keep_margin', 0, 'zz-herramientas');
  ASSERT (v_result->>'updated')::int = 500, 'Categoría mal acotada: ' || v_result;
  v_result := public.actualizar_precios_por_cotizacion(v_org, 'ZZ fijo', 1000, 1100, 'fixed_pct', 10);
  ASSERT (v_result->>'updated')::int = 1500, 'No actualizó todo el catálogo: ' || v_result;
  RESET ROLE;
  ASSERT (SELECT count(*) FROM public.products WHERE org_id = v_org AND category = 'zz-herramientas' AND sale_price_ars = 121) = 500, 'Precio herramientas';
  ASSERT (SELECT count(*) FROM public.products WHERE org_id = v_org AND category = 'zz-otros' AND sale_price_ars = 110) = 1000, 'Precio otros';
  ASSERT (SELECT sale_price_ars FROM public.products WHERE org_id = v_other) = 100, 'Tocó otra organización';
  ASSERT (SELECT array_agg(products_updated ORDER BY products_updated) FROM public.currency_price_updates WHERE org_id = v_org) = ARRAY[500, 1500], 'Registro inexacto';
  RAISE NOTICE 'OK: permisos, alcance, 1.500 productos, aislamiento y registro';
END;
$$;
ROLLBACK;
SELECT count(*) AS remaining_synthetic_organizations FROM public.organizations WHERE slug LIKE 'zz-bulk-price-%';
