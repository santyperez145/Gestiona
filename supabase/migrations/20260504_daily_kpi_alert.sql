-- Add daily KPI alert thresholds to settings
alter table public.settings
  add column if not exists daily_sales_alert_threshold numeric default 0,
  add column if not exists daily_margin_alert_threshold numeric default 0;

-- Schedule daily KPI alert at 9 AM UTC (6 AM Argentina)
select cron.schedule(
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
) on conflict (jobname) do update set schedule = '0 9 * * *';
