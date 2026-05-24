-- SLA Rules & Escalations for Support Tickets

CREATE TABLE IF NOT EXISTS sla_policies (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  priority        text        NOT NULL DEFAULT 'normal'
                              CHECK (priority IN ('low','normal','high','urgent','critical')),
  first_response_minutes  int NOT NULL DEFAULT 60,
  resolution_minutes      int NOT NULL DEFAULT 480,
  business_hours_only boolean NOT NULL DEFAULT true,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sla_breaches (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id       uuid        REFERENCES support_tickets(id) ON DELETE CASCADE,
  policy_id       uuid        REFERENCES sla_policies(id) ON DELETE SET NULL,
  breach_type     text        NOT NULL CHECK (breach_type IN ('first_response','resolution')),
  due_at          timestamptz NOT NULL,
  breached_at     timestamptz NOT NULL DEFAULT now(),
  minutes_overdue int         NOT NULL DEFAULT 0,
  resolved        boolean     NOT NULL DEFAULT false,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS escalation_rules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  policy_id       uuid        REFERENCES sla_policies(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  trigger_minutes int         NOT NULL DEFAULT 30,  -- minutes before/after SLA breach
  action_type     text        NOT NULL DEFAULT 'notify'
                              CHECK (action_type IN ('notify','reassign','priority_bump','close')),
  notify_email    text,
  notify_role     text,       -- admin | vendedor
  priority_bump_to text,      -- new priority if action_type='priority_bump'
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sla_ticket_assignments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id       uuid        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  policy_id       uuid        NOT NULL REFERENCES sla_policies(id) ON DELETE RESTRICT,
  first_response_due_at  timestamptz NOT NULL,
  resolution_due_at      timestamptz NOT NULL,
  first_responded_at     timestamptz,
  resolved_at            timestamptz,
  first_response_met     boolean,
  resolution_met         boolean,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_sla_policies_org   ON sla_policies(org_id, priority, active);
CREATE INDEX IF NOT EXISTS idx_sla_breaches_org   ON sla_breaches(org_id, resolved, breached_at DESC);
CREATE INDEX IF NOT EXISTS idx_sla_tickets_due    ON sla_ticket_assignments(org_id, resolution_due_at);
CREATE INDEX IF NOT EXISTS idx_escalation_rules   ON escalation_rules(org_id, active);

-- Calculate SLA due times for a ticket (call after assigning policy)
CREATE OR REPLACE FUNCTION assign_sla_to_ticket(
  p_ticket_id uuid,
  p_policy_id uuid,
  p_org_id uuid,
  p_created_at timestamptz DEFAULT now()
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  pol sla_policies%ROWTYPE;
BEGIN
  SELECT * INTO pol FROM sla_policies WHERE id = p_policy_id;

  INSERT INTO sla_ticket_assignments(
    org_id, ticket_id, policy_id,
    first_response_due_at, resolution_due_at
  ) VALUES (
    p_org_id,
    p_ticket_id,
    p_policy_id,
    p_created_at + (pol.first_response_minutes || ' minutes')::interval,
    p_created_at + (pol.resolution_minutes || ' minutes')::interval
  )
  ON CONFLICT (ticket_id) DO UPDATE SET
    policy_id = p_policy_id,
    first_response_due_at = p_created_at + (pol.first_response_minutes || ' minutes')::interval,
    resolution_due_at = p_created_at + (pol.resolution_minutes || ' minutes')::interval;
END;
$$;

-- Check and record SLA breaches
CREATE OR REPLACE FUNCTION check_sla_breaches(p_org_id uuid)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  breach_count int := 0;
  rec record;
BEGIN
  FOR rec IN
    SELECT sta.*, t.status as ticket_status
    FROM sla_ticket_assignments sta
    JOIN support_tickets t ON t.id = sta.ticket_id
    WHERE sta.org_id = p_org_id
      AND t.status NOT IN ('closed','resolved')
  LOOP
    -- First response breach
    IF rec.first_responded_at IS NULL AND now() > rec.first_response_due_at THEN
      INSERT INTO sla_breaches(org_id, ticket_id, policy_id, breach_type, due_at, minutes_overdue)
      VALUES (
        p_org_id, rec.ticket_id, rec.policy_id, 'first_response', rec.first_response_due_at,
        EXTRACT(EPOCH FROM (now() - rec.first_response_due_at))::int / 60
      )
      ON CONFLICT DO NOTHING;
      breach_count := breach_count + 1;
    END IF;
    -- Resolution breach
    IF rec.resolved_at IS NULL AND now() > rec.resolution_due_at THEN
      INSERT INTO sla_breaches(org_id, ticket_id, policy_id, breach_type, due_at, minutes_overdue)
      VALUES (
        p_org_id, rec.ticket_id, rec.policy_id, 'resolution', rec.resolution_due_at,
        EXTRACT(EPOCH FROM (now() - rec.resolution_due_at))::int / 60
      )
      ON CONFLICT DO NOTHING;
      breach_count := breach_count + 1;
    END IF;
  END LOOP;
  RETURN breach_count;
END;
$$;

-- updated_at
CREATE OR REPLACE FUNCTION update_sla_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_sla_policies_updated ON sla_policies;
CREATE TRIGGER trg_sla_policies_updated
  BEFORE UPDATE ON sla_policies
  FOR EACH ROW EXECUTE FUNCTION update_sla_timestamp();

-- RLS
ALTER TABLE sla_policies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_breaches          ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_ticket_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_sla_policies"   ON sla_policies;
DROP POLICY IF EXISTS "org_sla_breaches"   ON sla_breaches;
DROP POLICY IF EXISTS "org_esc_rules"      ON escalation_rules;
DROP POLICY IF EXISTS "org_sla_tickets"    ON sla_ticket_assignments;

CREATE POLICY "org_sla_policies"   ON sla_policies            USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_sla_breaches"   ON sla_breaches            USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_esc_rules"      ON escalation_rules        USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_sla_tickets"    ON sla_ticket_assignments  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
