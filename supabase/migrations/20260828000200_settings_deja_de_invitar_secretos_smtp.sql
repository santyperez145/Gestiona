-- Segunda mitad del rollout SMTP.
--
-- Esta migración se aplica después de desplegar las Edge Functions que leen
-- `merchant_smtp_connections`. No usa CASCADE: si quedó alguna dependencia SQL
-- viva, debe fallar y mostrarla en vez de borrarla silenciosamente.

DROP TRIGGER IF EXISTS trg_reject_legacy_smtp_settings ON public.settings;
DROP FUNCTION IF EXISTS public.reject_legacy_smtp_settings();

ALTER TABLE public.settings
  DROP COLUMN IF EXISTS smtp_host,
  DROP COLUMN IF EXISTS smtp_port,
  DROP COLUMN IF EXISTS smtp_user,
  DROP COLUMN IF EXISTS smtp_pass,
  DROP COLUMN IF EXISTS smtp_secure,
  DROP COLUMN IF EXISTS smtp_from_name,
  DROP COLUMN IF EXISTS smtp_from_email;

DO $verification$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'settings'
      AND column_name LIKE 'smtp_%'
  ) THEN
    RAISE EXCEPTION 'settings todavía contiene columnas SMTP';
  END IF;
END;
$verification$;

INSERT INTO supabase_migrations.schema_migrations(version, name)
VALUES ('20260828000200', 'settings_deja_de_invitar_secretos_smtp')
ON CONFLICT DO NOTHING;
