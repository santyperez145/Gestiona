-- Daily stock alert check via pg_cron (runs at 9:00 AM UTC)
select cron.schedule(
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
) on conflict (jobname) do update set schedule = excluded.schedule;
