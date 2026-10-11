-- ═══════════════════════════════════════════════════════════════════════════
-- Reservas de stock vencidas: se marcan solas cada hora
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido 2026-10-11: una reserva de un pedido online sin pagar vencía el
-- 4/9 y seguía «activa». No bloqueaba stock (el disponible ya ignora las
-- vencidas), pero aparecía como activa en Reservas y en los reportes hasta
-- que alguien abría esa pestaña (que llama a expire_stock_reservations).
-- `vencer_reservas()` existe y hace justo eso para todos los comercios, pero
-- ningún cron la llamaba. Ahora corre cada hora (minuto 23).
--
-- Idempotente. Reversible: cron.unschedule('vencer-reservas-de-stock').
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DO $$
BEGIN
  PERFORM cron.unschedule('vencer-reservas-de-stock')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vencer-reservas-de-stock');
  PERFORM cron.schedule('vencer-reservas-de-stock', '23 * * * *', 'SELECT public.vencer_reservas()');
END $$;

REVOKE ALL ON FUNCTION public.vencer_reservas() FROM PUBLIC, anon, authenticated;

-- Primera pasada ahora.
SELECT public.vencer_reservas();

COMMIT;
