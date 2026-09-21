-- Campañas e invitaciones son la autoridad del trabajo con creadores.
-- Ventas, contratos, entregables y pagos referencian resultados posteriores;
-- no deben fingir ser una campaña.

CREATE TABLE IF NOT EXISTS public.influencer_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 3 AND 120),
  objective text NOT NULL CHECK (char_length(btrim(objective)) BETWEEN 3 AND 1000),
  channel text NOT NULL DEFAULT 'instagram' CHECK (channel IN ('instagram', 'tiktok', 'youtube', 'multicanal')),
  budget_ars numeric(14,2) NOT NULL CHECK (budget_ars >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'recruiting', 'active', 'review', 'completed', 'cancelled')),
  starts_on date,
  ends_on date,
  brief jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(brief) = 'object'),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS public.influencer_campaign_creators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.influencer_campaigns(id) ON DELETE CASCADE,
  influencer_id uuid NOT NULL REFERENCES public.influencers(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN (
    'invited', 'accepted', 'declined', 'in_production', 'submitted',
    'changes_requested', 'approved', 'published', 'cancelled'
  )),
  agreed_fee_ars numeric(14,2) CHECK (agreed_fee_ars IS NULL OR agreed_fee_ars >= 0),
  response_due_at timestamptz,
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  invited_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, influencer_id)
);

CREATE INDEX IF NOT EXISTS influencer_campaigns_org_status_idx
  ON public.influencer_campaigns(org_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS influencer_campaign_creators_org_status_idx
  ON public.influencer_campaign_creators(org_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS trg_influencer_campaigns_updated ON public.influencer_campaigns;
CREATE TRIGGER trg_influencer_campaigns_updated BEFORE UPDATE ON public.influencer_campaigns
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_influencer_campaign_creators_updated ON public.influencer_campaign_creators;
CREATE TRIGGER trg_influencer_campaign_creators_updated BEFORE UPDATE ON public.influencer_campaign_creators
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.influencer_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_campaign_creators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Influencer campaigns read" ON public.influencer_campaigns;
CREATE POLICY "Influencer campaigns read" ON public.influencer_campaigns FOR SELECT TO authenticated
USING (public.has_permission(org_id, 'influencers', 'view'));
DROP POLICY IF EXISTS "Influencer campaigns create" ON public.influencer_campaigns;
CREATE POLICY "Influencer campaigns create" ON public.influencer_campaigns FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid() AND public.has_permission(org_id, 'influencers', 'create'));
DROP POLICY IF EXISTS "Influencer campaigns edit" ON public.influencer_campaigns;
CREATE POLICY "Influencer campaigns edit" ON public.influencer_campaigns FOR UPDATE TO authenticated
USING (public.has_permission(org_id, 'influencers', 'edit'))
WITH CHECK (public.has_permission(org_id, 'influencers', 'edit'));
DROP POLICY IF EXISTS "Influencer campaigns delete" ON public.influencer_campaigns;
CREATE POLICY "Influencer campaigns delete" ON public.influencer_campaigns FOR DELETE TO authenticated
USING (public.has_permission(org_id, 'influencers', 'delete'));

DROP POLICY IF EXISTS "Influencer campaign creators read" ON public.influencer_campaign_creators;
CREATE POLICY "Influencer campaign creators read" ON public.influencer_campaign_creators FOR SELECT TO authenticated
USING (public.has_permission(org_id, 'influencers', 'view'));
DROP POLICY IF EXISTS "Influencer campaign creators create" ON public.influencer_campaign_creators;
CREATE POLICY "Influencer campaign creators create" ON public.influencer_campaign_creators FOR INSERT TO authenticated
WITH CHECK (invited_by = auth.uid() AND public.has_permission(org_id, 'influencers', 'create'));
DROP POLICY IF EXISTS "Influencer campaign creators edit" ON public.influencer_campaign_creators;
CREATE POLICY "Influencer campaign creators edit" ON public.influencer_campaign_creators FOR UPDATE TO authenticated
USING (public.has_permission(org_id, 'influencers', 'edit'))
WITH CHECK (public.has_permission(org_id, 'influencers', 'edit'));
DROP POLICY IF EXISTS "Influencer campaign creators delete" ON public.influencer_campaign_creators;
CREATE POLICY "Influencer campaign creators delete" ON public.influencer_campaign_creators FOR DELETE TO authenticated
USING (public.has_permission(org_id, 'influencers', 'delete'));

CREATE OR REPLACE FUNCTION public.influencer_campaign_create(
  p_org_id uuid,
  p_name text,
  p_objective text,
  p_channel text,
  p_budget_ars numeric,
  p_starts_on date DEFAULT NULL,
  p_ends_on date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(p_org_id, 'influencers', 'create') THEN
    RAISE EXCEPTION 'No tenés permiso para crear campañas' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 3 AND 120
     OR char_length(btrim(COALESCE(p_objective, ''))) NOT BETWEEN 3 AND 1000
     OR p_channel NOT IN ('instagram', 'tiktok', 'youtube', 'multicanal')
     OR p_budget_ars IS NULL OR p_budget_ars < 0
     OR (p_ends_on IS NOT NULL AND p_starts_on IS NOT NULL AND p_ends_on < p_starts_on) THEN
    RAISE EXCEPTION 'Revisá nombre, objetivo, canal, presupuesto y fechas' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.influencer_campaigns(
    org_id, name, objective, channel, budget_ars, starts_on, ends_on, created_by
  ) VALUES (
    p_org_id, btrim(p_name), btrim(p_objective), p_channel, p_budget_ars,
    p_starts_on, p_ends_on, auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.influencer_campaign_invite(
  p_org_id uuid,
  p_campaign_id uuid,
  p_influencer_id uuid,
  p_agreed_fee_ars numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(p_org_id, 'influencers', 'create') THEN
    RAISE EXCEPTION 'No tenés permiso para invitar creadores' USING ERRCODE = '42501';
  END IF;
  IF p_agreed_fee_ars IS NOT NULL AND p_agreed_fee_ars < 0 THEN
    RAISE EXCEPTION 'El honorario no puede ser negativo' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.influencer_campaigns WHERE id = p_campaign_id AND org_id = p_org_id AND status IN ('draft', 'recruiting')) THEN
    RAISE EXCEPTION 'La campaña no admite invitaciones' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.influencers WHERE id = p_influencer_id AND org_id = p_org_id AND status IN ('active', 'activo')) THEN
    RAISE EXCEPTION 'El creador no está activo en esta organización' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.influencer_campaign_creators(
    org_id, campaign_id, influencer_id, agreed_fee_ars, response_due_at, invited_by
  ) VALUES (
    p_org_id, p_campaign_id, p_influencer_id, p_agreed_fee_ars,
    now() + interval '72 hours', auth.uid()
  )
  ON CONFLICT (campaign_id, influencer_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'El creador ya está invitado a esta campaña' USING ERRCODE = '23505'; END IF;

  UPDATE public.influencer_campaigns SET status = 'recruiting' WHERE id = p_campaign_id AND org_id = p_org_id;
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.influencer_campaign_create(uuid, text, text, text, numeric, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.influencer_campaign_invite(uuid, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.influencer_campaign_create(uuid, text, text, text, numeric, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.influencer_campaign_invite(uuid, uuid, uuid, numeric) TO authenticated;
