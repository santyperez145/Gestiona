-- Daily automation flows runner via pg_cron (runs at 11:00 AM UTC)
select cron.schedule(
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
) on conflict (jobname) do update set schedule = excluded.schedule;
