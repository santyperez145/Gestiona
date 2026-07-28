-- Enforcement de 2FA por organización: cuando está activo, los owner/admin
-- deben tener un factor TOTP verificado para poder usar la app.
-- Idempotente.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.settings.mfa_required IS
  'Si es true, MfaGate exige un factor TOTP verificado a los owner/admin de la organización antes de dejarlos entrar.';
