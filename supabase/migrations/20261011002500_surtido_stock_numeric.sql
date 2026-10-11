-- ═══════════════════════════════════════════════════════════════════════════
-- Tienda: el editor de surtido volvía a fallar (stock ahora es numeric)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido 2026-10-11 con plpgsql_check y ejecutándola como dueño de un
-- comercio: `get_store_assortment` fallaba siempre con «structure of query
-- does not match function result type». 20261009000800 (cantidades
-- fraccionadas) pasó `products.stock` a numeric y esta función seguía
-- declarando `stock integer` en su resultado: el editor de surtido de la
-- tienda (StoreAssortmentEditor) no cargaba desde el 9/10.
--
-- Se recrea igual, con `stock numeric` (cambiar el tipo de resultado exige
-- DROP + CREATE) y los mismos permisos que tenía. Nada más cambia.
--
-- Idempotente. Reversible: volver a la definición anterior (que fallaba).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DROP FUNCTION IF EXISTS public.get_store_assortment(p_store_id uuid, p_query text, p_filter text, p_limit integer, p_offset integer);

CREATE OR REPLACE FUNCTION public.get_store_assortment(p_store_id uuid, p_query text DEFAULT NULL::text, p_filter text DEFAULT 'all'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(product_id uuid, name text, brand text, image_url text, core_category text, effective_category text, core_price_ars numeric, core_discount_price_ars numeric, override_price_ars numeric, override_compare_at_price_ars numeric, override_category_slug text, featured_override boolean, effective_price_ars numeric, effective_compare_at_price_ars numeric, stock numeric, active boolean, visibility text, featured boolean, sort_order integer, customized boolean, has_variants boolean, sellable boolean, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org uuid;
  v_query text := NULLIF(btrim(COALESCE(p_query, '')), '');
  v_filter text := lower(COALESCE(p_filter, 'all'));
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  SELECT store.org_id INTO v_org
  FROM public.ecommerce_stores store
  WHERE store.id = p_store_id;

  IF v_org IS NULL OR auth.uid() IS NULL
     OR NOT public.is_org_member(v_org, auth.uid()) THEN
    RAISE EXCEPTION 'No autorizado para consultar el surtido'
      USING ERRCODE = '42501';
  END IF;
  IF char_length(COALESCE(v_query, '')) > 120
     OR v_filter NOT IN ('all', 'published', 'hidden', 'customized', 'unavailable')
     OR v_offset > 1000000 THEN
    RAISE EXCEPTION 'Los filtros del surtido no son válidos'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH assortment AS (
    SELECT
      product.id AS product_id,
      product.name,
      product.brand,
      product.image_url,
      product.category AS core_category,
      COALESCE(publication.category_slug, product.category) AS effective_category,
      product.sale_price_ars AS core_price_ars,
      product.discount_price_ars AS core_discount_price_ars,
      publication.price_ars AS override_price_ars,
      publication.compare_at_price_ars AS override_compare_at_price_ars,
      publication.category_slug AS override_category_slug,
      publication.featured AS featured_override,
      CASE
        WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
        ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
      END AS effective_price_ars,
      CASE
        WHEN publication.price_ars IS NOT NULL THEN publication.compare_at_price_ars
        WHEN COALESCE(product.discount_price_ars, 0) > 0
          AND product.discount_price_ars < product.sale_price_ars
          THEN product.sale_price_ars
        ELSE NULL::numeric
      END AS effective_compare_at_price_ars,
      product.stock,
      COALESCE(product.is_active, true) AS active,
      COALESCE(publication.visibility, 'published') AS visibility,
      COALESCE(publication.featured, product.featured, false) AS featured,
      publication.sort_order,
      publication.product_id IS NOT NULL AS customized,
      EXISTS (
        SELECT 1 FROM public.product_variants variant
        WHERE variant.product_id = product.id
          AND variant.org_id = product.org_id
          AND variant.active
      ) AS has_variants,
      COALESCE(product.is_active, true)
        AND COALESCE(publication.visibility, 'published') = 'published'
        AND CASE
          WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
          ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
        END > 0 AS sellable
    FROM public.products product
    LEFT JOIN public.store_product_publications publication
      ON publication.store_id = p_store_id
     AND publication.product_id = product.id
    WHERE product.org_id = v_org
      AND (
        v_query IS NULL
        OR product.name ILIKE '%' || v_query || '%'
        OR product.brand ILIKE '%' || v_query || '%'
      )
  ), filtered AS (
    SELECT *
    FROM assortment row
    WHERE v_filter = 'all'
       OR (v_filter = 'published' AND row.visibility = 'published')
       OR (v_filter = 'hidden' AND row.visibility = 'hidden')
       OR (v_filter = 'customized' AND row.customized)
       OR (v_filter = 'unavailable' AND NOT row.sellable)
  )
  SELECT
    row.product_id, row.name, row.brand, row.image_url,
    row.core_category, row.effective_category,
    row.core_price_ars, row.core_discount_price_ars,
    row.override_price_ars, row.override_compare_at_price_ars,
    row.override_category_slug, row.featured_override,
    row.effective_price_ars, row.effective_compare_at_price_ars,
    row.stock, row.active, row.visibility, row.featured, row.sort_order,
    row.customized, row.has_variants, row.sellable,
    count(*) OVER () AS total_count
  FROM filtered row
  ORDER BY
    (row.visibility = 'published') DESC,
    row.sort_order ASC NULLS LAST,
    row.name ASC,
    row.product_id ASC
  LIMIT v_limit OFFSET v_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_store_assortment(p_store_id uuid, p_query text, p_filter text, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_assortment(p_store_id uuid, p_query text, p_filter text, p_limit integer, p_offset integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_store_assortment(p_store_id uuid, p_query text, p_filter text, p_limit integer, p_offset integer) TO service_role;

COMMIT;
