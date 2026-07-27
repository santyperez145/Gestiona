-- ============================================================================
-- Columnas faltantes en settings — rompían el guardado de Ajustes
-- ============================================================================
-- SettingsPage enviaba estas 9 claves en el upsert pero las columnas nunca
-- existieron en la DB, así que CUALQUIER intento de guardar Ajustes fallaba
-- con "Could not find the 'whatsapp_birthday_enabled' column of 'settings'".
-- (El upsert manda todo el objeto: una sola columna faltante rompe todo.)

ALTER TABLE public.settings
  -- SMTP propio para envío de emails
  ADD COLUMN IF NOT EXISTS smtp_host       TEXT,
  ADD COLUMN IF NOT EXISTS smtp_port       INTEGER NOT NULL DEFAULT 587,
  ADD COLUMN IF NOT EXISTS smtp_user       TEXT,
  ADD COLUMN IF NOT EXISTS smtp_pass       TEXT,
  ADD COLUMN IF NOT EXISTS smtp_secure     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS smtp_from_name  TEXT,
  ADD COLUMN IF NOT EXISTS smtp_from_email TEXT,
  -- Automatizaciones de WhatsApp
  ADD COLUMN IF NOT EXISTS whatsapp_digest_enabled   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_birthday_enabled BOOLEAN NOT NULL DEFAULT true;
