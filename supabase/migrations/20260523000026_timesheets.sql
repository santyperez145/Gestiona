-- Employee Timesheets & Attendance

CREATE TABLE IF NOT EXISTS employees (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  name            text        NOT NULL,
  email           text,
  phone           text,
  position        text,
  department      text,
  hourly_rate     numeric(10,2) NOT NULL DEFAULT 0,
  salary_type     text        NOT NULL DEFAULT 'hourly'
                              CHECK (salary_type IN ('hourly','monthly','commission')),
  active          boolean     NOT NULL DEFAULT true,
  hired_at        date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timesheets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date            date        NOT NULL,
  clock_in        time,
  clock_out       time,
  break_minutes   int         NOT NULL DEFAULT 0,
  hours_worked    numeric(6,2) GENERATED ALWAYS AS (
    CASE WHEN clock_in IS NOT NULL AND clock_out IS NOT NULL
    THEN GREATEST(0, EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0 - break_minutes / 60.0)
    ELSE 0 END
  ) STORED,
  overtime_hours  numeric(6,2) NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','submitted','approved','rejected')),
  notes           text,
  approved_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS payroll_periods (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  period_start    date        NOT NULL,
  period_end      date        NOT NULL,
  status          text        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','closed','paid')),
  total_gross     numeric(14,2) NOT NULL DEFAULT 0,
  total_net       numeric(14,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_entries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id       uuid        NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  total_hours     numeric(8,2) NOT NULL DEFAULT 0,
  overtime_hours  numeric(8,2) NOT NULL DEFAULT 0,
  gross_amount    numeric(12,2) NOT NULL DEFAULT 0,
  deductions      numeric(12,2) NOT NULL DEFAULT 0,
  net_amount      numeric(12,2) NOT NULL DEFAULT 0,
  notes           text,
  UNIQUE (period_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_employees_org    ON employees(org_id, active);
CREATE INDEX IF NOT EXISTS idx_timesheets_emp   ON timesheets(employee_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_timesheets_org   ON timesheets(org_id, status, date DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_org      ON payroll_periods(org_id, status);
CREATE INDEX IF NOT EXISTS idx_payroll_entries  ON payroll_entries(period_id, employee_id);

-- Generate payroll for a period
CREATE OR REPLACE FUNCTION generate_payroll(p_period_id uuid, p_org_id uuid)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  period payroll_periods%ROWTYPE;
  emp_rec record;
  entry_count int := 0;
BEGIN
  SELECT * INTO period FROM payroll_periods WHERE id = p_period_id;

  FOR emp_rec IN
    SELECT e.id, e.hourly_rate,
           COALESCE(SUM(t.hours_worked), 0) as total_hours,
           COALESCE(SUM(t.overtime_hours), 0) as overtime
    FROM employees e
    LEFT JOIN timesheets t ON t.employee_id = e.id
      AND t.date BETWEEN period.period_start AND period.period_end
      AND t.status = 'approved'
    WHERE e.org_id = p_org_id AND e.active = true AND e.salary_type = 'hourly'
    GROUP BY e.id, e.hourly_rate
  LOOP
    INSERT INTO payroll_entries(period_id, org_id, employee_id, total_hours, overtime_hours,
      gross_amount, deductions, net_amount)
    VALUES (
      p_period_id, p_org_id, emp_rec.id,
      emp_rec.total_hours, emp_rec.overtime,
      emp_rec.total_hours * emp_rec.hourly_rate + emp_rec.overtime * emp_rec.hourly_rate * 1.5,
      0,
      emp_rec.total_hours * emp_rec.hourly_rate + emp_rec.overtime * emp_rec.hourly_rate * 1.5
    )
    ON CONFLICT (period_id, employee_id) DO UPDATE SET
      total_hours = EXCLUDED.total_hours,
      overtime_hours = EXCLUDED.overtime_hours,
      gross_amount = EXCLUDED.gross_amount,
      net_amount = EXCLUDED.net_amount;
    entry_count := entry_count + 1;
  END LOOP;

  UPDATE payroll_periods
  SET total_gross = (SELECT COALESCE(SUM(gross_amount), 0) FROM payroll_entries WHERE period_id = p_period_id),
      total_net   = (SELECT COALESCE(SUM(net_amount), 0) FROM payroll_entries WHERE period_id = p_period_id)
  WHERE id = p_period_id;

  RETURN entry_count;
END;
$$;

-- updated_at
CREATE OR REPLACE FUNCTION update_ts_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_emp_updated ON employees;
CREATE TRIGGER trg_emp_updated BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_ts_timestamp();

DROP TRIGGER IF EXISTS trg_ts_updated ON timesheets;
CREATE TRIGGER trg_ts_updated BEFORE UPDATE ON timesheets FOR EACH ROW EXECUTE FUNCTION update_ts_timestamp();

-- RLS
ALTER TABLE employees        ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_entries  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_employees"       ON employees;
DROP POLICY IF EXISTS "org_timesheets"      ON timesheets;
DROP POLICY IF EXISTS "org_payroll_periods" ON payroll_periods;
DROP POLICY IF EXISTS "org_payroll_entries" ON payroll_entries;

CREATE POLICY "org_employees"       ON employees       USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_timesheets"      ON timesheets      USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_payroll_periods" ON payroll_periods USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_payroll_entries" ON payroll_entries USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
