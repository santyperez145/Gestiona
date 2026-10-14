-- Simulacro de 20261014000300 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. invoke_edge_function espera 150 s y la versión con secreto acepta hasta 150 s.
--   2. El respaldo diario pide 150 s.
--   3. customer-reactivation-alerts corre una sola vez por día.
DO $$
BEGIN
  IF pg_get_functiondef('public.invoke_edge_function(text)'::regprocedure) NOT LIKE '%timeout_milliseconds := 150000%' THEN
    RAISE EXCEPTION 'FALLA 1: invoke_edge_function'; END IF;
  IF pg_get_functiondef('public.invoke_edge_function_with_secret_timeout(text,text,text,integer)'::regprocedure) NOT LIKE '%60000), 150000)%' THEN
    RAISE EXCEPTION 'FALLA 1: tope de la versión con secreto'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-org-backups' AND command LIKE '%150000%') THEN
    RAISE EXCEPTION 'FALLA 2: el respaldo no pide 150 s'; END IF;
  IF (SELECT count(*) FROM cron.job WHERE command LIKE '%customer-reactivation-alerts%') <> 1 THEN
    RAISE EXCEPTION 'FALLA 3: % crons de reactivación', (SELECT count(*) FROM cron.job WHERE command LIKE '%customer-reactivation-alerts%'); END IF;
  RAISE EXCEPTION 'OK 1-3';
END $$;

ROLLBACK;
