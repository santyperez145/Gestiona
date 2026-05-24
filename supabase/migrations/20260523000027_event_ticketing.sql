-- Event Management & Ticketing

CREATE TABLE IF NOT EXISTS events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  event_date      timestamptz NOT NULL,
  end_date        timestamptz,
  location        text,
  venue_name      text,
  capacity        int         NOT NULL DEFAULT 100,
  tickets_sold    int         NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','published','cancelled','completed')),
  cover_image_url text,
  tags            text[]      NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_types (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  price           numeric(12,2) NOT NULL DEFAULT 0,
  quantity        int         NOT NULL DEFAULT 50,
  sold            int         NOT NULL DEFAULT 0,
  max_per_order   int         NOT NULL DEFAULT 5,
  sale_start      timestamptz,
  sale_end        timestamptz,
  color           text        NOT NULL DEFAULT '#6366f1',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_attendees (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_type_id  uuid        NOT NULL REFERENCES ticket_types(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  name            text        NOT NULL,
  email           text,
  phone           text,
  ticket_code     text        NOT NULL DEFAULT '',
  quantity        int         NOT NULL DEFAULT 1,
  amount_paid     numeric(12,2) NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'confirmed'
                              CHECK (status IN ('reserved','confirmed','checked_in','cancelled','no_show')),
  checked_in_at   timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Generate unique ticket code
CREATE OR REPLACE FUNCTION generate_ticket_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  code text;
  exists_flag bool;
BEGIN
  LOOP
    code := upper(substring(md5(random()::text || clock_timestamp()::text) for 8));
    SELECT EXISTS(SELECT 1 FROM event_attendees WHERE ticket_code = code) INTO exists_flag;
    EXIT WHEN NOT exists_flag;
  END LOOP;
  RETURN code;
END;
$$;

-- Auto-generate ticket code on insert
CREATE OR REPLACE FUNCTION set_ticket_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ticket_code IS NULL OR NEW.ticket_code = '' THEN
    NEW.ticket_code := generate_ticket_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_code ON event_attendees;
CREATE TRIGGER trg_ticket_code BEFORE INSERT ON event_attendees
  FOR EACH ROW EXECUTE FUNCTION set_ticket_code();

-- Update sold count when attendees change
CREATE OR REPLACE FUNCTION update_ticket_sold_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'cancelled' THEN
    UPDATE ticket_types SET sold = sold + NEW.quantity WHERE id = NEW.ticket_type_id;
    UPDATE events SET tickets_sold = tickets_sold + NEW.quantity WHERE id = NEW.event_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'cancelled' AND NEW.status = 'cancelled' THEN
      UPDATE ticket_types SET sold = GREATEST(0, sold - OLD.quantity) WHERE id = OLD.ticket_type_id;
      UPDATE events SET tickets_sold = GREATEST(0, tickets_sold - OLD.quantity) WHERE id = OLD.event_id;
    ELSIF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
      UPDATE ticket_types SET sold = sold + NEW.quantity WHERE id = NEW.ticket_type_id;
      UPDATE events SET tickets_sold = tickets_sold + NEW.quantity WHERE id = NEW.event_id;
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.status <> 'cancelled' THEN
    UPDATE ticket_types SET sold = GREATEST(0, sold - OLD.quantity) WHERE id = OLD.ticket_type_id;
    UPDATE events SET tickets_sold = GREATEST(0, tickets_sold - OLD.quantity) WHERE id = OLD.event_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_sold ON event_attendees;
CREATE TRIGGER trg_ticket_sold AFTER INSERT OR UPDATE OR DELETE ON event_attendees
  FOR EACH ROW EXECUTE FUNCTION update_ticket_sold_count();

-- updated_at triggers
CREATE OR REPLACE FUNCTION update_event_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_event_updated ON events;
CREATE TRIGGER trg_event_updated BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_event_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_events_org        ON events(org_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_types_evt  ON ticket_types(event_id);
CREATE INDEX IF NOT EXISTS idx_attendees_evt     ON event_attendees(event_id, status);
CREATE INDEX IF NOT EXISTS idx_attendees_code    ON event_attendees(ticket_code);
CREATE INDEX IF NOT EXISTS idx_attendees_cust    ON event_attendees(customer_id);

-- RLS
ALTER TABLE events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_types    ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_events"     ON events;
DROP POLICY IF EXISTS "org_ticket_types" ON ticket_types;
DROP POLICY IF EXISTS "org_attendees"  ON event_attendees;

CREATE POLICY "org_events"       ON events
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ticket_types" ON ticket_types
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_attendees"    ON event_attendees
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
