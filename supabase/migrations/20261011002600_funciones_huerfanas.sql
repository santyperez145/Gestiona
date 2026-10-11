-- ═══════════════════════════════════════════════════════════════════════════
-- Tres funciones huérfanas: sus tablas se borraron y fallaban siempre
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido 2026-10-11 con scripts/funciones-sql-revalidar.mjs (recrea cada
-- función SQL en una transacción que se revierte): get_customer_journey y
-- get_customer_sentiment leen `customer_touchpoints`, y get_revenue_waterfall
-- lee `revenue_journal_entries`. Esas tablas se borraron en 20260723000003
-- (funcionalidades sin uso) pero las funciones quedaron: cualquier llamada
-- fallaba con «relation does not exist». Ninguna pantalla, función de servidor
-- ni otra función de la base las llama.
--
-- Idempotente. Reversible: recrear desde 20260523000070 y 20260523000084 (con
-- sus tablas).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DROP FUNCTION IF EXISTS public.get_customer_journey(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_customer_sentiment(uuid, integer);
DROP FUNCTION IF EXISTS public.get_revenue_waterfall(uuid, integer);

COMMIT;
