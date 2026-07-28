-- ============================================================================
-- settings.crm_segments: segmentos de CRM guardados por el usuario
-- ============================================================================
-- getCRMSegmentsDB/saveCRMSegmentsDB leían y escribían esta columna, que
-- nunca existió → los segmentos guardados se perdían silenciosamente.

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS crm_segments jsonb NOT NULL DEFAULT '[]'::jsonb;
