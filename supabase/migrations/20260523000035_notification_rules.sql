-- Smart Notification Rules Engine

CREATE TABLE IF NOT EXISTS notification_rules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  trigger_event   text        NOT NULL,
  -- trigger_event examples: 'sale_created', 'low_stock', 'payment_overdue',
  --   'new_customer', 'sla_breach', 'appointment_reminder', 'order_delivered',
  --   'warranty_updated', 'rfq_responded', 'goal_achieved'
  conditions      jsonb       NOT NULL DEFAULT '[]',
  -- conditions: [{ "field": "amount", "op": "gte", "value": 10000 }]
  actions         jsonb       NOT NULL DEFAULT '[]',
  -- actions: [
  --   { "type": "email", "to": "admin@acme.com", "subject": "...", "body": "..." },
  --   { "type": "whatsapp", "phone": "5491123456789", "message": "..." },
  --   { "type": "internal_alert", "title": "...", "severity": "info|warning|critical" },
  --   { "type": "webhook", "url": "https://...", "method": "POST" }
  -- ]
  channels        text[]      NOT NULL DEFAULT '{internal_alert}',
  active          boolean     NOT NULL DEFAULT true,
  cooldown_minutes int        NOT NULL DEFAULT 60,
  last_fired_at   timestamptz,
  fire_count      int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id         uuid        REFERENCES notification_rules(id) ON DELETE SET NULL,
  trigger_event   text        NOT NULL,
  channel         text        NOT NULL,
  recipient       text,
  subject         text,
  body            text,
  status          text        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed','skipped')),
  error_message   text,
  payload         jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Update fire stats when rule fires
CREATE OR REPLACE FUNCTION record_rule_fire(p_rule_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE notification_rules
  SET fire_count = fire_count + 1, last_fired_at = now(), updated_at = now()
  WHERE id = p_rule_id;
END;
$$;

-- updated_at
CREATE OR REPLACE FUNCTION update_notif_rule_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_notif_rule_updated ON notification_rules;
CREATE TRIGGER trg_notif_rule_updated BEFORE UPDATE ON notification_rules
  FOR EACH ROW EXECUTE FUNCTION update_notif_rule_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notif_rules_org   ON notification_rules(org_id, active, trigger_event);
CREATE INDEX IF NOT EXISTS idx_notif_log_org     ON notification_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_log_rule    ON notification_log(rule_id, created_at DESC);

-- RLS
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_notif_rules" ON notification_rules;
DROP POLICY IF EXISTS "org_notif_log"   ON notification_log;

CREATE POLICY "org_notif_rules" ON notification_rules
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_notif_log" ON notification_log
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
