-- Verificación reversible D5.22 contra la base enlazada.
-- Usa un producto real sólo como referencia de lectura. La sesión ZZ se crea
-- dentro de una transacción y el ROLLBACK garantiza cero residuos.

BEGIN;

SET LOCAL ROLE anon;

SELECT public.start_store_checkout(
  'exentryimports',
  'ZZcheckoutstage20260904034111aaaaaaaaaaaaaaaaaaaa',
  '[{"product_id":"506e8bd9-6307-48f2-9522-2c5a02010207","variant_id":null,"quantity":1}]'::jsonb,
  NULL
) AS first_start;

SELECT public.start_store_checkout(
  'exentryimports',
  'ZZcheckoutstage20260904034111aaaaaaaaaaaaaaaaaaaa',
  '[{"product_id":"506e8bd9-6307-48f2-9522-2c5a02010207","variant_id":null,"quantity":1}]'::jsonb,
  NULL
) AS repeated_start;

RESET ROLE;

SELECT
  count(*) AS zz_sessions,
  count(*) FILTER (WHERE checkout_started_at IS NOT NULL) AS checkout_marked,
  count(DISTINCT checkout_started_at) AS distinct_start_timestamps
FROM public.ecommerce_cart_sessions
WHERE session_token = 'ZZcheckoutstage20260904034111aaaaaaaaaaaaaaaaaaaa';

ROLLBACK;

-- La lectura final ya no incluye la sesión ZZ. Ejecutar como el owner real
-- prueba a la vez la autorización y la forma que recibirá la UI.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims =
  '{"sub":"42abf3d2-6650-407a-a5d2-9781c4ab6778","role":"authenticated"}';

WITH measured AS (
  SELECT public.get_store_performance_snapshot(
    '026eb5d8-d21a-4a2a-9e0b-83d60ba4c285'
  ) AS snapshot
)
SELECT
  snapshot->>'orders_total' AS orders_total,
  snapshot->>'orders_paid' AS orders_paid,
  snapshot->>'paid_revenue_ars' AS paid_revenue_ars,
  snapshot->>'sessions_total' AS sessions_total,
  snapshot->>'sessions_with_items' AS sessions_with_items,
  snapshot->>'checkout_started_sessions' AS checkout_started_sessions,
  snapshot->>'converted_sessions' AS converted_sessions
FROM measured;

ROLLBACK;

SELECT count(*) AS zz_residuos
FROM public.ecommerce_cart_sessions
WHERE session_token = 'ZZcheckoutstage20260904034111aaaaaaaaaaaaaaaaaaaa';
