-- Completa el circuito de métricas sociales con autoridad en servidor.
-- Corrige la omisión de `impressions` en el INSERT original y permite que el
-- creador consulte sólo sus propios reportes desde el portal autenticado.

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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT i.org_id INTO v_org
  FROM public.influencers i
  JOIN public.creator_accounts ca
    ON lower(ca.email) = lower(i.email)
   AND ca.user_id = auth.uid()
  WHERE i.id = p_influencer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'influencer_not_linked' USING ERRCODE = '42501';
  END IF;
  IF p_platform NOT IN ('instagram', 'tiktok', 'youtube') THEN
    RAISE EXCEPTION 'invalid_platform' USING ERRCODE = '22023';
  END IF;
  IF p_evidence_url IS NULL OR p_evidence_url !~ '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_evidence_url' USING ERRCODE = '22023';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023';
  END IF;
  IF p_period_end > CURRENT_DATE THEN
    RAISE EXCEPTION 'period_in_future' USING ERRCODE = '22023';
  END IF;
  IF p_period_start < CURRENT_DATE - INTERVAL '366 days' THEN
    RAISE EXCEPTION 'period_too_old' USING ERRCODE = '22023';
  END IF;
  IF p_followers IS NULL OR p_followers < 0 THEN
    RAISE EXCEPTION 'invalid_followers' USING ERRCODE = '22023';
  END IF;
  IF p_reach IS NOT NULL AND p_reach < 0 THEN
    RAISE EXCEPTION 'invalid_reach' USING ERRCODE = '22023';
  END IF;
  IF p_impressions IS NOT NULL AND p_impressions < 0 THEN
    RAISE EXCEPTION 'invalid_impressions' USING ERRCODE = '22023';
  END IF;
  IF p_engagement_rate IS NOT NULL AND (p_engagement_rate < 0 OR p_engagement_rate > 100) THEN
    RAISE EXCEPTION 'invalid_engagement' USING ERRCODE = '22023';
  END IF;
  IF p_metric_kind NOT IN ('captura', 'export_csv') THEN
    RAISE EXCEPTION 'invalid_metric_kind' USING ERRCODE = '22023';
  END IF;
  IF p_notes IS NOT NULL AND length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'invalid_notes' USING ERRCODE = '22023';
  END IF;
  IF NOT public.rate_limit_publico(
    'creator_metric_submit',
    auth.uid()::text,
    20,
    interval '1 day'
  ) THEN
    RAISE EXCEPTION 'metric_report_rate_limited' USING ERRCODE = 'P0001';
  END IF;

  SELECT r.* INTO v_row
  FROM public.influencer_social_metric_reports r
  WHERE r.influencer_id = p_influencer_id
    AND r.platform = p_platform
    AND r.period_start = p_period_start
    AND r.period_end = p_period_end
    AND r.evidence_url = p_evidence_url
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  INSERT INTO public.influencer_social_metric_reports (
    org_id, influencer_id, platform, metric_kind, evidence_url,
    period_start, period_end, followers, reach, impressions,
    engagement_rate, notes
  ) VALUES (
    v_org, p_influencer_id, p_platform, p_metric_kind, p_evidence_url,
    p_period_start, p_period_end, p_followers, p_reach, p_impressions,
    p_engagement_rate, p_notes
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_social_metric_report(
  uuid, text, text, date, date, numeric, numeric, numeric, numeric, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_social_metric_report(
  uuid, text, text, date, date, numeric, numeric, numeric, numeric, text, text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.creator_my_social_metric_reports()
RETURNS TABLE (
  id uuid,
  org_id uuid,
  org_name text,
  influencer_id uuid,
  influencer_name text,
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
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.id, r.org_id, o.name, r.influencer_id, i.name,
         r.platform, r.metric_kind, r.evidence_url, r.period_start,
         r.period_end, r.followers, r.reach, r.impressions,
         r.engagement_rate, r.notes, r.status, r.reviewed_at,
         r.review_notes, r.created_at
  FROM public.influencer_social_metric_reports r
  JOIN public.influencers i ON i.id = r.influencer_id
  JOIN public.organizations o ON o.id = r.org_id
  JOIN public.creator_accounts ca
    ON ca.user_id = auth.uid()
   AND lower(ca.email) = lower(i.email)
  WHERE auth.uid() IS NOT NULL
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.creator_my_social_metric_reports() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_my_social_metric_reports() TO authenticated;

DO $$
BEGIN
  IF position('impressions' IN pg_get_functiondef(
    'public.submit_social_metric_report(uuid,text,text,date,date,numeric,numeric,numeric,numeric,text,text)'::regprocedure
  )) = 0 THEN
    RAISE EXCEPTION 'submit_social_metric_report no persiste impressions';
  END IF;
  IF has_function_privilege('anon', 'public.creator_my_social_metric_reports()', 'EXECUTE') THEN
    RAISE EXCEPTION 'creator_my_social_metric_reports expuesto a anon';
  END IF;
END;
$$;
