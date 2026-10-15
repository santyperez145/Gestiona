-- La tienda muestra productos antes de bajar el catálogo entero.
--
-- Medido el 2026-10-15 en Famatina (11.518 productos): aun con el catálogo
-- completo optimizado (20261015000400), bajar 5,5 MB tardaba ~3,4 s y los
-- productos aparecían a los ~5,5 s. `get_store_catalog_inicio` devuelve los
-- primeros N productos en el orden final de la tienda (con stock primero) y el
-- total: la vitrina los muestra enseguida y el catálogo completo llega detrás.
-- Mismas reglas, campos y promociones que get_store_catalog_completo; lo
-- comprueba scripts/catalogo-inicio-matrix.sql.
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_store_catalog_inicio(p_slug text, p_limite integer DEFAULT 48)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH tienda AS (
    SELECT s.id, s.org_id, s.payment_discount_stacks
    FROM public.ecommerce_stores s
    WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active
  ),
  promos AS MATERIALIZED (
    SELECT pr.type, pr.discount_value, pr.applies_to, pr.product_ids, pr.category_names
    FROM public.promotions pr
    JOIN tienda t ON t.org_id = pr.org_id
    WHERE pr.status = 'active'
      AND pr.coupon_code IS NULL
      AND pr.type IN ('percentage', 'fixed')
      AND (pr.starts_at IS NULL OR pr.starts_at <= now())
      AND (pr.ends_at IS NULL OR pr.ends_at > now())
      AND COALESCE(pr.min_order_value, 0) <= 0
  ),
  filas AS (
    SELECT
      product.id, product.name, product.brand,
      COALESCE(publication.category_slug, product.category) AS category,
      product.gender, product.description, product.image_url, product.image_urls,
      CASE WHEN publication.price_ars IS NOT NULL
        THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
        ELSE product.sale_price_ars END AS sale_price_ars,
      CASE
        WHEN publication.price_ars IS NOT NULL AND publication.compare_at_price_ars > publication.price_ars
          THEN publication.price_ars
        WHEN publication.price_ars IS NULL THEN product.discount_price_ars
        ELSE NULL::numeric
      END AS discount_price_ars,
      product.price_2x_ars, product.stock, product.content_ml, product.total_sold,
      COALESCE(publication.featured, product.featured, false) AS featured,
      product.created_at,
      CASE WHEN COALESCE(product.offer_stacks_payment, t.payment_discount_stacks, false)
        THEN COALESCE(
          CASE WHEN publication.price_ars IS NOT NULL THEN publication.price_ars END,
          NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
        ELSE CASE WHEN publication.price_ars IS NOT NULL
          THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
          ELSE product.sale_price_ars END
      END AS payment_base_price,
      COALESCE(publication.sort_order, 2147483647) AS orden,
      product.org_id
    FROM tienda t
    JOIN public.products product ON product.org_id = t.org_id
    LEFT JOIN public.store_product_publications publication
      ON publication.store_id = t.id AND publication.product_id = product.id
    WHERE COALESCE(product.is_active, true)
      AND COALESCE(publication.visibility, 'published') = 'published'
      AND CASE WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
        ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars) END > 0
  ),
  primeros AS (
    SELECT * FROM filas
    ORDER BY (stock <= 0), orden, featured DESC, name, id
    LIMIT LEAST(GREATEST(COALESCE(p_limite, 48), 1), 200)
  )
  SELECT json_build_object('total', (SELECT count(*) FROM filas), 'productos', COALESCE(json_agg(json_build_object(
      'id', f.id, 'name', f.name, 'brand', f.brand, 'category', f.category, 'gender', f.gender,
      'description', f.description, 'image_url', f.image_url, 'image_urls', f.image_urls,
      'sale_price_ars', f.sale_price_ars, 'discount_price_ars', f.discount_price_ars,
      'price_2x_ars', f.price_2x_ars, 'stock', f.stock, 'content_ml', f.content_ml,
      'total_sold', f.total_sold, 'featured', f.featured, 'created_at', f.created_at,
      'payment_base_price', f.payment_base_price,
      'promo_price', (
        SELECT min(GREATEST(0, CASE
          WHEN p.type = 'percentage' THEN round(f.sale_price_ars * (1 - p.discount_value / 100.0))
          WHEN p.type = 'fixed' THEN round(f.sale_price_ars - p.discount_value) END))
        FROM promos p
        WHERE COALESCE(f.sale_price_ars, 0) > 0
          AND (p.applies_to = 'all'
            OR (p.applies_to = 'products' AND f.id = ANY(p.product_ids))
            OR (p.applies_to = 'categories' AND f.category IS NOT NULL AND f.category = ANY(p.category_names)))
      )
    ) ORDER BY (f.stock <= 0), f.orden, f.featured DESC, f.name, f.id), '[]'::json))
  FROM primeros f;
$$;

REVOKE ALL ON FUNCTION public.get_store_catalog_inicio(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_catalog_inicio(text, integer) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_store_catalog_inicio(text, integer) IS
  'Primeros productos de la vitrina (con stock primero, en el orden final de la tienda) y el total, para mostrar antes de que llegue get_store_catalog_completo.';

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT 'get_store_catalog_inicio', pg_get_function_identity_arguments(p.oid), 'public_storefront',
       'Primera página del catálogo público de una tienda activa: mismos campos que get_store_catalog_completo, sin costos ni identificadores internos; hasta 200 productos.',
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-15'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'get_store_catalog_inicio'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

COMMIT;
