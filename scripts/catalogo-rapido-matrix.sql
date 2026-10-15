-- Simulacro de 20261015000400 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Compara el catálogo nuevo con
-- get_store_catalog_products, campo por campo y en el mismo orden:
--   1. Sin promociones, en las dos tiendas.
--   2. Con promociones de prueba (todas, por producto, por categoría, una con
--      mínimo de compra que no debe aplicarse, y una vencida).
--   3. No expone org_id ni user_id.
--   4. Tiempo en Famatina.
CREATE TEMP TABLE zz_cmp ON COMMIT DROP AS SELECT 1;
DO $$
DECLARE v_slug text; v_org uuid; v_viejo jsonb; v_nuevo jsonb; v_prod uuid; v_cat text; t0 timestamptz; ms int;
BEGIN
  FOR v_slug IN SELECT slug FROM public.ecommerce_stores WHERE is_active LOOP
    FOR paso IN 1..2 LOOP
      IF paso = 2 THEN
        SELECT org_id INTO v_org FROM public.ecommerce_stores WHERE slug = v_slug;
        SELECT id, category INTO v_prod, v_cat FROM public.products WHERE org_id = v_org AND COALESCE(is_active, true) AND category IS NOT NULL LIMIT 1;
        INSERT INTO public.promotions (org_id, name, type, discount_value, applies_to, status) VALUES (v_org, 'ZZ todas', 'percentage', 10, 'all', 'active');
        INSERT INTO public.promotions (org_id, name, type, discount_value, applies_to, product_ids, status) VALUES (v_org, 'ZZ prod', 'fixed', 500, 'products', ARRAY[v_prod], 'active');
        INSERT INTO public.promotions (org_id, name, type, discount_value, applies_to, category_names, status) VALUES (v_org, 'ZZ cat', 'percentage', 25, 'categories', ARRAY[v_cat], 'active');
        INSERT INTO public.promotions (org_id, name, type, discount_value, applies_to, status, min_order_value) VALUES (v_org, 'ZZ minimo', 'percentage', 90, 'all', 'active', 1000);
        INSERT INTO public.promotions (org_id, name, type, discount_value, applies_to, status, ends_at) VALUES (v_org, 'ZZ vencida', 'percentage', 80, 'all', 'active', now() - interval '1 day');
      END IF;
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', r.id, 'name', r.name, 'brand', r.brand, 'category', r.category, 'gender', r.gender,
          'description', r.description, 'image_url', r.image_url, 'image_urls', r.image_urls,
          'sale_price_ars', r.sale_price_ars, 'discount_price_ars', r.discount_price_ars,
          'price_2x_ars', r.price_2x_ars, 'stock', r.stock, 'content_ml', r.content_ml,
          'total_sold', r.total_sold, 'featured', r.featured, 'created_at', r.created_at,
          'payment_base_price', r.payment_base_price, 'promo_price', r.promo_price) ORDER BY o), '[]'::jsonb)
        INTO v_viejo FROM public.get_store_catalog_products(v_slug) WITH ORDINALITY AS r(id, org_id, user_id, name, brand, category, gender, description, image_url, image_urls, sale_price_ars, discount_price_ars, price_2x_ars, stock, content_ml, total_sold, featured, offer_expires_at, created_at, decant_price_10ml, decant_price_5ml, decant_price_2_5ml, payment_base_price, promo_price, o);
      v_nuevo := public.get_store_catalog_completo(v_slug)::jsonb;
      -- Los nombres repetidos empatan en el orden viejo (sin desempate): se
      -- comparan los mismos productos y la misma secuencia de nombres.
      IF (SELECT jsonb_agg(n ORDER BY n->>'name' COLLATE "C", n->>'id') FROM jsonb_array_elements(v_nuevo) n)
         IS DISTINCT FROM (SELECT jsonb_agg(n ORDER BY n->>'name' COLLATE "C", n->>'id') FROM jsonb_array_elements(v_viejo) n)
         OR (SELECT jsonb_agg(n->'name') FROM jsonb_array_elements(v_nuevo) n) IS DISTINCT FROM (SELECT jsonb_agg(n->'name') FROM jsonb_array_elements(v_viejo) n) THEN
        RAISE EXCEPTION 'FALLA %/%: % vs % productos; primer distinto: %', v_slug, paso, jsonb_array_length(v_viejo), jsonb_array_length(v_nuevo),
          (SELECT a FROM jsonb_array_elements(v_viejo) WITH ORDINALITY x(a, i) JOIN jsonb_array_elements(v_nuevo) WITH ORDINALITY y(b, j) ON i = j WHERE a <> b LIMIT 1);
      END IF;
      IF paso = 2 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_nuevo) e WHERE e->>'promo_price' IS NOT NULL) THEN
        RAISE EXCEPTION 'FALLA 2: con promociones activas ningún producto tiene promo_price en %', v_slug;
      END IF;
    END LOOP;
  END LOOP;
  IF public.get_store_catalog_completo('exentryimports')::text ~ '"(org_id|user_id)"' THEN RAISE EXCEPTION 'FALLA 3: expone identificadores internos'; END IF;
  t0 := clock_timestamp();
  PERFORM public.get_store_catalog_completo('ferreteriafamatina');
  ms := extract(milliseconds FROM clock_timestamp() - t0)::int;
  RAISE EXCEPTION 'OK 1-3; Famatina en % ms, % KB', ms, length(public.get_store_catalog_completo('ferreteriafamatina')::text) / 1024;
END $$;

ROLLBACK;
