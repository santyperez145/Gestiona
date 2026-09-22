BEGIN;

-- Campaign planning is distinct from social_posts (the publication calendar).
-- Creators and catalog remain shared Core authorities; no duplicate profiles.
CREATE OR REPLACE FUNCTION public.can_manage_influencers(p_org_id uuid, p_action text DEFAULT 'view')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.is_org_member(p_org_id, auth.uid())
    AND public.has_org_role(p_org_id, auth.uid(), ARRAY['owner', 'admin'])
    AND public.has_permission(p_org_id, 'influencers', 'view')
    AND public.has_permission(p_org_id, 'influencers', p_action);
$$;
REVOKE ALL ON FUNCTION public.can_manage_influencers(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_influencers(uuid, text) TO authenticated;

CREATE TABLE public.influencer_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  brief text NOT NULL DEFAULT '' CHECK (length(brief) <= 12000),
  objective text NOT NULL CHECK (objective IN ('awareness', 'traffic', 'sales', 'content')),
  channel text NOT NULL CHECK (channel IN ('instagram', 'tiktok', 'youtube', 'multiple')),
  budget_ars numeric(14,2) NOT NULL DEFAULT 0 CHECK (budget_ars >= 0 AND budget_ars < 1000000000000),
  due_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'cancelled')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
CREATE INDEX ON public.influencer_campaigns(org_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS influencers_org_id_id_key ON public.influencers(org_id, id);
CREATE TABLE public.influencer_campaign_creators (
  org_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  influencer_id uuid NOT NULL,
  PRIMARY KEY (campaign_id, influencer_id),
  FOREIGN KEY (org_id, campaign_id) REFERENCES public.influencer_campaigns(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, influencer_id) REFERENCES public.influencers(org_id, id) ON DELETE RESTRICT
);
CREATE INDEX ON public.influencer_campaign_creators(org_id, influencer_id);
CREATE TABLE public.influencer_campaign_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL CHECK (action IN ('created', 'updated', 'active', 'paused', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, campaign_id) REFERENCES public.influencer_campaigns(org_id, id) ON DELETE CASCADE
);
CREATE INDEX ON public.influencer_campaign_events(org_id, campaign_id, created_at DESC);

ALTER TABLE public.influencer_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_campaign_creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_campaign_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY campaign_read ON public.influencer_campaigns FOR SELECT TO authenticated USING (public.can_manage_influencers(org_id));
CREATE POLICY campaign_creators_read ON public.influencer_campaign_creators FOR SELECT TO authenticated USING (public.can_manage_influencers(org_id));
CREATE POLICY campaign_events_read ON public.influencer_campaign_events FOR SELECT TO authenticated USING (public.can_manage_influencers(org_id));
REVOKE ALL ON public.influencer_campaigns, public.influencer_campaign_creators, public.influencer_campaign_events FROM anon, authenticated;
GRANT SELECT ON public.influencer_campaigns, public.influencer_campaign_creators, public.influencer_campaign_events TO authenticated;

-- One transaction: brief + creator selection + audit. The client-generated id
-- makes a retried create idempotent, and version prevents lost updates.
CREATE OR REPLACE FUNCTION public.save_influencer_campaign(
  p_org_id uuid, p_id uuid, p_version integer, p_title text, p_brief text,
  p_objective text, p_channel text, p_budget_ars numeric, p_due_date date,
  p_creator_ids uuid[]
) RETURNS public.influencer_campaigns
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.influencer_campaigns; v_exists boolean;
BEGIN
  IF NOT public.can_manage_influencers(p_org_id, CASE WHEN p_version = 0 THEN 'create' ELSE 'edit' END) THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_version IS NULL OR p_version < 0 THEN RAISE EXCEPTION 'invalid_campaign'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  SELECT * INTO v_row FROM public.influencer_campaigns WHERE id = p_id AND org_id = p_org_id FOR UPDATE;
  v_exists := FOUND;
  IF v_exists AND p_version = 0 THEN RETURN v_row; END IF;
  IF (v_exists AND v_row.version <> p_version) OR (NOT v_exists AND p_version <> 0) THEN
    RAISE EXCEPTION 'campaign_conflict' USING ERRCODE = '40001';
  END IF;
  IF v_exists AND v_row.status NOT IN ('draft', 'paused') THEN RAISE EXCEPTION 'campaign_not_editable'; END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 160
    OR p_brief IS NULL OR length(p_brief) > 12000
    OR p_budget_ars IS NULL OR p_budget_ars < 0 OR p_budget_ars >= 1000000000000
    OR p_objective IS NULL OR p_objective NOT IN ('awareness', 'traffic', 'sales', 'content')
    OR p_channel IS NULL OR p_channel NOT IN ('instagram', 'tiktok', 'youtube', 'multiple')
    OR cardinality(p_creator_ids) > 100 THEN RAISE EXCEPTION 'invalid_campaign'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_creator_ids) AS picked(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.influencers i WHERE i.id = picked.id AND i.org_id = p_org_id AND i.status IN ('active', 'activo'))
  ) THEN RAISE EXCEPTION 'invalid_campaign_creator'; END IF;
  IF v_exists THEN
    UPDATE public.influencer_campaigns SET title = btrim(p_title), brief = btrim(p_brief),
      objective = p_objective, channel = p_channel, budget_ars = p_budget_ars, due_date = p_due_date,
      version = version + 1, updated_at = now() WHERE id = p_id RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.influencer_campaigns(id, org_id, title, brief, objective, channel, budget_ars, due_date, created_by)
      VALUES (p_id, p_org_id, btrim(p_title), btrim(p_brief), p_objective, p_channel, p_budget_ars, p_due_date, auth.uid())
      RETURNING * INTO v_row;
  END IF;
  DELETE FROM public.influencer_campaign_creators WHERE campaign_id = p_id;
  INSERT INTO public.influencer_campaign_creators(org_id, campaign_id, influencer_id)
    SELECT p_org_id, p_id, id FROM (SELECT DISTINCT unnest(p_creator_ids) AS id) picked;
  INSERT INTO public.influencer_campaign_events(org_id, campaign_id, actor_id, action)
    VALUES (p_org_id, p_id, auth.uid(), CASE WHEN v_exists THEN 'updated' ELSE 'created' END);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_influencer_campaign(p_org_id uuid, p_id uuid, p_version integer, p_status text)
