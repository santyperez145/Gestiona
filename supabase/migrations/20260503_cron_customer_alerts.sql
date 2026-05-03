-- Schedule daily customer reactivation alerts via pg_cron
-- Runs every day at 9am UTC (6am ARG / -3)
SELECT cron.schedule(
  'customer-reactivation-alerts',
  '0 9 * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_functions_url') || '/customer-reactivation-alerts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    )
  $$
) ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule;
