-- Smart Alerts Engine: rule-based alerts with conditions, channels, cooldowns

CREATE TABLE IF NOT EXISTS alert_rules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  category        text        NOT NULL DEFAULT 'business' CHECK (category IN ('stock','sales','financial','operations','customer','business','system')),
  metric          text        NOT NULL,   -- e.g. "stock_level", "daily_revenue", "churn_risk"
  condition_op    text        NOT NULL CHECK (condition_op IN ('gt','lt','gte','lte','eq','neq','change_pct')),
  threshold       numeric(18,4) NOT NULL DEFAULT 0,
  time_window_min int         NOT NULL DEFAULT 1440,  -- how far back to look
  channels        text[]      NOT NULL DEFAULT '{app}' CHECK (channels <@ ARRAY['app','email','whatsapp','slack','webhook']),
  recipients      uuid[]      NOT NULL DEFAULT '{}',
  cooldown_min    int         NOT NULL DEFAULT 60,    -- minimum minutes between same alert firings
  priority        text        NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low','info')),
  is_active       boolean     NOT NULL DEFAULT true,
  last_triggered  timestamptz,
  trigger_count   int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id         uuid        REFERENCES alert_rules(id) ON DELETE SET NULL,
  rule_name       text        NOT NULL,
  category        text        NOT NULL,
  priority        text        NOT NULL,
  title           text        NOT NULL,
  message         text        NOT NULL,
  metric_value    numeric(18,4),
  threshold_value numeric(18,4),
  channels_sent   text[]      NOT NULL DEFAULT '{}',
  acknowledged_by uuid        REFERENCES auth.users(id),
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id         uuid        NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  channels        text[]      NOT NULL DEFAULT '{app}',
  is_active       boolean     NOT NULL DEFAULT true,
  UNIQUE (user_id, rule_id)
);

-- Alert summary by category
CREATE OR REPLACE VIEW alert_summary AS
SELECT
  ae.org_id,
  ae.category,
  ae.priority,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE ae.acknowledged_at IS NULL AND ae.resolved_at IS NULL) AS unresolved,
  COUNT(*) FILTER (WHERE ae.created_at >= now() - interval '24 hours') AS last_24h,
  MAX(ae.created_at) AS latest
FROM alert_events ae
GROUP BY ae.org_id, ae.category, ae.priority;

-- Trigger updated_at
CREATE OR REPLACE TRIGGER trg_alert_rules_ts BEFORE UPDATE ON alert_rules FOR EACH ROW EXECUTE FUNCTION update_scenario_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_alert_rules_org      ON alert_rules(org_id, category, is_active);
CREATE INDEX IF NOT EXISTS idx_alert_events_org     ON alert_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_unread  ON alert_events(org_id, acknowledged_at) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alert_subs_user      ON alert_subscriptions(user_id, is_active);

-- RLS
ALTER TABLE alert_rules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_alert_rules"  ON alert_rules;
DROP POLICY IF EXISTS "org_alert_events" ON alert_events;
DROP POLICY IF EXISTS "org_alert_subs"   ON alert_subscriptions;

CREATE POLICY "org_alert_rules"  ON alert_rules         USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_alert_events" ON alert_events        USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_alert_subs"   ON alert_subscriptions USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