RETURNS public.influencer_campaigns LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.influencer_campaigns;
BEGIN
  IF NOT public.can_manage_influencers(p_org_id, 'edit') THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.influencer_campaigns WHERE id = p_id AND org_id = p_org_id FOR UPDATE;
  IF NOT FOUND OR p_version IS NULL OR v_row.version <> p_version THEN
    RAISE EXCEPTION 'campaign_conflict' USING ERRCODE = '40001';
  END IF;
  IF p_status IS NULL OR NOT (
    (v_row.status = 'draft' AND p_status IN ('active', 'cancelled')) OR
    (v_row.status = 'active' AND p_status IN ('paused', 'completed', 'cancelled')) OR
    (v_row.status = 'paused' AND p_status IN ('active', 'cancelled'))
  ) THEN RAISE EXCEPTION 'invalid_campaign_transition'; END IF;
  IF p_status = 'active' AND (
    length(btrim(v_row.brief)) < 20 OR v_row.budget_ars <= 0 OR v_row.due_date IS NULL OR v_row.due_date < current_date OR
    NOT EXISTS (SELECT 1 FROM public.influencer_campaign_creators WHERE campaign_id = p_id) OR
    EXISTS (SELECT 1 FROM public.influencer_campaign_creators c JOIN public.influencers i ON i.id = c.influencer_id
      WHERE c.campaign_id = p_id AND i.status NOT IN ('active', 'activo'))
  ) THEN RAISE EXCEPTION 'campaign_not_ready'; END IF;
  UPDATE public.influencer_campaigns SET status = p_status, version = version + 1, updated_at = now()
    WHERE id = p_id RETURNING * INTO v_row;
  INSERT INTO public.influencer_campaign_events(org_id, campaign_id, actor_id, action) VALUES (p_org_id, p_id, auth.uid(), p_status);
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.save_influencer_campaign(uuid, uuid, integer, text, text, text, text, numeric, date, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_influencer_campaign(uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_influencer_campaign(uuid, uuid, integer, text, text, text, text, numeric, date, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_influencer_campaign(uuid, uuid, integer, text) TO authenticated;

COMMIT;
