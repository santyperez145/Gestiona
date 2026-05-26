-- Cash Flow Projections

CREATE TABLE IF NOT EXISTS cashflow_entries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_type      text        NOT NULL CHECK (entry_type IN ('inflow','outflow')),
  category        text        NOT NULL DEFAULT 'other'
                              CHECK (category IN (
                                'sales','collections','loans','investments','other_in',
                                'purchases','payroll','rent','taxes','utilities','loan_payment','dividends','other_out'
                              )),
  description     text        NOT NULL,
  amount          numeric(14,2) NOT NULL DEFAULT 0,
  date            date        NOT NULL DEFAULT CURRENT_DATE,
  is_recurring    boolean     NOT NULL DEFAULT false,
  recurrence_type text        CHECK (recurrence_type IN ('daily','weekly','biweekly','monthly','quarterly','annual')),
  recurrence_end  date,
  is_projected    boolean     NOT NULL DEFAULT false,   -- false = actual, true = projection
  reference_type  text,       -- 'sale', 'expense', 'invoice'
  reference_id    uuid,
  bank_account    text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Rolling 12-month projection view
CREATE OR REPLACE FUNCTION get_cashflow_summary(p_org_id uuid, p_from date, p_to date)
RETURNS TABLE(
  flow_date   date,
  inflow      numeric,
  outflow     numeric,
  net         numeric,
  running_total numeric
) LANGUAGE sql STABLE AS $$
  WITH daily AS (
    SELECT
      date AS flow_date,
      SUM(CASE WHEN entry_type = 'inflow'  THEN amount ELSE 0 END) AS inflow,
      SUM(CASE WHEN entry_type = 'outflow' THEN amount ELSE 0 END) AS outflow
    FROM cashflow_entries
    WHERE org_id = p_org_id AND date BETWEEN p_from AND p_to
    GROUP BY date
    ORDER BY date
  )
  SELECT
    flow_date,
    inflow,
    outflow,
    inflow - outflow AS net,
    SUM(inflow - outflow) OVER (ORDER BY flow_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
  FROM daily;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cashflow_org     ON cashflow_entries(org_id, date DESC, entry_type);
CREATE INDEX IF NOT EXISTS idx_cashflow_cat     ON cashflow_entries(org_id, category, date DESC);

-- RLS
ALTER TABLE cashflow_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_cashflow" ON cashflow_entries;

CREATE POLICY "org_cashflow" ON cashflow_entries
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
