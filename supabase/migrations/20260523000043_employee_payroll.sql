-- Employee Payroll & Liquidaciones de Sueldos

CREATE TABLE IF NOT EXISTS employees (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name       text        NOT NULL,
  email           text,
  phone           text,
  dni             text,
  cuil            text,
  position        text        NOT NULL DEFAULT 'vendedor',
  department      text,
  hire_date       date        NOT NULL DEFAULT CURRENT_DATE,
  termination_date date,
  base_salary     numeric(14,2) NOT NULL DEFAULT 0,
  salary_type     text        NOT NULL DEFAULT 'monthly'
                              CHECK (salary_type IN ('monthly','hourly','daily','commission')),
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','inactive','suspended')),
  bank_name       text,
  bank_cbu        text,
  avatar_url      text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_periods (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,   -- e.g. "Mayo 2026"
  year            int         NOT NULL,
  month           int         NOT NULL CHECK (month BETWEEN 1 AND 12),
  start_date      date        NOT NULL,
  end_date        date        NOT NULL,
  status          text        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','closed','paid')),
  paid_at         timestamptz,
  total_gross     numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions numeric(14,2) NOT NULL DEFAULT 0,
  total_net       numeric(14,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, year, month)
);

CREATE TABLE IF NOT EXISTS payroll_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_id       uuid        NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id     uuid        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  -- Haberes
  base_salary     numeric(14,2) NOT NULL DEFAULT 0,
  overtime_hours  numeric(8,2)  NOT NULL DEFAULT 0,
  overtime_amount numeric(14,2) NOT NULL DEFAULT 0,
  bonus           numeric(14,2) NOT NULL DEFAULT 0,
  commission      numeric(14,2) NOT NULL DEFAULT 0,
  extra_income    numeric(14,2) NOT NULL DEFAULT 0,
  gross_total     numeric(14,2) GENERATED ALWAYS AS (base_salary + overtime_amount + bonus + commission + extra_income) STORED,
  -- Deducciones
  jubilacion      numeric(14,2) NOT NULL DEFAULT 0,   -- 11%
  obra_social     numeric(14,2) NOT NULL DEFAULT 0,   -- 3%
  sindical        numeric(14,2) NOT NULL DEFAULT 0,
  advance         numeric(14,2) NOT NULL DEFAULT 0,   -- adelanto de sueldo
  other_deductions numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions numeric(14,2) GENERATED ALWAYS AS (jubilacion + obra_social + sindical + advance + other_deductions) STORED,
  net_salary      numeric(14,2) GENERATED ALWAYS AS (
    (base_salary + overtime_amount + bonus + commission + extra_income)
    - (jubilacion + obra_social + sindical + advance + other_deductions)
  ) STORED,
  worked_days     int         NOT NULL DEFAULT 30,
  absent_days     int         NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, employee_id)
);

-- Auto-calculate common deductions on insert
CREATE OR REPLACE FUNCTION auto_calc_deductions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Jubilación 11%, obra social 3% of base_salary if not set
  IF NEW.jubilacion = 0 AND NEW.base_salary > 0 THEN
    NEW.jubilacion := ROUND(NEW.base_salary * 0.11, 2);
  END IF;
  IF NEW.obra_social = 0 AND NEW.base_salary > 0 THEN
    NEW.obra_social := ROUND(NEW.base_salary * 0.03, 2);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payroll_deductions ON payroll_items;
CREATE TRIGGER trg_payroll_deductions BEFORE INSERT ON payroll_items
  FOR EACH ROW EXECUTE FUNCTION auto_calc_deductions();

-- Update period totals after item change
CREATE OR REPLACE FUNCTION sync_period_totals()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE payroll_periods
  SET total_gross = (SELECT COALESCE(SUM(gross_total),0) FROM payroll_items WHERE period_id = COALESCE(NEW.period_id, OLD.period_id)),
    total_deductions = (SELECT COALESCE(SUM(total_deductions),0) FROM payroll_items WHERE period_id = COALESCE(NEW.period_id, OLD.period_id)),
    total_net = (SELECT COALESCE(SUM(net_salary),0) FROM payroll_items WHERE period_id = COALESCE(NEW.period_id, OLD.period_id))
  WHERE id = COALESCE(NEW.period_id, OLD.period_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_period_totals_ins ON payroll_items;
DROP TRIGGER IF EXISTS trg_period_totals_upd ON payroll_items;
DROP TRIGGER IF EXISTS trg_period_totals_del ON payroll_items;
CREATE TRIGGER trg_period_totals_ins AFTER INSERT ON payroll_items FOR EACH ROW EXECUTE FUNCTION sync_period_totals();
CREATE TRIGGER trg_period_totals_upd AFTER UPDATE ON payroll_items FOR EACH ROW EXECUTE FUNCTION sync_period_totals();
CREATE TRIGGER trg_period_totals_del AFTER DELETE ON payroll_items FOR EACH ROW EXECUTE FUNCTION sync_period_totals();

-- updated_at
CREATE OR REPLACE FUNCTION update_employee_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_employee_ts ON employees;
CREATE TRIGGER trg_employee_ts BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_employee_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_employees_org      ON employees(org_id, status);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_org ON payroll_periods(org_id, year, month);
CREATE INDEX IF NOT EXISTS idx_payroll_items_period ON payroll_items(period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_emp   ON payroll_items(employee_id, period_id);

-- RLS
ALTER TABLE employees         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_items      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_employees"       ON employees;
DROP POLICY IF EXISTS "org_payroll_periods" ON payroll_periods;
DROP POLICY IF EXISTS "org_payroll_items"   ON payroll_items;

CREATE POLICY "org_employees" ON employees
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_payroll_periods" ON payroll_periods
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_payroll_items" ON payroll_items
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
