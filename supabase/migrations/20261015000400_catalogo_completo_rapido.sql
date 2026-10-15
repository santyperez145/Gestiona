-- Catálogo completo de la tienda: las promociones se calculan una vez, no por
-- producto, y viajan sólo los campos que la tienda usa.
--
-- Medido el 2026-10-15 en la tienda de Ferretería Famatina (11.518
-- productos): el catálogo pedía 1,8–2,5 s de base y pesaba 7 MB. La mitad del
-- tiempo era `store_promo_price` llamado 11.518 veces —una consulta a
-- `promotions` por producto— con cero promociones activas. Además cada fila
-- traía `org_id`, `user_id` (el usuario interno del dueño), los precios de
-- decants y `offer_expires_at`, que la tienda no usa.
--
-- Ahora la función lee las promociones vigentes una vez y las aplica a cada
-- producto con la misma regla de `store_promo_price` (sin subtotal conocido
-- sólo entran las que no tienen mínimo). El resultado es el mismo producto por
-- producto, en el mismo orden: lo comprueba `scripts/catalogo-rapido-matrix.sql`
-- contra `get_store_catalog_products`, que sigue igual para quien la use.
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_store_catalog_completo(p_slug text)
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
  )
  SELECT COALESCE(json_agg(json_build_object(
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
    ) ORDER BY f.orden, f.featured DESC, f.name, f.id), '[]'::json)
  FROM filas f;
$$;

REVOKE ALL ON FUNCTION public.get_store_catalog_completo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_catalog_completo(text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_store_catalog_completo(text) IS
  'Catálogo público de la vitrina como un único JSON, con sólo los campos que usa la tienda y las promociones calculadas una vez. Mismo contenido y orden que get_store_catalog_products.';

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT 'get_store_catalog_completo', pg_get_function_identity_arguments(p.oid), 'public_storefront',
       'Catálogo público de una tienda activa: sólo productos publicados con precio, sin costos ni identificadores internos (ni org_id ni user_id).',
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-15'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'get_store_catalog_completo'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

COMMIT;
