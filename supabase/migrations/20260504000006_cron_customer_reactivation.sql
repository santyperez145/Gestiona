-- Daily customer reactivation alerts via pg_cron (runs at 10:00 AM UTC)
do $schedule$
begin
  if not exists (select 1 from cron.job where jobname = 'customer-reactivation-daily') then
    perform cron.schedule(
      'customer-reactivation-daily',
      '0 10 * * *',
      $job$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/customer-reactivation-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
    ),
    body := '{}'::jsonb
  );
      $job$
    );
  end if;
END;
$schedule$;
