-- Unificación de productos duplicados. Datos ZZ; ROLLBACK.
BEGIN;
DO $$
DECLARE
  v_org uuid := gen_random_uuid(); v_other uuid := gen_random_uuid();
  v_owner uuid; v_viewer uuid;
  k uuid := gen_random_uuid(); a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); s uuid := gen_random_uuid(); foreign_p uuid := gen_random_uuid();
  v_result jsonb; v_denied boolean;
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  SELECT id INTO v_viewer FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Merge', 'zz-merge-' || v_org, v_owner), (v_other, 'ZZ Merge other', 'zz-merge-' || v_other, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_viewer, 'viewer'), (v_other, v_owner, 'owner');
  INSERT INTO public.products(id, org_id, user_id, name, sale_price_ars, sku, barcode, barcode_aliases) VALUES
    (k, v_org, v_owner, 'ZZ Tornillo 6mm', 100, 'TOR-6', '7790001', ARRAY[]::text[]),
    (a, v_org, v_owner, 'ZZ tornillo 6 mm', 100, 'TOR6', '7790002', ARRAY['ALT-A']),
    (b, v_org, v_owner, 'ZZ Tornillo 6mm', 100, 'tor-6', NULL, ARRAY[]::text[]),
    (c, v_org, v_owner, 'ZZ Tornillo variante', 100, NULL, NULL, ARRAY[]::text[]),
    (s, v_org, v_owner, 'ZZ Servicio', 100, NULL, NULL, ARRAY[]::text[]),
    (foreign_p, v_other, v_owner, 'ZZ Ajeno', 100, NULL, NULL, ARRAY[]::text[]);
  UPDATE public.products SET maneja_stock = false WHERE id = s;
  PERFORM public.record_stock_movement(v_org, k, NULL, 'ZZ Tornillo 6mm', NULL, 'adjustment', 2, 'zz', NULL, NULL, NULL, 'zz', v_owner, NULL);
  PERFORM public.record_stock_movement(v_org, b, NULL, 'ZZ Tornillo 6mm', NULL, 'adjustment', 3, 'zz', NULL, NULL, NULL, 'zz', v_owner, NULL);
  INSERT INTO public.product_variants(org_id, product_id, user_id, variant_name) VALUES (v_org, c, v_owner, 'ZZ Rojo');

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN PERFORM public.unificar_productos(v_org, k, ARRAY[a]); EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'Un viewer unificó productos';

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_denied := false;
  BEGIN PERFORM public.unificar_productos(v_org, k, ARRAY[c]); EXCEPTION WHEN raise_exception THEN v_denied := SQLERRM LIKE '%variantes%'; END;
  ASSERT v_denied, 'Se unificó un producto con variantes';
  v_denied := false;
  BEGIN PERFORM public.unificar_productos(v_org, k, ARRAY[foreign_p]); EXCEPTION WHEN raise_exception THEN v_denied := true; END;
  ASSERT v_denied, 'Se unificó un producto de otra organización';
  v_denied := false;
  BEGIN PERFORM public.unificar_productos(v_org, s, ARRAY[b]); EXCEPTION WHEN raise_exception THEN v_denied := SQLERRM LIKE '%no maneja stock%'; END;
  ASSERT v_denied, 'Se perdió stock en un producto sin stock';

  v_result := public.unificar_productos(v_org, k, ARRAY[a, b]);
  RESET ROLE;
  ASSERT (v_result->>'eliminados')::int = 1 AND (v_result->>'archivados')::int = 1 AND (v_result->>'stock_trasladado')::int = 3, 'Resultado: ' || v_result;
  ASSERT NOT EXISTS (SELECT 1 FROM public.products WHERE id = a), 'El duplicado sin historia no se eliminó';
  ASSERT (SELECT NOT is_active AND stock = 0 AND sku IS NULL AND barcode IS NULL FROM public.products WHERE id = b), 'El duplicado con historia no se archivó limpio';
  ASSERT (SELECT stock FROM public.products WHERE id = k) = 5, 'Stock no trasladado';
  ASSERT (SELECT count(*) FROM public.stock_movements WHERE reference_type = 'product_merge' AND org_id = v_org) = 2, 'Kardex del traslado';
  ASSERT (SELECT barcode_aliases @> ARRAY['7790002', 'ALT-A', 'TOR6'] AND NOT ('TOR-6' = ANY(barcode_aliases)) AND NOT ('tor-6' = ANY(barcode_aliases)) FROM public.products WHERE id = k),
    'Códigos no trasladados: ' || (SELECT barcode_aliases::text FROM public.products WHERE id = k);
  ASSERT EXISTS (SELECT 1 FROM public.domain_events WHERE org_id = v_org AND event_type = 'producto.unificado'), 'Sin evento';
  RAISE NOTICE 'OK: permisos, variantes, tenant, stock sin manejo, eliminar/archivar, Kardex, alias y evento';
END;
$$;
ROLLBACK;
SELECT count(*) AS remaining_synthetic_organizations FROM public.organizations WHERE slug LIKE 'zz-merge-%';
