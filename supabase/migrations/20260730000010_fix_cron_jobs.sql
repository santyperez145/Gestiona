-- Los 13 cron jobs de la app estaban fallando TODOS, en silencio.
--
-- Dos causas:
--   1. La mayoría llamaba `current_setting('app.supabase_url')` y
--      `current_setting('app.service_role_key')` — ajustes que nunca se
--      configuraron en esta base.
--   2. `send-drip-emails` tenía literalmente los placeholders del ejemplo de
--      la documentación: 'https://<tu-proyecto>.functions.supabase.co' y
--      'Bearer <SERVICE_ROLE_KEY>'.
--
-- Consecuencia: no corrían las alertas de stock, los avisos de deuda vencida,
-- la reactivación de clientes, el KPI diario, el digest semanal, las
-- automatizaciones, las campañas programadas ni los emails de las secuencias.
-- `cron.job_run_details` mostraba 'failed' en todas.
--
-- Solución: una única fuente de verdad, el vault (que ya usaba
-- `check-alerts-daily`), y un helper para no repetir la invocación en cada job.
-- Se usa la clave PUBLICABLE, no la service_role: las Edge Functions corren
-- con verify_jwt y tienen su propia service key en el entorno, así que no hace
-- falta poner un secreto en la definición de un cron.
--
-- Requiere que existan los secretos SUPABASE_URL y SUPABASE_ANON_KEY en el
-- vault. Idempotente.

-- ── Helper ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invoke_edge_function(p_name text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'invoke_edge_function(%): faltan SUPABASE_URL o SUPABASE_ANON_KEY en el vault', p_name;
    RETURN NULL;
  END IF;

  RETURN net.http_post(
    url     := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key
    ),
    body    := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_edge_function(text) FROM PUBLIC;

-- ── Reprogramación de los jobs ────────────────────────────────────────────
DO $$
DECLARE
  j record;
  -- jobname → (schedule, función)
  jobs constant text[][] := ARRAY[
    ['check-alerts-daily',            '0 7 * * *',    'check-alerts'],
    ['customer-reactivation-alerts',  '0 9 * * *',    'customer-reactivation-alerts'],
    ['customer-reactivation-daily',   '0 10 * * *',   'customer-reactivation-alerts'],
    ['daily-kpi-alert',               '0 9 * * *',    'daily-kpi-alert'],
    ['execute-automations-daily',     '0 8 * * *',    'execute-automations'],
    ['overdue-debts-daily',           '0 8 * * *',    'check-overdue-debts'],
    ['run-automation-flows-daily',    '0 11 * * *',   'run-automation-flows'],
    ['send-birthday-whatsapp-daily',  '0 8 * * *',    'send-birthday-whatsapp'],
    ['send-drip-emails',              '*/30 * * * *', 'send-drip-emails'],
    ['send-scheduled-campaigns',      '0 * * * *',    'send-scheduled-campaigns'],
    ['stock-alerts-daily',            '0 9 * * *',    'check-stock-alerts'],
    ['weekly-performance-digest',     '0 9 * * 1',    'weekly-performance-digest']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(jobs, 1) LOOP
    -- cron.schedule con un nombre existente lo reemplaza.
    PERFORM cron.schedule(
      jobs[i][1],
      jobs[i][2],
      format('SELECT public.invoke_edge_function(%L);', jobs[i][3])
    );
  END LOOP;
END $$;
