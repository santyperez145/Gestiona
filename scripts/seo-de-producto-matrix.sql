-- Simulacro de 20261030000600 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Sin permiso de editar productos no se edita el SEO.
--   2. El comercio lo carga a mano.
--   3. La importación registra el SEO del archivo por identidad de origen y no
--      pisa lo manual.
--   4. El HTML para buscadores lo lee sólo de productos publicados.
--   5. Deshacer la importación se lleva su SEO; lo manual queda.
--   6. Vaciar los dos campos lo borra.
DO $$
DECLARE
  v_owner uuid; v_view uuid; v_org uuid; v_store uuid; v_a uuid; v_b uuid; v_sesion uuid := gen_random_uuid();
  v_slug text := 'zz-seo-' || substr(md5(random()::text), 1, 8);
  r jsonb; v_ok text := '';
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_view FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ SEO', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_view, 'viewer') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, published_at)
  VALUES (v_org, v_slug, 'ZZ SEO', true, now()) RETURNING id INTO v_store;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars) VALUES (v_org, v_owner, 'ZZ A', 100) RETURNING id INTO v_a;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars) VALUES (v_org, v_owner, 'ZZ B', 100) RETURNING id INTO v_b;
  INSERT INTO public.store_product_publications (store_id, product_id, org_id, visibility)
  VALUES (v_store, v_b, v_org, 'hidden');
  INSERT INTO public.catalog_import_sessions (id, org_id, created_by, filename, source_format, source_system, total, source_rows, options, status, prepared, applied)
  VALUES (v_sesion, v_org, v_owner, 'zz.csv', 'csv', 'tiendanube', 2, 2, '{}'::jsonb, 'completed', 2, 2);
  INSERT INTO public.catalog_import_identities (org_id, source_system, entity_type, external_key, product_id)
  VALUES (v_org, 'tiendanube', 'product', 'remera-a', v_a), (v_org, 'tiendanube', 'product', 'remera-b', v_b);

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.guardar_seo_producto(v_a, 'Título', NULL);
    RAISE EXCEPTION 'FALLA 1: un lector editó el SEO';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '1 ';

  -- 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.guardar_seo_producto(v_b, '  Manual   B  ', NULL);
  RESET ROLE;
  IF (SELECT titulo FROM public.product_seo WHERE product_id = v_b) <> 'Manual B' THEN RAISE EXCEPTION 'FALLA 2: %', r; END IF;
  v_ok := v_ok || '2 ';

  -- 3
  SET LOCAL ROLE authenticated;
  r := public.registrar_seo_importado(v_sesion, jsonb_build_array(
    jsonb_build_object('external_key', 'remera-a', 'titulo', 'Remera A de algodón', 'descripcion', 'La remera A'),
    jsonb_build_object('external_key', 'remera-b', 'titulo', 'Importado B'),
    jsonb_build_object('external_key', 'no-existe', 'titulo', 'X'),
    jsonb_build_object('external_key', 'remera-a', 'titulo', '', 'descripcion', '   ')));
  RESET ROLE;
  IF (r->>'guardados')::int <> 1 OR (r->>'omitidos')::int <> 3 THEN RAISE EXCEPTION 'FALLA 3a: %', r; END IF;
  IF (SELECT titulo FROM public.product_seo WHERE product_id = v_b) <> 'Manual B' THEN RAISE EXCEPTION 'FALLA 3b: pisó lo manual'; END IF;
  IF (SELECT origen FROM public.product_seo WHERE product_id = v_a) <> 'importado' THEN RAISE EXCEPTION 'FALLA 3c'; END IF;
  v_ok := v_ok || '3 ';

  -- 4
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  IF public.get_store_product_seo(v_slug, v_a)->>'titulo' IS DISTINCT FROM 'Remera A de algodón' THEN
    RAISE EXCEPTION 'FALLA 4a: %', public.get_store_product_seo(v_slug, v_a);
  END IF;
  IF public.get_store_product_seo(v_slug, v_b) IS NOT NULL THEN RAISE EXCEPTION 'FALLA 4b: mostró el SEO de un producto oculto'; END IF;
  RESET ROLE;
  v_ok := v_ok || '4 ';

  -- 5
  UPDATE public.catalog_import_sessions SET deshecha_at = now() WHERE id = v_sesion;
  IF EXISTS (SELECT 1 FROM public.product_seo WHERE product_id = v_a) THEN RAISE EXCEPTION 'FALLA 5a: quedó el SEO importado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.product_seo WHERE product_id = v_b) THEN RAISE EXCEPTION 'FALLA 5b: borró lo manual'; END IF;
  v_ok := v_ok || '5 ';

  -- 6
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.guardar_seo_producto(v_b, ' ', '');
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.product_seo WHERE product_id = v_b) THEN RAISE EXCEPTION 'FALLA 6: no lo borró'; END IF;
  v_ok := v_ok || '6';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
