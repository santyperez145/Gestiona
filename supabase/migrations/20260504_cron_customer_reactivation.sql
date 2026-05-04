-- Daily customer reactivation alerts via pg_cron (runs at 10:00 AM UTC)
select cron.schedule(
  'customer-reactivation-daily',
  '0 10 * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/customer-reactivation-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
    ),
    body := '{}'::jsonb
  );
  $$
) on conflict (jobname) do update set schedule = excluded.schedule;
