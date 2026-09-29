-- ============================================================================
-- Métricas sociales verificadas por evidencia (Go-Marz parity, slice del
-- roadmap 2026-09-25).
--
-- ── El defecto ──────────────────────────────────────────────────────────────
-- El descubrimiento de creadores decidía con seguidores/engagement
-- autodeclarados: cualquier número sin evidencia. Go-Marz pesa performance
-- medida; Nerqia no tenía hechos.
--
-- ── Qué hace ────────────────────────────────────────────────────────────────
-- 1. `influencer_social_metric_reports`: el creador sube su evidencia (captura
--    o export CSV) con la ventana temporal medida. La URL es obligatoria y
--    https; los números no pueden ser negativos.
-- 2. RPC `submit_social_metric_report` (creador, sesión) y
--    `review_social_metric_report` (marca con permiso): la decisión de la
--    marca es durable — verificado o rechazado con motivo, nunca un borrado.
-- 3. `influencer_reputation_map` se extiende con `verified_metrics` y
--    `last_verified_at`: el descubrimiento muestra si los números del creador
--    tienen evidencia al día; el autodeclarado sin reporte verificado no suma
--    reputación.
-- ============================================================================

-- 1. Tabla de reportes de métricas sociales con ventana temporal medida.
CREATE TABLE IF NOT EXISTS public.influencer_social_metric_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  influencer_id uuid NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube')),
  metric_kind text NOT NULL DEFAULT 'captura'
    CHECK (metric_kind IN ('captura', 'export_csv')),
  evidence_url text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  followers numeric NOT NULL CHECK (followers >= 0),
  reach numeric CHECK (reach IS NULL OR reach >= 0),
  impressions numeric CHECK (impressions IS NULL OR impressions >= 0),
  engagement_rate numeric(5,2) CHECK (engagement_rate IS NULL OR engagement_rate >= 0),
  notes text CHECK (length(notes) <= 2000),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'verified', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_notes text CHECK (length(review_notes) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT periodo_coherente CHECK (period_end >= period_start),
  CONSTRAINT evidencia_https CHECK (evidence_url ~ '^https://[^[:space:]]+$')
);

CREATE INDEX IF NOT EXISTS idx_social_reports_influencer
  ON public.influencer_social_metric_reports(influencer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_reports_org
  ON public.influencer_social_metric_reports(org_id, created_at DESC);

ALTER TABLE public.influencer_social_metric_reports ENABLE ROW LEVEL SECURITY;

-- La marca con permiso de edición gestiona los reportes de sus creadores.
DROP POLICY IF EXISTS social_reports_org_manage ON public.influencer_social_metric_reports;
CREATE POLICY social_reports_org_manage ON public.influencer_social_metric_reports
  FOR ALL TO authenticated
  USING (public.can_manage_influencers(org_id, 'edit'))
  WITH CHECK (public.can_manage_influencers(org_id, 'edit'));

-- El creador ve sus propios reportes por su cuenta de portal.
DROP POLICY IF EXISTS social_reports_creator_read ON public.influencer_social_metric_reports;
CREATE POLICY social_reports_creator_read ON public.influencer_social_metric_reports
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.creator_accounts ca
      JOIN public.influencers i ON lower(i.email) = lower(ca.email)
      WHERE ca.user_id = auth.uid()
        AND i.id = influencer_social_metric_reports.influencer_id
    )
  );

REVOKE ALL ON TABLE public.influencer_social_metric_reports FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.influencer_social_metric_reports TO authenticated;

