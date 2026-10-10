-- Cron condicionado a trabajo pendiente. Sólo lectura; ROLLBACK.
BEGIN;
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM cron.job
          WHERE jobname IN ('outbox-despachar', 'outbox-confirmar', 'reconcile-pos-qr-orders', 'campaign-chat-dispatcher', 'avisos-por-correo')
            AND command LIKE '%WHERE EXISTS%') = 5, 'Hay jobs frecuentes sin condición de trabajo pendiente';
END;
$$;
SELECT 'cron_solo_con_trabajo OK' AS resultado;
ROLLBACK;
