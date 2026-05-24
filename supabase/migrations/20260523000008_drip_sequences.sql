-- Email Drip Sequence Campaigns
-- Gestiona ERP/CRM — Salesforce Marketing Cloud equivalent

-- ─── Sequences table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS drip_sequences (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name           text        NOT NULL,
  trigger_event  text        NOT NULL DEFAULT 'manual'
                             CHECK (trigger_event IN ('welcome','quote_sent','deal_lost','inactive_90d','post_purchase','manual')),
  active         boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── Sequence steps ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS drip_sequence_steps (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id  uuid        NOT NULL REFERENCES drip_sequences(id) ON DELETE CASCADE,
  org_id       uuid        NOT NULL,
  step_order   int         NOT NULL DEFAULT 1,
  day_offset   int         NOT NULL DEFAULT 1,  -- days after trigger to send
  subject      text        NOT NULL,
  body_html    text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── Enrollments ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS drip_enrollments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id     uuid        NOT NULL REFERENCES drip_sequences(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL,
  customer_email  text        NOT NULL,
  customer_name   text        NOT NULL DEFAULT '',
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  current_step    int         NOT NULL DEFAULT 0,
  total_steps     int         NOT NULL DEFAULT 1,
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','completed','unsubscribed','paused')),
  next_send_at    timestamptz,
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (sequence_id, customer_email)   -- prevent double enrollment
);

-- ─── Email send log ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS drip_send_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id  uuid        NOT NULL REFERENCES drip_enrollments(id) ON DELETE CASCADE,
  step_id        uuid        NOT NULL REFERENCES drip_sequence_steps(id) ON DELETE CASCADE,
  sent_at        timestamptz NOT NULL DEFAULT now(),
  status         text        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','bounced','opened','clicked'))
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_drip_sequences_org     ON drip_sequences(org_id);
CREATE INDEX IF NOT EXISTS idx_drip_steps_sequence    ON drip_sequence_steps(sequence_id, step_order);
CREATE INDEX IF NOT EXISTS idx_drip_enrollments_org   ON drip_enrollments(org_id, status);
CREATE INDEX IF NOT EXISTS idx_drip_enrollments_next  ON drip_enrollments(next_send_at) WHERE status = 'active';

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE drip_sequences      ENABLE ROW LEVEL SECURITY;
ALTER TABLE drip_sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE drip_enrollments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE drip_send_log       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_drip_sequences"      ON drip_sequences;
DROP POLICY IF EXISTS "org_drip_steps"          ON drip_sequence_steps;
DROP POLICY IF EXISTS "org_drip_enrollments"    ON drip_enrollments;
DROP POLICY IF EXISTS "org_drip_log"            ON drip_send_log;

CREATE POLICY "org_drip_sequences"   ON drip_sequences   USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_drip_steps"       ON drip_sequence_steps USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_drip_enrollments" ON drip_enrollments USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_drip_log"         ON drip_send_log USING (
  enrollment_id IN (SELECT id FROM drip_enrollments WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()))
);
