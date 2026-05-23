-- Deal Activity Timeline
-- Logs all interactions per deal: notes, calls, emails, meetings, stage changes.
-- Powers the Salesforce-like activity feed in the Sales Pipeline.

CREATE TABLE IF NOT EXISTS deal_activities (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id     uuid        NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id     uuid        REFERENCES auth.users(id),
  type        text        NOT NULL CHECK (type IN ('note', 'call', 'email', 'meeting', 'stage_change', 'whatsapp')),
  content     text        NOT NULL,
  meta        jsonb,      -- e.g. { from_stage: "lead", to_stage: "propuesta" }
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE deal_activities ENABLE ROW LEVEL SECURITY;

-- Org members can manage activities for deals in their org
CREATE POLICY "org members manage deal activities"
  ON deal_activities FOR ALL
  USING (
    org_id IN (
      SELECT org_id FROM org_members WHERE user_id = auth.uid()
    )
  );

-- Index for efficient per-deal queries (newest first)
CREATE INDEX IF NOT EXISTS idx_deal_activities_deal
  ON deal_activities (deal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deal_activities_org
  ON deal_activities (org_id, created_at DESC);
