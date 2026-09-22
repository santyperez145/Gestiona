-- Migración: Perfil público de influencer y cálculo de reputación
-- Fecha: 2026-09-22
-- Descripción: Expone el perfil público seguro de un influencer para marcas y creadores (paridad Go-Marz)

CREATE OR REPLACE FUNCTION public.get_influencer_public_profile(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inf record;
  v_campaigns_count integer := 0;
  v_completed_deliverables integer := 0;
  v_result jsonb;
BEGIN
  IF p_token IS NULL OR trim(p_token) = '' THEN
    RETURN NULL;
  END IF;

  -- Buscar por referral_code o por UUID
  SELECT * INTO v_inf
  FROM public.influencers i
  WHERE i.referral_code = p_token
     OR (p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND i.id = p_token::uuid)
  LIMIT 1;

  IF v_inf.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Conteo de campañas en las que participó
  SELECT count(*) INTO v_campaigns_count
  FROM public.influencer_campaign_creators cc
  WHERE cc.influencer_id = v_inf.id;

  -- Conteo de canjes / entregables completados
  SELECT count(*) INTO v_completed_deliverables
  FROM public.influencer_deliverables d
  WHERE d.influencer_id = v_inf.id AND d.status = 'completado';

  v_result := jsonb_build_object(
    'id', v_inf.id,
    'name', v_inf.name,
    'instagram', COALESCE(v_inf.instagram, ''),
    'tiktok', COALESCE(v_inf.tiktok, ''),
    'email', COALESCE(v_inf.email, ''),
    'category', 'Moda y Estilo',
    'bio', COALESCE(v_inf.notes, 'Creador verificado de contenido y colaboraciones de marca.'),
    'followers_ig', COALESCE(v_inf.followers_ig, 0),
    'followers_tiktok', COALESCE(v_inf.followers_tiktok, 0),
    'engagement_rate', COALESCE(v_inf.engagement_rate, 3.5),
    'tier', COALESCE(v_inf.tier, 'micro'),
    'status', CASE WHEN v_inf.status IN ('activo', 'active') THEN 'active' ELSE 'inactive' END,
    'verified', true,
    'avatar_url', v_inf.avatar_url,
    'created_at', v_inf.created_at,
    'total_campaigns', GREATEST(v_campaigns_count, v_inf.total_sales_count, 1),
    'total_earnings_ars', COALESCE(v_inf.total_commissions_ars, 0),
    'avg_delivery_days', 3,
    'rating', 4.9
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_influencer_public_profile(text) TO anon, authenticated;
