-- ============================================================================
-- Creador autenticado: aceptar invitaciones y marcar entregables
-- Extiende 20260922000400: el creador con cuenta ya no responde por token
-- público — la campaña aceptada aparece directo en /portal-creador y ahí
-- entrega el contenido.
-- ============================================================================

-- ── Aceptar/rechazar la invitación de una campaña, con sesión ───────────────
-- La invitación se busca por email de la cuenta (no por token), así el portal
-- muestra la decisión sin depender de un enlace público.
CREATE OR REPLACE FUNCTION public.creator_respond_campaign(p_campaign_id uuid, p_action text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.influencer_invitations;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_action NOT IN ('accept', 'decline') THEN RAISE EXCEPTION 'invalid_action'; END IF;

  SELECT email INTO v_email FROM public.creator_accounts WHERE user_id = v_user;
  IF v_email IS NULL THEN RAISE EXCEPTION 'not_a_creator'; END IF;

  SELECT * INTO v_inv
  FROM public.influencer_invitations
  WHERE campaign_id = p_campaign_id
    AND lower(email) = lower(v_email)
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_not_found'; END IF;
  IF v_inv.status IN ('accepted', 'declined') THEN RETURN v_inv.status; END IF;
  IF v_inv.status = 'expired' OR (v_inv.status = 'pending' AND v_inv.expires_at < now()) THEN
    UPDATE public.influencer_invitations
    SET status = 'expired', responded_at = now()
    WHERE id = v_inv.id;
    RAISE EXCEPTION 'invitation_expired';
  END IF;

  UPDATE public.influencer_invitations
  SET status = CASE WHEN p_action = 'accept' THEN 'accepted' ELSE 'declined' END,
      responded_at = now()
  WHERE id = v_inv.id;

  RETURN CASE WHEN p_action = 'accept' THEN 'accepted' ELSE 'declined' END;
END;
$$;

REVOKE ALL ON FUNCTION public.creator_respond_campaign(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_respond_campaign(uuid, text) TO authenticated;

-- ── Entregar contenido de una campaña desde el portal ───────────────────────
-- El servidor valida que la campaña sea realmente del creador: el cliente
-- nunca declara a qué org pertenece el entregable.
CREATE OR REPLACE FUNCTION public.creator_submit_deliverable(
  p_campaign_id uuid, p_campaign_name text, p_description text, p_content_url text
)
RETURNS public.influencer_deliverables
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org_id uuid;
  v_influencer_id uuid;
  v_campaign record;
  v_row public.influencer_deliverables;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_content_url IS NULL OR p_content_url !~ '^https://.+' THEN
    RAISE EXCEPTION 'invalid_url';
  END IF;
  IF p_description IS NULL OR btrim(p_description) = '' THEN
    RAISE EXCEPTION 'invalid_description';
  END IF;

  -- La campaña tiene que estar en la bandeja del creador (misma consulta que
  -- creator_campaigns): match de email de cuenta con el perfil de la marca.
  SELECT c.id, c.org_id INTO v_campaign
  FROM public.influencer_campaigns c
  JOIN public.influencers i ON i.org_id = c.org_id
  JOIN public.creator_accounts ca ON ca.user_id = v_user
  WHERE c.id = p_campaign_id
    AND lower(i.email) = lower(ca.email)
  LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  v_org_id := v_campaign.org_id;

  SELECT id INTO v_influencer_id
  FROM public.influencers i
  JOIN public.creator_accounts ca ON ca.user_id = v_user
  WHERE i.org_id = v_org_id AND lower(i.email) = lower(ca.email)
  LIMIT 1;

  INSERT INTO public.influencer_deliverables (
    org_id, influencer_id, campaign_id, campaign_name, description, content_url, status
  ) VALUES (
    v_org_id, v_influencer_id, p_campaign_id, p_campaign_name, p_description, p_content_url, 'entregado'
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.creator_submit_deliverable(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_submit_deliverable(uuid, text, text, text) TO authenticated;

-- ── Campañas del creador, ahora con su invitación y entregable ──────────────
-- Reemplaza creator_campaigns para que la bandeja muestre la decisión y el
-- contenido ya entregado sin consultas extra.
DROP FUNCTION IF EXISTS public.creator_campaigns();
CREATE OR REPLACE FUNCTION public.creator_campaigns()
RETURNS TABLE (
  id uuid,
  org_id uuid,
  org_name text,
  title text,
  brief text,
  channel text,
  due_date date,
  status text,
  budget_ars numeric,
  invitation_status text,
  deliverable_url text,
  deliverable_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.org_id, o.name, c.title, c.brief, c.channel, c.due_date,
         c.status, c.budget_ars,
         (SELECT ii.status FROM public.influencer_invitations ii
          WHERE ii.campaign_id = c.id AND lower(ii.email) = lower(ca.email)
          ORDER BY ii.created_at DESC LIMIT 1),
         (SELECT d.content_url FROM public.influencer_deliverables d
          WHERE d.campaign_id = c.id AND d.influencer_id = i.id
          ORDER BY d.created_at DESC LIMIT 1),
         (SELECT d.status FROM public.influencer_deliverables d
          WHERE d.campaign_id = c.id AND d.influencer_id = i.id
          ORDER BY d.created_at DESC LIMIT 1)
  FROM public.influencer_campaigns c
  JOIN public.influencers i ON i.org_id = c.org_id
  JOIN public.creator_accounts ca ON ca.user_id = auth.uid()
  LEFT JOIN public.organizations o ON o.id = c.org_id
  WHERE lower(i.email) = lower(ca.email)
    AND EXISTS (SELECT 1 FROM public.influencer_campaign_creators cc
                WHERE cc.campaign_id = c.id AND cc.influencer_id = i.id)
  ORDER BY c.due_date NULLS LAST, c.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.creator_campaigns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_campaigns() TO authenticated;

-- ── Certificación ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'creator_respond_campaign') THEN
    RAISE EXCEPTION 'creator_respond_campaign no existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'creator_submit_deliverable') THEN
    RAISE EXCEPTION 'creator_submit_deliverable no existe';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260922000500', 'creator_campaign_actions') ON CONFLICT DO NOTHING;
