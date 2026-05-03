-- Email marketing campaigns
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subject      text        NOT NULL,
  body_html    text        NOT NULL,
  segment      text        NOT NULL DEFAULT 'all',
  status       text        NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  sent_count   integer     NOT NULL DEFAULT 0,
  failed_count integer     NOT NULL DEFAULT 0,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_manage_email_campaigns" ON public.email_campaigns
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS email_campaigns_org_id_idx ON public.email_campaigns(org_id);
CREATE INDEX IF NOT EXISTS email_campaigns_status_idx ON public.email_campaigns(org_id, status);
