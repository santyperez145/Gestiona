-- Appointment Booking & Scheduling

CREATE TABLE IF NOT EXISTS services (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  duration_minutes int        NOT NULL DEFAULT 60,
  price           numeric(12,2) NOT NULL DEFAULT 0,
  color           text        NOT NULL DEFAULT '#6366f1',
  buffer_minutes  int         NOT NULL DEFAULT 0,
  max_attendees   int         NOT NULL DEFAULT 1,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_availability (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_user_id   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  staff_name      text        NOT NULL,
  day_of_week     int         NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun
  start_time      time        NOT NULL,
  end_time        time        NOT NULL,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appointments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_id      uuid        NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  staff_name      text,
  customer_name   text        NOT NULL,
  customer_email  text,
  customer_phone  text,
  start_at        timestamptz NOT NULL,
  end_at          timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','confirmed','cancelled','completed','no_show')),
  price           numeric(12,2) NOT NULL DEFAULT 0,
  deposit_paid    numeric(12,2) NOT NULL DEFAULT 0,
  notes           text,
  internal_notes  text,
  reminder_sent   boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appointment_blocks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  staff_name      text,
  start_at        timestamptz NOT NULL,
  end_at          timestamptz NOT NULL,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- updated_at
CREATE OR REPLACE FUNCTION update_appointment_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_svc_updated ON services;
CREATE TRIGGER trg_svc_updated BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION update_appointment_ts();

DROP TRIGGER IF EXISTS trg_apt_updated ON appointments;
CREATE TRIGGER trg_apt_updated BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION update_appointment_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_services_org       ON services(org_id, active);
CREATE INDEX IF NOT EXISTS idx_availability_org   ON staff_availability(org_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_appointments_org   ON appointments(org_id, start_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_svc   ON appointments(service_id, start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_cust  ON appointments(customer_id);
CREATE INDEX IF NOT EXISTS idx_apt_blocks_org     ON appointment_blocks(org_id, start_at);

-- RLS
ALTER TABLE services             ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_availability   ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_blocks   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_services"       ON services;
DROP POLICY IF EXISTS "org_availability"   ON staff_availability;
DROP POLICY IF EXISTS "org_appointments"   ON appointments;
DROP POLICY IF EXISTS "org_apt_blocks"     ON appointment_blocks;

CREATE POLICY "org_services"     ON services
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_availability" ON staff_availability
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_appointments" ON appointments
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_apt_blocks"   ON appointment_blocks
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
