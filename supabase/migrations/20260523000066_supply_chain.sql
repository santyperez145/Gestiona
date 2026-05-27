-- Supply Chain Intelligence: supplier scorecards, lead times, procurement analytics

CREATE TABLE IF NOT EXISTS supplier_scorecards (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id       uuid        NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  period_start      date        NOT NULL,
  period_end        date        NOT NULL,
  on_time_delivery  numeric(5,2) NOT NULL DEFAULT 0,  -- % 0-100
  quality_rate      numeric(5,2) NOT NULL DEFAULT 0,  -- % items accepted
  fill_rate         numeric(5,2) NOT NULL DEFAULT 0,  -- % of ordered qty received
  price_variance    numeric(8,4) NOT NULL DEFAULT 0,  -- actual vs quoted %
  response_time_hrs numeric(8,2) NOT NULL DEFAULT 0,  -- avg hours to respond
  return_rate       numeric(5,2) NOT NULL DEFAULT 0,
  overall_score     numeric(5,2) GENERATED ALWAYS AS (
    ROUND((on_time_delivery * 0.35 + quality_rate * 0.30 + fill_rate * 0.20 + (100 - LEAST(return_rate * 5, 100)) * 0.15), 2)
  ) STORED,
  grade             text        NOT NULL DEFAULT 'C' CHECK (grade IN ('A+','A','B','C','D','F')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, supplier_id, period_start)
);

CREATE TABLE IF NOT EXISTS supplier_lead_times (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id       uuid        NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  product_id        uuid        REFERENCES products(id) ON DELETE CASCADE,
  ordered_at        timestamptz NOT NULL,
  received_at       timestamptz,
  promised_days     int,
  actual_days       int GENERATED ALWAYS AS (
    CASE WHEN received_at IS NOT NULL
    THEN EXTRACT(DAY FROM received_at - ordered_at)::int
    ELSE NULL END
  ) STORED,
  qty_ordered       int         NOT NULL DEFAULT 0,
  qty_received      int         NOT NULL DEFAULT 0,
  unit_cost         numeric(14,2) NOT NULL DEFAULT 0,
  status            text        NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','complete','cancelled')),
  purchase_order_id uuid,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procurement_budgets (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  year              int         NOT NULL,
  month             int         NOT NULL CHECK (month BETWEEN 1 AND 12),
  category          text        NOT NULL DEFAULT 'general',
  budgeted_amount   numeric(18,2) NOT NULL DEFAULT 0,
  actual_amount     numeric(18,2) NOT NULL DEFAULT 0,
  variance          numeric(18,2) GENERATED ALWAYS AS (actual_amount - budgeted_amount) STORED,
  variance_pct      numeric(8,4) GENERATED ALWAYS AS (
    CASE WHEN budgeted_amount = 0 THEN 0
    ELSE ROUND(((actual_amount - budgeted_amount) / budgeted_amount) * 100, 4) END
  ) STORED,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, year, month, category)
);

CREATE TABLE IF NOT EXISTS supplier_contracts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id       uuid        NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  contract_number   text        NOT NULL,
  title             text        NOT NULL,
  start_date        date        NOT NULL,
  end_date          date,
  payment_terms     int         NOT NULL DEFAULT 30,  -- days net
  discount_pct      numeric(5,2) NOT NULL DEFAULT 0,
  min_order_amount  numeric(14,2) NOT NULL DEFAULT 0,
  currency          text        NOT NULL DEFAULT 'ARS',
  auto_renew        boolean     NOT NULL DEFAULT false,
  status            text        NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','expired','terminated')),
  document_url      text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Supplier performance view
CREATE OR REPLACE VIEW supplier_performance AS
SELECT
  ss.org_id,
  ss.supplier_id,
  ss.period_start,
  ss.period_end,
  ss.on_time_delivery,
  ss.quality_rate,
  ss.fill_rate,
  ss.overall_score,
  ss.grade,
  p.nombre AS supplier_name,
  COUNT(lt.id) AS total_orders,
  AVG(lt.actual_days) AS avg_lead_days,
  SUM(lt.qty_received * lt.unit_cost) AS total_spend
FROM supplier_scorecards ss
LEFT JOIN proveedores p ON p.id = ss.supplier_id
LEFT JOIN supplier_lead_times lt
  ON lt.supplier_id = ss.supplier_id
  AND lt.org_id = ss.org_id
  AND lt.ordered_at::date BETWEEN ss.period_start AND ss.period_end
GROUP BY ss.org_id, ss.supplier_id, ss.period_start, ss.period_end,
         ss.on_time_delivery, ss.quality_rate, ss.fill_rate,
         ss.overall_score, ss.grade, p.nombre;

-- Update scorecard grade based on overall_score
CREATE OR REPLACE FUNCTION update_supplier_grade()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.grade := CASE
    WHEN NEW.overall_score >= 95 THEN 'A+'
    WHEN NEW.overall_score >= 85 THEN 'A'
    WHEN NEW.overall_score >= 70 THEN 'B'
    WHEN NEW.overall_score >= 55 THEN 'C'
    WHEN NEW.overall_score >= 40 THEN 'D'
    ELSE 'F'
  END;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_supplier_grade
BEFORE INSERT OR UPDATE ON supplier_scorecards
FOR EACH ROW EXECUTE FUNCTION update_supplier_grade();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scorecards_org       ON supplier_scorecards(org_id, supplier_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_lead_times_org       ON supplier_lead_times(org_id, supplier_id, ordered_at DESC);
CREATE INDEX IF NOT EXISTS idx_proc_budgets_org     ON procurement_budgets(org_id, year DESC, month DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_contracts   ON supplier_contracts(org_id, supplier_id, status);

-- RLS
ALTER TABLE supplier_scorecards  ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_lead_times  ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_budgets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_contracts   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_supplier_scorecards" ON supplier_scorecards;
DROP POLICY IF EXISTS "org_supplier_lead_times" ON supplier_lead_times;
DROP POLICY IF EXISTS "org_proc_budgets"        ON procurement_budgets;
DROP POLICY IF EXISTS "org_supplier_contracts"  ON supplier_contracts;

CREATE POLICY "org_supplier_scorecards" ON supplier_scorecards USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_supplier_lead_times" ON supplier_lead_times USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_proc_budgets"        ON procurement_budgets USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_supplier_contracts"  ON supplier_contracts  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
