-- Email campaign metrics: open_count, click_count, unsubscribe_count
-- Resend webhook events table for tracking

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS open_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS click_count      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unsubscribe_count integer NOT NULL DEFAULT 0;

-- Per-email event tracking (one row per Resend webhook event)
CREATE TABLE IF NOT EXISTS public.email_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id   uuid REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  event_type    text NOT NULL CHECK (event_type IN ('open', 'click', 'bounce', 'complaint', 'unsubscribe', 'delivery')),
  recipient_email text,
  link_url      text,
  resend_email_id text,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view email events"
  ON public.email_events FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS email_events_campaign_idx ON public.email_events(campaign_id, occurred_at DESC);

-- Unsubscribes list per org (email addresses that opted out)
CREATE TABLE IF NOT EXISTS public.email_unsubscribes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email         text NOT NULL,
  unsubscribed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view unsubscribes"
  ON public.email_unsubscribes FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );
