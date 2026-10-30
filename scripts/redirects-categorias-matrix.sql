-- Simulacro de 20261030000400 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Sólo owner/admin registra redirects de su importación.
--   2. Se registran las rutas válidas; las reservadas, inválidas o ya
--      existentes se omiten (un redirect de producto no se pisa).
--   3. La tienda resuelve la ruta vieja al catálogo filtrado.
--   4. Una importación deshecha no registra más.
DO $$
DECLARE
  v_owner uuid; v_view uuid; v_org uuid; v_store uuid; v_batch uuid; v_sesion uuid := gen_random_uuid();
  v_slug text := 'zz-redir-' || substr(md5(random()::text), 1, 8);
  r jsonb; v_ok text := '';
  v_lista jsonb := jsonb_build_array(
    jsonb_build_object('source_path', '/Hombre/Remeras/', 'category', 'hombre%20%3E%20remeras'),
    jsonb_build_object('source_path', '/productos/algo', 'category', 'remeras'),
    jsonb_build_object('source_path', '/a?b', 'category', 'remeras'),
    jsonb_build_object('source_path', '/ofertas', 'category', 'ofertas'));
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_view FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Redirects', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_view, 'viewer') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, published_at)
  VALUES (v_org, v_slug, 'ZZ Redirects', true, now()) RETURNING id INTO v_store;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.stage_product_import(v_org, 'zz.csv', 'csv', jsonb_build_array(
    jsonb_build_object('name', 'ZZ Remera', 'sku', 'ZZ-R', 'sale_price_ars', 10, 'provided', jsonb_build_array('name', 'sku', 'sale_price_ars'))));
  RESET ROLE;
  v_batch := (r->>'batch_id')::uuid;
  INSERT INTO public.catalog_import_sessions (id, org_id, created_by, filename, source_format, source_system, total, source_rows, options, status, prepared, applied)
  VALUES (v_sesion, v_org, v_owner, 'zz.csv', 'csv', 'tiendanube', 1, 1, jsonb_build_object('destination_store_id', v_store), 'completed', 1, 1);
  INSERT INTO public.catalog_import_chunks (session_id, org_id, position, batch_id, payload_hash, row_count)
  VALUES (v_sesion, v_org, 0, v_batch, 'zz', 1);
  INSERT INTO public.store_url_redirects (store_id, org_id, source_path, destination_path)
  VALUES (v_store, v_org, '/ofertas', '/producto/00000000-0000-0000-0000-000000000000');

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.registrar_redirects_categorias(v_sesion, v_lista);
    RAISE EXCEPTION 'FALLA 1: un lector registró redirects';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '1 ';

  -- 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.registrar_redirects_categorias(v_sesion, v_lista);
  RESET ROLE;
  IF (r->>'creados')::int <> 1 OR (r->>'omitidos')::int <> 3 THEN RAISE EXCEPTION 'FALLA 2a: %', r; END IF;
  IF (SELECT destination_path FROM public.store_url_redirects WHERE store_id = v_store AND source_path = '/ofertas') <> '/producto/00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION 'FALLA 2b: pisó un redirect existente';
  END IF;
  IF (SELECT import_batch_id FROM public.store_url_redirects WHERE store_id = v_store AND source_path = '/hombre/remeras') IS DISTINCT FROM v_batch THEN
    RAISE EXCEPTION 'FALLA 2c: el redirect no quedó atado al lote (deshacer no lo borraría)';
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  IF public.resolve_store_url_redirect(v_slug, '/hombre/remeras/') IS DISTINCT FROM '/productos?cat=hombre%20%3E%20remeras' THEN
    RAISE EXCEPTION 'FALLA 3: resolvió %', public.resolve_store_url_redirect(v_slug, '/hombre/remeras/');
  END IF;
  RESET ROLE;
  v_ok := v_ok || '3 ';

  -- 4
  UPDATE public.catalog_import_sessions SET deshecha_at = now() WHERE id = v_sesion;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.registrar_redirects_categorias(v_sesion, v_lista);
    RAISE EXCEPTION 'FALLA 4: registró en una importación deshecha';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '4';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
