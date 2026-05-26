-- Customer Self-Service Portal

CREATE TABLE IF NOT EXISTS portal_configs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  enabled         boolean     NOT NULL DEFAULT true,
  allow_orders    boolean     NOT NULL DEFAULT true,
  allow_invoices  boolean     NOT NULL DEFAULT true,
  allow_tickets   boolean     NOT NULL DEFAULT true,
  allow_loyalty   boolean     NOT NULL DEFAULT true,
  welcome_message text,
  custom_domain   text,
  accent_color    text        NOT NULL DEFAULT '#6366f1',
  logo_url        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id     uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token           text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '7 days',
  last_seen_at    timestamptz,
  ip_address      inet,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_tickets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id     uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  ticket_number   text        NOT NULL,
  subject         text        NOT NULL,
  description     text        NOT NULL,
  priority        text        NOT NULL DEFAULT 'normal'
                              CHECK (priority IN ('low','normal','high','urgent')),
  status          text        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','in_progress','waiting','resolved','closed')),
  category        text        NOT NULL DEFAULT 'general'
                              CHECK (category IN ('general','billing','technical','shipping','returns','other')),
  reference_type  text,       -- 'sale', 'invoice', etc.
  reference_id    uuid,
  assigned_to     text,
  resolved_at     timestamptz,
  closed_at       timestamptz,
  satisfaction    int         CHECK (satisfaction BETWEEN 1 AND 5),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_ticket_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid        NOT NULL REFERENCES portal_tickets(id) ON DELETE CASCADE,
  sender_type     text        NOT NULL CHECK (sender_type IN ('customer','agent')),
  sender_name     text        NOT NULL,
  message         text        NOT NULL,
  attachment_url  text,
  is_internal     boolean     NOT NULL DEFAULT false,   -- internal notes hidden from customer
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto ticket number
CREATE OR REPLACE FUNCTION generate_ticket_number(p_org_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) + 1 INTO v_count FROM portal_tickets WHERE org_id = p_org_id;
  RETURN 'TKT-' || to_char(now(), 'YYYY') || '-' || lpad(v_count::text, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION set_ticket_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := generate_ticket_number(NEW.org_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_number ON portal_tickets;
CREATE TRIGGER trg_ticket_number BEFORE INSERT ON portal_tickets
  FOR EACH ROW EXECUTE FUNCTION set_ticket_number();

CREATE OR REPLACE FUNCTION update_ticket_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_ts ON portal_tickets;
CREATE TRIGGER trg_ticket_ts BEFORE UPDATE ON portal_tickets
  FOR EACH ROW EXECUTE FUNCTION update_ticket_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_portal_sessions_token    ON portal_sessions(token);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_cust     ON portal_sessions(customer_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_portal_tickets_org       ON portal_tickets(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_tickets_cust      ON portal_tickets(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_portal_ticket_msgs       ON portal_ticket_messages(ticket_id, created_at);

-- RLS
ALTER TABLE portal_configs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_tickets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_ticket_messages  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_portal_configs"  ON portal_configs;
DROP POLICY IF EXISTS "org_portal_sessions" ON portal_sessions;
DROP POLICY IF EXISTS "org_portal_tickets"  ON portal_tickets;
DROP POLICY IF EXISTS "org_portal_msgs"     ON portal_ticket_messages;

CREATE POLICY "org_portal_configs" ON portal_configs
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_portal_sessions" ON portal_sessions
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_portal_tickets" ON portal_tickets
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_portal_msgs" ON portal_ticket_messages
  USING (ticket_id IN (SELECT id FROM portal_tickets WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
