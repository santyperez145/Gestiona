-- Add daily KPI alert thresholds to settings
alter table public.settings
  add column if not exists daily_sales_alert_threshold numeric default 0,
  add column if not exists daily_margin_alert_threshold numeric default 0;

-- Schedule daily KPI alert at 9 AM UTC (6 AM Argentina)
DO $schedule$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-kpi-alert') THEN
    PERFORM cron.schedule(
  'daily-kpi-alert',
  '0 9 * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/daily-kpi-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
    );
  END IF;
END
$schedule$;
