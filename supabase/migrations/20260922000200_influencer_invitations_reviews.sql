-- Migración: Invitaciones a creadores + reviews/reputación de influencers
-- Fecha: 2026-09-22
-- Descripción: Paridad Go-Marz — flujo de contratación (invitar → aceptar/rechazar con expiración)
--   y reputación real calculada (rating y tiempos de entrega desde datos, no valores fijos).

BEGIN;

-- ============================================
-- INVITACIONES A CREADORES
-- El creador no tiene cuenta: la invitación vive por token público,
-- con expiración y decisión (accepted/declined/expired).
-- ============================================
CREATE TABLE IF NOT EXISTS public.influencer_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES public.influencer_campaigns(id) ON DELETE SET NULL,
  influencer_id UUID REFERENCES public.influencers(id) ON DELETE CASCADE,
  email TEXT,
  phone TEXT,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '14 days',
  responded_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, influencer_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.influencer_invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_org_status ON public.influencer_invitations(org_id, status);

-- ============================================
-- REVIEWS DE CREADORES (reputación real)
-- Una review por campaña por creador: la marca califica al creador
-- después de cerrar una colaboración.
-- ============================================
CREATE TABLE IF NOT EXISTS public.influencer_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES public.influencer_campaigns(id) ON DELETE SET NULL,
  deliverable_id UUID REFERENCES public.influencer_deliverables(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT CHECK (length(comment) <= 2000),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, influencer_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_influencer ON public.influencer_reviews(influencer_id, created_at DESC);

-- ============================================
-- EXPIRACIÓN AUTOMÁTICA DE INVITACIONES PENDIENTES
-- ============================================
CREATE OR REPLACE FUNCTION public.expire_influencer_invitations()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.influencer_invitations
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at < now();
$$;

-- ============================================
-- RESPONDER INVITACIÓN (público, por token)
-- El creador no tiene cuenta: responde con el token de la invitación.
-- Devuelve el estado final. Errores explícitos: invalid_token,
-- already_responded, invitation_expired.
-- ============================================
CREATE OR REPLACE FUNCTION public.respond_influencer_invitation(p_token text, p_action text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.influencer_invitations;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;
  IF p_action NOT IN ('accept', 'decline') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  SELECT * INTO v_inv FROM public.influencer_invitations WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF v_inv.status <> 'pending' THEN RAISE EXCEPTION 'already_responded'; END IF;
  IF v_inv.expires_at < now() THEN
    UPDATE public.influencer_invitations SET status = 'expired', responded_at = now() WHERE id = v_inv.id;
    RAISE EXCEPTION 'invitation_expired';
  END IF;

  UPDATE public.influencer_invitations
  SET status = CASE WHEN p_action = 'accept' THEN 'accepted' ELSE 'declined' END,
      responded_at = now()
  WHERE id = v_inv.id;

  RETURN CASE WHEN p_action = 'accept' THEN 'accepted' ELSE 'declined' END;
END;
$$;

-- ============================================
-- LEER INVITACIÓN PÚBLICA POR TOKEN (para la página de aceptación)
-- Expone solo lo justo: nombre del creador, estado, expiración y
-- nombre de la organización. Nunca presupuesto ni costos internos.
-- ============================================
CREATE OR REPLACE FUNCTION public.get_influencer_invitation(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', i.id,
    'status', i.status,
    'expires_at', i.expires_at,
    'email', i.email,
    'campaign_title', c.title,
    'campaign_brief', c.brief,
    'campaign_due_date', c.due_date,
    'channel', c.channel,
    'influencer_name', inf.name,
    'org_name', o.name
  )
  FROM public.influencer_invitations i
  LEFT JOIN public.influencer_campaigns c ON c.id = i.campaign_id
  LEFT JOIN public.influencers inf ON inf.id = i.influencer_id
  LEFT JOIN public.organizations o ON o.id = i.org_id
  WHERE i.token = p_token;
$$;

-- ============================================
-- CREAR INVITACIÓN (RPC transaccional con permisos del módulo)
-- ============================================
CREATE OR REPLACE FUNCTION public.create_influencer_invitation(
  p_org_id uuid, p_influencer_id uuid, p_campaign_id uuid, p_days integer DEFAULT 14
)
RETURNS public.influencer_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.influencer_invitations;
BEGIN
  IF NOT public.can_manage_influencers(p_org_id, 'create') THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF p_influencer_id IS NULL THEN RAISE EXCEPTION 'invalid_influencer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.influencers WHERE id = p_influencer_id AND org_id = p_org_id) THEN
    RAISE EXCEPTION 'invalid_influencer';
  END IF;
  IF p_campaign_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.influencer_campaigns WHERE id = p_campaign_id AND org_id = p_org_id
  ) THEN RAISE EXCEPTION 'invalid_campaign'; END IF;

  INSERT INTO public.influencer_invitations(org_id, campaign_id, influencer_id, token, created_by)
  VALUES (p_org_id, p_campaign_id, p_influencer_id, encode(gen_random_bytes(24), 'hex'), auth.uid())
  ON CONFLICT (org_id, influencer_id, campaign_id) DO UPDATE
    SET token = encode(gen_random_bytes(24), 'hex'),
        status = CASE WHEN influencer_invitations.status IN ('declined', 'expired') THEN 'pending' ELSE influencer_invitations.status END,
        expires_at = now() + make_interval(days => GREATEST(COALESCE(p_days, 14), 1)),
        responded_at = NULL
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_influencer_invitation(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_influencer_invitation(text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_influencer_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_influencer_invitation(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.create_influencer_invitation(uuid, uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_influencer_invitation(uuid, uuid, uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.expire_influencer_invitations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_influencer_invitations() TO anon, authenticated;

-- ============================================
-- RLS
-- ============================================
ALTER TABLE public.influencer_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_reviews ENABLE ROW LEVEL SECURITY;

-- Invitaciones: solo org owner/admin con permisos del módulo influencers.
CREATE POLICY invitations_org ON public.influencer_invitations FOR ALL TO authenticated
  USING (public.can_manage_influencers(org_id))
  WITH CHECK (public.can_manage_influencers(org_id));

-- Reviews: los miembros de la org leen; solo owner/admin escribe.
CREATE POLICY reviews_read ON public.influencer_reviews FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY reviews_write ON public.influencer_reviews FOR ALL TO authenticated
  USING (public.can_manage_influencers(org_id))
  WITH CHECK (public.can_manage_influencers(org_id));

REVOKE ALL ON public.influencer_invitations, public.influencer_reviews FROM anon, authenticated;
GRANT SELECT ON public.influencer_invitations, public.influencer_reviews TO authenticated;

-- ============================================
-- PERFIL PÚBLICO CON REPUTACIÓN REAL
-- Reemplaza rating fijo y tiempos estimados por cálculo desde datos:
-- rating = promedio de reviews reales (NULL si no hay);
-- avg_delivery_days = promedio entre due_date y delivery_date de entregables completados.
-- ============================================
CREATE OR REPLACE FUNCTION public.get_influencer_public_profile(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inf record;
  v_campaigns_count integer := 0;
  v_rating numeric;
  v_reviews_count integer := 0;
  v_avg_days numeric;
  v_result jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_inf FROM public.influencers i
  WHERE i.referral_code = p_token
     OR (p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND i.id = p_token::uuid)
  LIMIT 1;

  IF v_inf.id IS NULL THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_campaigns_count
  FROM public.influencer_campaign_creators cc
  WHERE cc.influencer_id = v_inf.id;

  SELECT avg(r.rating), count(*) INTO v_rating, v_reviews_count
  FROM public.influencer_reviews r
  WHERE r.influencer_id = v_inf.id;

  SELECT round(avg(d.delivery_date - d.due_date)::numeric, 1) INTO v_avg_days
  FROM public.influencer_deliverables d
  WHERE d.influencer_id = v_inf.id
    AND d.status = 'completado'
    AND d.delivery_date IS NOT NULL;

  v_result := jsonb_build_object(
    'id', v_inf.id,
    'name', v_inf.name,
    'instagram', COALESCE(v_inf.instagram, ''),
    'tiktok', COALESCE(v_inf.tiktok, ''),
    'email', COALESCE(v_inf.email, ''),
    'category', 'Moda y Estilo',
    'bio', COALESCE(v_inf.notes, 'Creador de contenido.'),
    'followers_ig', COALESCE(v_inf.followers_ig, 0),
    'followers_tiktok', COALESCE(v_inf.followers_tiktok, 0),
    'engagement_rate', COALESCE(v_inf.engagement_rate, 0),
    'tier', COALESCE(v_inf.tier, 'micro'),
    'rating', v_rating,
    'reviews_count', v_reviews_count,
    'total_campaigns', v_campaigns_count,
    'avg_delivery_days', v_avg_days,
    'total_earnings_ars', COALESCE(v_inf.total_commissions_ars, 0),
    'status', CASE WHEN v_inf.status IN ('activo', 'active') THEN 'active' ELSE 'inactive' END,
    'verified', true,
    'avatar_url', v_inf.avatar_url,
    'created_at', v_inf.created_at
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_influencer_public_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_influencer_public_profile(text) TO anon, authenticated;

-- ============================================
-- REVIEWS PÚBLICAS POR TOKEN (solo lo justo: rating, comentario, marca, fecha)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_influencer_public_reviews(p_token text)
RETURNS TABLE (id uuid, rating integer, comment text, created_at timestamptz, org_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.rating, r.comment, r.created_at, o.name AS org_name
  FROM public.influencer_reviews r
  JOIN public.influencers i ON i.id = r.influencer_id
  LEFT JOIN public.organizations o ON o.id = r.org_id
  WHERE i.referral_code = p_token
     OR (p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND i.id = p_token::uuid)
  ORDER BY r.created_at DESC;
$$;

-- ============================================
-- PORTAFOLIO PÚBLICO: entregables aprobados con enlace de contenido real
-- ============================================
CREATE OR REPLACE FUNCTION public.get_influencer_public_portfolio(p_token text)
RETURNS TABLE (id uuid, description text, campaign_name text, content_url text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, d.description, d.campaign_name, d.content_url
  FROM public.influencer_deliverables d
  JOIN public.influencers i ON i.id = d.influencer_id
  WHERE d.content_url LIKE 'https://%'
    AND d.status = 'completado'
    AND (i.referral_code = p_token
      OR (p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND i.id = p_token::uuid))
  ORDER BY d.updated_at DESC
  LIMIT 12;
$$;

REVOKE ALL ON FUNCTION public.get_influencer_public_reviews(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_influencer_public_reviews(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_influencer_public_portfolio(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_influencer_public_portfolio(text) TO anon, authenticated;

COMMIT;