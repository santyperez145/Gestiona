-- Migration: whatsapp_digest_enabled setting + daily cron

-- Add opt-in column to settings
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS whatsapp_digest_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN settings.whatsapp_digest_enabled IS
  'When true, a daily WhatsApp message is sent to whatsapp_number via Evolution API summarising the day''s sales KPIs.';

-- Daily WhatsApp digest cron — 20:00 UTC (17:00 Buenos Aires time)
SELECT cron.schedule(
  'daily-whatsapp-digest',
  '0 20 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM vault.secrets WHERE name = 'supabase_functions_url') || '/daily-whatsapp-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM vault.secrets WHERE name = 'supabase_service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
)
ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule;