-- ── RPC: el creador sube su evidencia ───────────────────────────────────────
-- El creador sólo puede reportar métricas de sí mismo: la relación viene de
-- creator_accounts (su sesión), no de un id que llegue del navegador. El
-- período no puede ser futuro ni más viejo que un año.
CREATE OR REPLACE FUNCTION public.submit_social_metric_report(
  p_influencer_id uuid,
  p_platform text,
  p_evidence_url text,
  p_period_start date,
  p_period_end date,
  p_followers numeric,
  p_reach numeric DEFAULT NULL,
  p_impressions numeric DEFAULT NULL,
  p_engagement_rate numeric DEFAULT NULL,
  p_metric_kind text DEFAULT 'captura',
  p_notes text DEFAULT NULL
)
RETURNS public.influencer_social_metric_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.influencer_social_metric_reports;
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;

  SELECT i.org_id INTO v_org
  FROM public.influencers i
  JOIN public.creator_accounts ca
    ON lower(ca.email) = lower(i.email)
   AND ca.user_id = auth.uid()
  WHERE i.id = p_influencer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'influencer_not_linked' USING ERRCODE = '42501'; END IF;

  IF p_platform NOT IN ('instagram', 'tiktok', 'youtube') THEN
    RAISE EXCEPTION 'invalid_platform' USING ERRCODE = '22023'; END IF;
  IF p_evidence_url IS NULL OR p_evidence_url !~ '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_evidence_url' USING ERRCODE = '22023'; END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023'; END IF;
  IF p_period_end > CURRENT_DATE THEN
    RAISE EXCEPTION 'period_in_future' USING ERRCODE = '22023'; END IF;
  IF p_period_start < CURRENT_DATE - INTERVAL '366 days' THEN
    RAISE EXCEPTION 'period_too_old' USING ERRCODE = '22023'; END IF;
  IF p_followers IS NULL OR p_followers < 0 THEN
    RAISE EXCEPTION 'invalid_followers' USING ERRCODE = '22023'; END IF;
  IF p_reach IS NOT NULL AND p_reach < 0 THEN
    RAISE EXCEPTION 'invalid_reach' USING ERRCODE = '22023'; END IF;
  IF p_impressions IS NOT NULL AND p_impressions < 0 THEN
    RAISE EXCEPTION 'invalid_impressions' USING ERRCODE = '22023'; END IF;
  IF p_engagement_rate IS NOT NULL AND (p_engagement_rate < 0 OR p_engagement_rate > 100) THEN
    RAISE EXCEPTION 'invalid_engagement' USING ERRCODE = '22023'; END IF;
  IF p_metric_kind NOT IN ('captura', 'export_csv') THEN
    RAISE EXCEPTION 'invalid_metric_kind' USING ERRCODE = '22023'; END IF;
  IF p_notes IS NOT NULL AND length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'invalid_notes' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.influencer_social_metric_reports (
    org_id, influencer_id, platform, metric_kind, evidence_url,
    period_start, period_end, followers, reach, engagement_rate, notes
  )
  VALUES (
    v_org, p_influencer_id, p_platform, p_metric_kind, p_evidence_url,
    p_period_start, p_period_end, p_followers, p_reach, p_engagement_rate, p_notes
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_social_metric_report(uuid, text, text, date, date, numeric, numeric, numeric, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_social_metric_report(uuid, text, text, date, date, numeric, numeric, numeric, numeric, text, text) TO authenticated;

-- ── RPC: la marca verifica o rechaza ────────────────────────────────────────
-- La decisión es durable: verificado o rechazado con motivo, nunca un borrado.
-- Sólo se revisa lo `submitted`: re-verificar no pisa una decisión previa.
CREATE OR REPLACE FUNCTION public.review_social_metric_report(
  p_report_id uuid,
  p_status text,
  p_review_notes text DEFAULT NULL
)
RETURNS public.influencer_social_metric_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.influencer_social_metric_reports;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023'; END IF;
  IF p_review_notes IS NOT NULL AND length(p_review_notes) > 2000 THEN
    RAISE EXCEPTION 'invalid_notes' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_row
  FROM public.influencer_social_metric_reports
  WHERE id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'report_not_found' USING ERRCODE = '22023'; END IF;
  IF NOT public.can_manage_influencers(v_row.org_id, 'edit') THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'submitted' THEN
    RAISE EXCEPTION 'already_reviewed' USING ERRCODE = '22023'; END IF;

  UPDATE public.influencer_social_metric_reports
     SET status = p_status,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_notes = p_review_notes
   WHERE id = p_report_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.review_social_metric_report(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_social_metric_report(uuid, text, text) TO authenticated;

-- ── RPC: bandeja de la marca (reportes + nombre del creador y campaña) ──────
-- SECURITY DEFINER salta RLS: el guard de permiso es obligatorio en el WHERE.
CREATE OR REPLACE FUNCTION public.list_social_metric_reports(p_org_id uuid)
RETURNS TABLE (
  id uuid,
  org_id uuid,
  influencer_id uuid,
  platform text,
  metric_kind text,
  evidence_url text,
  period_start date,
  period_end date,
  followers numeric,
  reach numeric,
  impressions numeric,
  engagement_rate numeric,
  notes text,
  status text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz,
  influencer_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.org_id, r.influencer_id, r.platform, r.metric_kind,
         r.evidence_url, r.period_start, r.period_end, r.followers, r.reach,
         r.impressions, r.engagement_rate, r.notes, r.status, r.reviewed_by,
         r.reviewed_at, r.review_notes, r.created_at,
         i.name AS influencer_name
  FROM public.influencer_social_metric_reports r
  JOIN public.influencers i ON i.id = r.influencer_id
  WHERE r.org_id = p_org_id
    AND public.can_manage_influencers(p_org_id, 'view')
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_social_metric_reports(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_social_metric_reports(uuid) TO authenticated;

-- ── Reputación: los números verificados pesan; la promesa, no ───────────────
-- Extiende `influencer_reputation_map` (20260925002100): conserva sus columnas
-- de siempre (rating, reviews, colaboraciones, on-time, pruebas de publicación)
-- y agrega `verified_metrics` y `last_verified_at` desde esta tabla. Cambia la
-- firma de salida, requiere DROP previo (el ALTER de OUT params no).
DROP FUNCTION IF EXISTS public.influencer_reputation_map(uuid);
CREATE OR REPLACE FUNCTION public.influencer_reputation_map(p_org_id uuid)
RETURNS TABLE (
  influencer_id uuid,
  rating numeric,
  reviews_count bigint,
  collaborations_count bigint,
  on_time_rate numeric,
  verified_publications bigint,
  verified_metrics boolean,
  last_verified_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH reputacion AS (
    SELECT r.influencer_id,
           avg(r.rating)::numeric AS rating,
           count(*)::bigint AS reviews_count
    FROM public.influencer_reviews r
    WHERE r.org_id = p_org_id
    GROUP BY r.influencer_id
  ),
  entregas AS (
    SELECT d.influencer_id,
           count(*) FILTER (
             WHERE d.status = 'completado'
               AND d.delivery_date IS NOT NULL
           )::bigint AS done,
           count(*) FILTER (
             WHERE d.status = 'completado'
               AND d.delivery_date IS NOT NULL
               AND d.delivery_date <= d.due_date
           )::bigint AS on_time
    FROM public.influencer_deliverables d
    WHERE d.org_id = p_org_id AND d.influencer_id IS NOT NULL
    GROUP BY d.influencer_id
  ),
  campanas AS (
    SELECT cc.influencer_id,
           count(DISTINCT cc.campaign_id)::bigint AS collaborations_count
    FROM public.influencer_campaign_creators cc
    WHERE cc.org_id = p_org_id
    GROUP BY cc.influencer_id
  ),
  pruebas AS (
    SELECT p.influencer_id,
           count(*)::bigint AS verified_publications
    FROM public.influencer_publication_proofs p
    WHERE p.org_id = p_org_id AND p.verified_by IS NOT NULL
    GROUP BY p.influencer_id
  ),
  metricas_verificadas AS (
    SELECT r.influencer_id,
           bool_or(r.status = 'verified') AS tiene_verificada,
           max(r.reviewed_at) FILTER (WHERE r.status = 'verified') AS ultima_verificada
    FROM public.influencer_social_metric_reports r
    WHERE r.org_id = p_org_id
      AND r.created_at >= now() - INTERVAL '180 days'
    GROUP BY r.influencer_id
  )
  SELECT i.id,
         COALESCE(rep.rating, NULL::numeric) AS rating,
         COALESCE(rep.reviews_count, 0)::bigint AS reviews_count,
         COALESCE(cam.collaborations_count, 0)::bigint AS collaborations_count,
         CASE WHEN ent.done > 0
              THEN round(100.0 * ent.on_time / ent.done, 0)
              ELSE NULL::numeric END AS on_time_rate,
         COALESCE(pr.verified_publications, 0)::bigint AS verified_publications,
         COALESCE(m.tiene_verificada, false) AS verified_metrics,
         m.ultima_verificada AS last_verified_at
  FROM public.influencers i
  LEFT JOIN reputacion rep ON rep.influencer_id = i.id
  LEFT JOIN entregas ent ON ent.influencer_id = i.id
  LEFT JOIN campanas cam ON cam.influencer_id = i.id
  LEFT JOIN pruebas pr ON pr.influencer_id = i.id
  LEFT JOIN metricas_verificadas m ON m.influencer_id = i.id
  WHERE i.org_id = p_org_id
    -- Guard: solo el equipo con permiso de ver influencers de ESA org obtiene
    -- filas. Sin esta línea, un usuario autenticado de otra org podría pedir
    -- reputación ajena pasando un org_id ajeno (SECURITY DEFINER salta RLS).
    AND public.can_manage_influencers(p_org_id, 'view');
$$;

REVOKE ALL ON FUNCTION public.influencer_reputation_map(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.influencer_reputation_map(uuid) TO authenticated;

-- ── Certificación ───────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'submit_social_metric_report') THEN
    RAISE EXCEPTION 'submit_social_metric_report no existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'review_social_metric_report') THEN
    RAISE EXCEPTION 'review_social_metric_report no existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'list_social_metric_reports') THEN
    RAISE EXCEPTION 'list_social_metric_reports no existe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class t ON a.attrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'influencer_social_metric_reports'
      AND a.attname = 'evidence_url'
  ) THEN
    RAISE EXCEPTION 'influencer_social_metric_reports incompleta';
  END IF;
  IF has_function_privilege('anon', 'public.submit_social_metric_report(uuid,text,text,date,date,numeric,numeric,numeric,numeric,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon no puede subir reportes de métricas';
  END IF;
  IF has_function_privilege('anon', 'public.review_social_metric_report(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon no puede revisar reportes de métricas';
  END IF;
  IF has_function_privilege('anon', 'public.list_social_metric_reports(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon no puede listar reportes de métricas';
  END IF;
END $guard$;