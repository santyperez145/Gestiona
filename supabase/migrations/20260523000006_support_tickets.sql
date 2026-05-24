-- Support Tickets & Case Management
-- Gestiona ERP/CRM — Salesforce-level Service Cloud equivalent

-- ─── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support_tickets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_number   text        NOT NULL,
  title           text        NOT NULL,
  description     text,
  status          text        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','in_progress','waiting_customer','resolved','closed')),
  priority        text        NOT NULL DEFAULT 'medium'
                              CHECK (priority IN ('low','medium','high','urgent')),
  category        text        DEFAULT 'general'
                              CHECK (category IN ('technical','billing','general','returns','shipping','other')),
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   text,
  customer_email  text,
  assigned_to     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_name   text,
  resolved_at     timestamptz,
  first_response_at timestamptz,
  sla_breach      boolean     NOT NULL DEFAULT false,
  sla_due_at      timestamptz,
  tags            text[],
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  org_id      uuid        NOT NULL,
  author_name text        NOT NULL,
  author_type text        NOT NULL DEFAULT 'agent'
                          CHECK (author_type IN ('agent','customer','system')),
  body        text        NOT NULL,
  is_internal boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_support_tickets_org        ON support_tickets(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status     ON support_tickets(org_id, status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority   ON support_tickets(org_id, priority) WHERE status NOT IN ('resolved','closed');
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket    ON support_ticket_messages(ticket_id, created_at);

-- ─── SLA breach updater (mark tickets past SLA due date) ──────────────────────

CREATE OR REPLACE FUNCTION check_sla_breaches()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE support_tickets
  SET sla_breach = true, updated_at = now()
  WHERE sla_due_at < now()
    AND status NOT IN ('resolved','closed')
    AND sla_breach = false;
END;
$$;

-- ─── updated_at trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_support_ticket_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_support_tickets_updated ON support_tickets;
CREATE TRIGGER trg_support_tickets_updated
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_support_ticket_timestamp();

-- ─── View: open tickets with SLA status ──────────────────────────────────────

CREATE OR REPLACE VIEW support_open_tickets AS
SELECT
  t.*,
  CASE
    WHEN t.sla_due_at < now() AND t.status NOT IN ('resolved','closed') THEN 'breached'
    WHEN t.sla_due_at < now() + interval '2 hours' AND t.status NOT IN ('resolved','closed') THEN 'at_risk'
    ELSE 'ok'
  END AS sla_status,
  EXTRACT(EPOCH FROM (COALESCE(t.resolved_at, now()) - t.created_at)) / 3600 AS age_hours
FROM support_tickets t
WHERE t.status NOT IN ('closed');

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE support_tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_support_tickets"  ON support_tickets;
DROP POLICY IF EXISTS "org_support_messages" ON support_ticket_messages;

CREATE POLICY "org_support_tickets" ON support_tickets
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_support_messages" ON support_ticket_messages
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
