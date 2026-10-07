-- Daily stock alert check via pg_cron (runs at 9:00 AM UTC)
DO $schedule$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'stock-alerts-daily') THEN
    PERFORM cron.schedule(
  'stock-alerts-daily',
  '0 9 * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/check-stock-alerts',
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
