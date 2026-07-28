-- Campos que la vista de auditoría de AdminPage ya lee pero que `audit_logs`
-- no tenía: el filtro por severidad y la búsqueda por texto disparaban un 400
-- de PostgREST, y la tabla se renderizaba con columnas vacías.
-- Todas las columnas son nullable (o con default), así que las filas
-- existentes quedan válidas. Idempotente.

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS user_email   text,
  ADD COLUMN IF NOT EXISTS user_role    text,
  ADD COLUMN IF NOT EXISTS entity_label text,
  ADD COLUMN IF NOT EXISTS old_values   jsonb,
  ADD COLUMN IF NOT EXISTS new_values   jsonb,
  ADD COLUMN IF NOT EXISTS diff         jsonb,
  ADD COLUMN IF NOT EXISTS ip_address   text,
  ADD COLUMN IF NOT EXISTS severity     text NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS tags         text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS metadata     jsonb  NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_severity_check'
  ) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_severity_check
      CHECK (severity IN ('info', 'warning', 'critical'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS audit_logs_severity_idx ON public.audit_logs(org_id, severity, created_at DESC);
