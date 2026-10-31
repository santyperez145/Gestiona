-- La métrica de plataforma de stock negativo no cuenta la preventa vigente (2026-10-30).
--
-- `stock_negativo` (20261030001900) ya excluye lo vendido en una preventa
-- vigente: el stock negativo dentro del cupo es lo que se entrega cuando llegue
-- la mercadería. La métrica de precisión de stock de la plataforma
-- (`platform_org_stock_accuracy.productos_stock_negativo`) lo seguía contando
-- como faltante. Mismo criterio; el resto de la vista, igual que en
-- 20261009000800.
BEGIN;

CREATE OR REPLACE VIEW public.platform_org_stock_accuracy AS
 WITH latest_product_ledger AS (
         SELECT DISTINCT ON (sm.org_id, sm.product_id) sm.org_id,
            sm.product_id,
            sm.stock_after,
            sm.created_at
           FROM stock_movements sm
          WHERE sm.product_id IS NOT NULL AND sm.variant_id IS NULL
          ORDER BY sm.org_id, sm.product_id, sm.created_at DESC, sm.id DESC
        ), latest_variant_ledger AS (
         SELECT DISTINCT ON (sm.org_id, sm.variant_id) sm.org_id,
            sm.variant_id,
            sm.stock_after,
            sm.created_at
           FROM stock_movements sm
          WHERE sm.variant_id IS NOT NULL
          ORDER BY sm.org_id, sm.variant_id, sm.created_at DESC, sm.id DESC
        ), variant_state AS (
         SELECT p.org_id,
            p.id AS product_id,
            count(pv.id)::integer AS variant_count,
            count(lv.variant_id)::integer AS variant_ledger_count,
            COALESCE(sum(pv.stock), 0::bigint)::numeric AS variant_stock,
            COALESCE(bool_and(lv.variant_id IS NOT NULL AND pv.stock = lv.stock_after), true) AS variants_match,
            count(*) FILTER (WHERE pv.stock < 0)::integer AS negative_variants,
            max(lv.created_at) AS last_variant_ledger_at
           FROM products p
             LEFT JOIN product_variants pv ON pv.product_id = p.id
             LEFT JOIN latest_variant_ledger lv ON lv.variant_id = pv.id
          GROUP BY p.org_id, p.id
        ), product_state AS (
         SELECT p.org_id,
            p.id,
            p.stock,
            -- Lo vendido en una preventa vigente (dentro del cupo) no es un
            -- faltante (20261030001900): se entrega cuando llega la mercadería.
            p.stock < 0 AND NOT (p.preventa_cupo > 0 AND p.expected_restock_at >= public.hoy_ar() AND -p.stock <= p.preventa_cupo)
              OR COALESCE(vs.negative_variants, 0) > 0 AS has_negative_stock,
                CASE
                    WHEN COALESCE(vs.variant_count, 0) > 0 THEN COALESCE(vs.variant_ledger_count, 0) = vs.variant_count
                    ELSE lp.product_id IS NOT NULL
                END AS has_ledger,
                CASE
                    WHEN COALESCE(vs.variant_count, 0) > 0 THEN COALESCE(vs.variant_ledger_count, 0) = vs.variant_count AND vs.variants_match AND p.stock::numeric = vs.variant_stock
                    ELSE lp.product_id IS NOT NULL AND p.stock = lp.stock_after
                END AS ledger_matches,
            GREATEST(lp.created_at, vs.last_variant_ledger_at) AS last_ledger_at
           FROM products p
             LEFT JOIN latest_product_ledger lp ON lp.product_id = p.id
             LEFT JOIN variant_state vs ON vs.product_id = p.id
        ), count_state AS (
         SELECT stock_counts.org_id,
            count(*) FILTER (WHERE stock_counts.status = 'cerrado'::text)::integer AS closed_counts,
            max(stock_counts.closed_at) FILTER (WHERE stock_counts.status = 'cerrado'::text) AS last_count_at
           FROM stock_counts
          GROUP BY stock_counts.org_id
        )
 SELECT o.id AS org_id,
    o.name AS org_name,
    o.slug,
    count(ps.id)::integer AS productos_total,
    count(ps.id) FILTER (WHERE ps.has_ledger)::integer AS productos_medidos,
    count(ps.id) FILTER (WHERE ps.has_ledger AND ps.ledger_matches)::integer AS productos_coinciden,
    count(ps.id) FILTER (WHERE ps.has_ledger AND NOT ps.ledger_matches)::integer AS productos_descuadrados,
    count(ps.id) FILTER (WHERE NOT ps.has_ledger)::integer AS productos_sin_kardex,
    count(ps.id) FILTER (WHERE ps.has_negative_stock)::integer AS productos_stock_negativo,
        CASE
            WHEN count(ps.id) FILTER (WHERE ps.has_ledger) > 0 THEN round(count(ps.id) FILTER (WHERE ps.has_ledger AND ps.ledger_matches)::numeric / count(ps.id) FILTER (WHERE ps.has_ledger)::numeric * 100::numeric, 1)
            ELSE NULL::numeric
        END AS precision_pct,
    max(ps.last_ledger_at) AS ultimo_movimiento_at,
    COALESCE(cs.closed_counts, 0) AS conteos_cerrados,
    cs.last_count_at AS ultimo_conteo_at
   FROM organizations o
     LEFT JOIN product_state ps ON ps.org_id = o.id
     LEFT JOIN count_state cs ON cs.org_id = o.id
  WHERE is_platform_admin(auth.uid())
  GROUP BY o.id, o.name, o.slug, cs.closed_counts, cs.last_count_at;

COMMIT;
