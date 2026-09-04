-- Verificación read-only D5.28. Compara el catálogo esperado con lo que ve
-- `anon`; no crea ni altera productos, variantes, stock o tiendas.

BEGIN;

CREATE TEMP TABLE zz_variant_visibility ON COMMIT DROP AS
SELECT
  s.slug,
  count(*)::integer AS expected_active,
  count(*) FILTER (WHERE v.stock <= 0)::integer AS expected_sold_out,
  0::integer AS actual_active,
  0::integer AS actual_sold_out
FROM public.ecommerce_stores s
JOIN public.product_variants v ON v.org_id = s.org_id
JOIN public.products p ON p.id = v.product_id AND p.org_id = s.org_id
WHERE s.is_active
  AND v.active
  AND p.is_active
GROUP BY s.slug
HAVING count(*) FILTER (WHERE v.stock <= 0) > 0;

GRANT SELECT, UPDATE ON TABLE zz_variant_visibility TO anon;

SET LOCAL ROLE anon;
UPDATE zz_variant_visibility expected
SET
  actual_active = (
    SELECT count(*)::integer
    FROM public.get_store_variants(expected.slug)
  ),
  actual_sold_out = (
    SELECT count(*) FILTER (WHERE stock <= 0)::integer
    FROM public.get_store_variants(expected.slug)
  );
RESET ROLE;

SELECT
  slug,
  expected_active,
  actual_active,
  expected_sold_out,
  actual_sold_out,
  expected_active = actual_active
    AND expected_sold_out = actual_sold_out AS passed
FROM zz_variant_visibility
ORDER BY slug;

SELECT count(*) AS failed_checks
FROM zz_variant_visibility
WHERE expected_active <> actual_active
   OR expected_sold_out <> actual_sold_out;

ROLLBACK;
