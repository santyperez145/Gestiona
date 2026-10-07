-- Daily automation flows runner via pg_cron (runs at 11:00 AM UTC)
DO $schedule$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-automation-flows-daily') THEN
    PERFORM cron.schedule(
  'run-automation-flows-daily',
  '0 11 * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/run-automation-flows',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
    ),
    body := '{}'::jsonb
  );
  $$
    );
  END IF;
END
$schedule$;
