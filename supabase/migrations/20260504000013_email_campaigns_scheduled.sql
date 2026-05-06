-- Allow scheduling email campaigns for future delivery
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

-- Cron: check every hour for campaigns scheduled to send
SELECT cron.schedule(
  'send-scheduled-campaigns',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/send-scheduled-campaigns',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
) ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule;
