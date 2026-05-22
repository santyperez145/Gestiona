-- Migration: birthday WhatsApp automation
-- Adds opt-in toggle for birthday WA messages + daily cron job

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS whatsapp_birthday_enabled boolean NOT NULL DEFAULT true;

-- pg_cron: run daily at 08:00 UTC (05:00 Buenos Aires)
SELECT cron.schedule(
  'send-birthday-whatsapp-daily',
  '0 8 * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/send-birthday-whatsapp',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);
