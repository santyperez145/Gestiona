-- Medicion protegida de la confiabilidad del inventario por organizacion.
--
-- La vista no muestra tablas crudas al staff: resume solo indicadores operativos
-- y exige ser platform_admin. Productos sin Kardex quedan fuera del porcentaje
-- medido, nunca se convierten en coincidencias por falta de evidencia.

CREATE OR REPLACE VIEW public.platform_org_stock_accuracy AS
WITH latest_product_ledger AS (
  SELECT DISTINCT ON (sm.org_id, sm.product_id)
    sm.org_id,
    sm.product_id,
    sm.stock_after,
    sm.created_at
  FROM public.stock_movements sm
  WHERE sm.product_id IS NOT NULL
    AND sm.variant_id IS NULL
  ORDER BY sm.org_id, sm.product_id, sm.created_at DESC, sm.id DESC
), latest_variant_ledger AS (
  SELECT DISTINCT ON (sm.org_id, sm.variant_id)
    sm.org_id,
    sm.variant_id,
    sm.stock_after,
    sm.created_at
  FROM public.stock_movements sm
  WHERE sm.variant_id IS NOT NULL
  ORDER BY sm.org_id, sm.variant_id, sm.created_at DESC, sm.id DESC
), variant_state AS (
  SELECT
    p.org_id,
    p.id AS product_id,
    COUNT(pv.id)::integer AS variant_count,
    COUNT(lv.variant_id)::integer AS variant_ledger_count,
    COALESCE(SUM(pv.stock), 0)::numeric AS variant_stock,
    COALESCE(BOOL_AND(lv.variant_id IS NOT NULL AND pv.stock = lv.stock_after), true) AS variants_match,
    COUNT(*) FILTER (WHERE pv.stock < 0)::integer AS negative_variants,
    MAX(lv.created_at) AS last_variant_ledger_at
  FROM public.products p
  LEFT JOIN public.product_variants pv ON pv.product_id = p.id
  LEFT JOIN latest_variant_ledger lv ON lv.variant_id = pv.id
  GROUP BY p.org_id, p.id
), product_state AS (
  SELECT
    p.org_id,
    p.id,
    p.stock,
    p.stock < 0 OR COALESCE(vs.negative_variants, 0) > 0 AS has_negative_stock,
    CASE
      WHEN COALESCE(vs.variant_count, 0) > 0
        THEN COALESCE(vs.variant_ledger_count, 0) = vs.variant_count
      ELSE lp.product_id IS NOT NULL
    END AS has_ledger,
    CASE
      WHEN COALESCE(vs.variant_count, 0) > 0
        THEN COALESCE(vs.variant_ledger_count, 0) = vs.variant_count
          AND vs.variants_match
          AND p.stock = vs.variant_stock
      ELSE lp.product_id IS NOT NULL AND p.stock = lp.stock_after
    END AS ledger_matches,
    GREATEST(lp.created_at, vs.last_variant_ledger_at) AS last_ledger_at
  FROM public.products p
  LEFT JOIN latest_product_ledger lp ON lp.product_id = p.id
  LEFT JOIN variant_state vs ON vs.product_id = p.id
), count_state AS (
  SELECT
    org_id,
    COUNT(*) FILTER (WHERE status = 'cerrado')::integer AS closed_counts,
    MAX(closed_at) FILTER (WHERE status = 'cerrado') AS last_count_at
  FROM public.stock_counts
  GROUP BY org_id
)
SELECT
  o.id AS org_id,
  o.name AS org_name,
  o.slug,
  COUNT(ps.id)::integer AS productos_total,
  COUNT(ps.id) FILTER (WHERE ps.has_ledger)::integer AS productos_medidos,
  COUNT(ps.id) FILTER (WHERE ps.has_ledger AND ps.ledger_matches)::integer AS productos_coinciden,
  COUNT(ps.id) FILTER (WHERE ps.has_ledger AND NOT ps.ledger_matches)::integer AS productos_descuadrados,
  COUNT(ps.id) FILTER (WHERE NOT ps.has_ledger)::integer AS productos_sin_kardex,
  COUNT(ps.id) FILTER (WHERE ps.has_negative_stock)::integer AS productos_stock_negativo,
  CASE
    WHEN COUNT(ps.id) FILTER (WHERE ps.has_ledger) > 0
      THEN ROUND(
        COUNT(ps.id) FILTER (WHERE ps.has_ledger AND ps.ledger_matches)::numeric
        / COUNT(ps.id) FILTER (WHERE ps.has_ledger)::numeric * 100,
        1
      )
    ELSE NULL
  END AS precision_pct,
  MAX(ps.last_ledger_at) AS ultimo_movimiento_at,
  COALESCE(cs.closed_counts, 0) AS conteos_cerrados,
  cs.last_count_at AS ultimo_conteo_at
FROM public.organizations o
LEFT JOIN product_state ps ON ps.org_id = o.id
LEFT JOIN count_state cs ON cs.org_id = o.id
WHERE public.is_platform_admin(auth.uid())
GROUP BY o.id, o.name, o.slug, cs.closed_counts, cs.last_count_at;

REVOKE ALL ON public.platform_org_stock_accuracy FROM PUBLIC;
GRANT SELECT ON public.platform_org_stock_accuracy TO authenticated;

COMMENT ON VIEW public.platform_org_stock_accuracy IS
  'Precision de inventario para plataforma. Compara el ultimo asiento del Kardex '
  'con el stock actual; productos sin asiento no entran como coincidencias. '
  'Los productos con variantes se validan contra cada variante y su total padre.';
