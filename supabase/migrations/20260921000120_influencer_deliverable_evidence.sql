BEGIN;
ALTER TABLE public.influencer_deliverables
  ADD COLUMN IF NOT EXISTS campaign_id uuid,
  ADD COLUMN IF NOT EXISTS content_url text,
  ADD COLUMN IF NOT EXISTS review_notes text;
ALTER TABLE public.influencer_deliverables ADD CONSTRAINT deliverable_campaign_org_fk
  FOREIGN KEY (org_id, campaign_id) REFERENCES public.influencer_campaigns(org_id, id) ON DELETE RESTRICT;
CREATE INDEX ON public.influencer_deliverables(org_id, campaign_id);

CREATE OR REPLACE FUNCTION public.validate_influencer_deliverable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.campaign_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.influencer_campaign_creators
      WHERE org_id = NEW.org_id AND campaign_id = NEW.campaign_id AND influencer_id = NEW.influencer_id)
      THEN RAISE EXCEPTION 'creator_not_assigned_to_campaign'; END IF;
    SELECT title INTO NEW.campaign_name FROM public.influencer_campaigns WHERE id = NEW.campaign_id AND org_id = NEW.org_id;
  END IF;
  IF NEW.content_url IS NOT NULL AND NEW.content_url !~ '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_content_url'; END IF;
  IF NEW.status IN ('entregado', 'completado') AND coalesce(length(btrim(NEW.content_url)), 0) = 0 THEN
    RAISE EXCEPTION 'content_evidence_required'; END IF;
  IF NEW.status = 'completado' THEN
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'review_required'; END IF;
    IF OLD.status NOT IN ('entregado', 'completado') OR coalesce(length(btrim(NEW.review_notes)), 0) = 0 THEN
      RAISE EXCEPTION 'review_required'; END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_influencer_deliverable() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_deliverable BEFORE INSERT OR UPDATE ON public.influencer_deliverables
  FOR EACH ROW EXECUTE FUNCTION public.validate_influencer_deliverable();
COMMIT;
