-- Daily overdue debts check via pg_cron (runs at 8:00 AM UTC)
DO $schedule$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'overdue-debts-daily') THEN
    PERFORM cron.schedule(
  'overdue-debts-daily',
  '0 8 * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/check-overdue-debts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
    ),
    body := '{}'::jsonb
  );
  $$
    );
  END IF;
END;
$schedule$;
