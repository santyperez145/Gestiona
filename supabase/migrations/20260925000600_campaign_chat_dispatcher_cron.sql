-- ============================================================================
-- Cron del despachador de notificaciones del chat marca↔creador.
--
-- `campaign_chat_notifications_pending()` (service_role) expone sólo filas con
-- destino real; la Edge Function `campaign-chat-dispatcher` las envía por el
-- transporte existente de la plataforma (SMTP/Resend para correo, VAPID para
-- push) y marca el resultado. Los fallidos con intentos < 3 vuelven a la cola.
--
-- ⚠️ pg_cron se re-ejecuta igual que `avisos-por-correo` (idempotente: la cola
-- devuelve lo pendiente y el resultado se marca por fila). Cada 5 minutos: un
-- mensaje no debería esperar media hora para avisar.
-- ============================================================================

SELECT cron.unschedule('campaign-chat-dispatcher')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'campaign-chat-dispatcher');

SELECT cron.schedule('campaign-chat-dispatcher', '*/5 * * * *',
  $$SELECT public.invoke_edge_function('campaign-chat-dispatcher')$$);