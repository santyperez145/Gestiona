-- Verificación de sólo lectura D5.23 contra la base enlazada.
-- El mismo owner consulta historial y un período cerrado; no crea ni modifica
-- pedidos, sesiones, pagos o stock.

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims =
  '{"sub":"42abf3d2-6650-407a-a5d2-9781c4ab6778","role":"authenticated"}';

WITH measured AS (
  SELECT public.get_store_performance_snapshot(
    '026eb5d8-d21a-4a2a-9e0b-83d60ba4c285',
    NULL,
    NULL
  ) AS snapshot
)
SELECT
  snapshot->>'orders_total' AS orders_total,
  snapshot->>'orders_paid' AS orders_paid,
  snapshot->>'paid_revenue_ars' AS paid_revenue_ars,
  snapshot->>'sessions_total' AS sessions_total,
  snapshot->>'period_from' AS period_from,
  snapshot->>'comparison' AS comparison
FROM measured;

WITH measured AS (
  SELECT public.get_store_performance_snapshot(
    '026eb5d8-d21a-4a2a-9e0b-83d60ba4c285',
    '2026-07-30'::date,
    '2026-07-31'::date
  ) AS snapshot
)
SELECT
  snapshot->>'period_from' AS period_from,
  snapshot->>'period_to' AS period_to,
  snapshot->>'orders_total' AS orders_total,
  snapshot->>'orders_paid' AS orders_paid,
  snapshot->>'paid_revenue_ars' AS paid_revenue_ars,
  snapshot->'comparison'->>'period_from' AS previous_from,
  snapshot->'comparison'->>'period_to' AS previous_to,
  snapshot->'comparison'->>'orders_total' AS previous_orders,
  snapshot->'comparison'->>'paid_revenue_ars' AS previous_revenue
FROM measured;

ROLLBACK;

SELECT
  to_regprocedure('public.get_store_performance_snapshot(uuid)') IS NULL
    AS old_signature_removed,
  to_regprocedure('public.get_store_performance_snapshot(uuid,date,date)') IS NOT NULL
    AS period_signature_ready;
