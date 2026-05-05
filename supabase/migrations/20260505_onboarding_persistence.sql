-- ============================================================================
-- Onboarding persistence
-- Agrega onboarded_at a organizations para no depender de localStorage
-- ============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;

-- Comentario para documentar el propósito
COMMENT ON COLUMN public.organizations.onboarded_at IS
  'Timestamp cuando el owner completó el wizard de onboarding. NULL = aún no completado.';

-- Vista para dashboard de plataforma (% de orgs que completaron onboarding)
CREATE OR REPLACE VIEW public.onboarding_stats AS
SELECT
  COUNT(*)                                             AS total_orgs,
  COUNT(onboarded_at)                                  AS completed,
  COUNT(*) FILTER (WHERE onboarded_at IS NULL)         AS pending,
  ROUND(COUNT(onboarded_at)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS completion_pct,
  AVG(EXTRACT(EPOCH FROM (onboarded_at - created_at)) / 3600)
    FILTER (WHERE onboarded_at IS NOT NULL)            AS avg_hours_to_complete
FROM public.organizations;
