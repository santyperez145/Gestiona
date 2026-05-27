-- HR Portal: employees, leave requests, performance reviews, org chart

CREATE TABLE IF NOT EXISTS employees (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  employee_code     text        GENERATED ALWAYS AS (
                      'EMP-' || LPAD(CAST(EXTRACT(EPOCH FROM created_at)::bigint % 100000 AS text), 5, '0')
                    ) STORED,
  first_name        text        NOT NULL,
  last_name         text        NOT NULL,
  email             text,
  phone             text,
  cuil              text,
  position          text        NOT NULL DEFAULT '',
  department        text        NOT NULL DEFAULT 'General',
  hire_date         date        NOT NULL DEFAULT CURRENT_DATE,
  termination_date  date,
  contract_type     text        NOT NULL DEFAULT 'full_time' CHECK (contract_type IN ('full_time','part_time','contractor','intern','temporary')),
  salary            numeric(14,2) NOT NULL DEFAULT 0,
  salary_currency   text        NOT NULL DEFAULT 'ARS',
  manager_id        uuid        REFERENCES employees(id) ON DELETE SET NULL,
  status            text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_leave','terminated','suspended')),
  address           text,
  emergency_contact text,
  notes             text,
  avatar_url        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leave_types (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  max_days_per_year int       NOT NULL DEFAULT 15,
  is_paid         boolean     NOT NULL DEFAULT true,
  color           text        NOT NULL DEFAULT '#3b82f6',
  requires_approval boolean   NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id   uuid        NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_date      date        NOT NULL,
  end_date        date        NOT NULL,
  days_count      int         NOT NULL DEFAULT 1,
  reason          text,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  approved_by     uuid        REFERENCES auth.users(id),
  approved_at     timestamptz,
  rejection_reason text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS performance_reviews (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  reviewer_id     uuid        REFERENCES auth.users(id),
  review_period   text        NOT NULL,   -- e.g. '2026-Q1', '2026-H1', '2026'
  review_type     text        NOT NULL DEFAULT 'annual' CHECK (review_type IN ('probation','quarterly','semi_annual','annual','360')),
  overall_rating  numeric(3,1) CHECK (overall_rating BETWEEN 1 AND 5),
  goals_score     numeric(3,1) CHECK (goals_score BETWEEN 1 AND 5),
  skills_score    numeric(3,1) CHECK (skills_score BETWEEN 1 AND 5),
  teamwork_score  numeric(3,1) CHECK (teamwork_score BETWEEN 1 AND 5),
  leadership_score numeric(3,1) CHECK (leadership_score BETWEEN 1 AND 5),
  strengths       text,
  improvements    text,
  comments        text,
  status          text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','acknowledged')),
  acknowledged_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, review_period, review_type)
);

CREATE TABLE IF NOT EXISTS employee_documents (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_type   text        NOT NULL CHECK (document_type IN ('dni','cuil','contract','medical','certificate','other')),
  file_name       text        NOT NULL,
  file_url        text,
  expiry_date     date,
  notes           text,
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);

-- Seed default leave types
CREATE OR REPLACE FUNCTION seed_leave_types(p_org_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO leave_types (org_id, name, max_days_per_year, is_paid, color, requires_approval)
  VALUES
    (p_org_id, 'Vacaciones',          15, true,  '#3b82f6', true),
    (p_org_id, 'Licencia médica',     10, true,  '#ef4444', true),
    (p_org_id, 'Licencia por duelo',   5, true,  '#6b7280', true),
    (p_org_id, 'Estudio / examen',     10, true, '#8b5cf6', true),
    (p_org_id, 'Maternidad/Paternidad',90,true,  '#ec4899', true),
    (p_org_id, 'Sin goce de sueldo',  30, false, '#f97316', true)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_employee_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE OR REPLACE TRIGGER trg_employee_ts
BEFORE UPDATE ON employees
FOR EACH ROW EXECUTE FUNCTION update_employee_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_employees_org        ON employees(org_id, status, department);
CREATE INDEX IF NOT EXISTS idx_employees_manager    ON employees(manager_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_emp   ON leave_requests(employee_id, status, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_perf_reviews_emp     ON performance_reviews(employee_id, review_period DESC);
CREATE INDEX IF NOT EXISTS idx_emp_docs_emp         ON employee_documents(employee_id);

-- RLS
ALTER TABLE employees          ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_employees"         ON employees;
DROP POLICY IF EXISTS "org_leave_types"       ON leave_types;
DROP POLICY IF EXISTS "org_leave_requests"    ON leave_requests;
DROP POLICY IF EXISTS "org_perf_reviews"      ON performance_reviews;
DROP POLICY IF EXISTS "org_emp_docs"          ON employee_documents;

CREATE POLICY "org_employees"         ON employees          USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_leave_types"       ON leave_types        USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_leave_requests"    ON leave_requests     USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_perf_reviews"      ON performance_reviews USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_emp_docs"          ON employee_documents  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
