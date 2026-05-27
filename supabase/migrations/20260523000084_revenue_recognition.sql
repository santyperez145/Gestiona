-- Revenue Recognition: ASC 606 / IFRS 15 compliant deferred revenue, POB tracking

CREATE TABLE IF NOT EXISTS revenue_contracts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  contract_number text        NOT NULL,
  title           text        NOT NULL,
  total_value     numeric(18,2) NOT NULL DEFAULT 0,
  currency        text        NOT NULL DEFAULT 'ARS',
  start_date      date        NOT NULL,
  end_date        date,
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','completed','cancelled','modified')),
  recognition_method text     NOT NULL DEFAULT 'over_time' CHECK (recognition_method IN ('point_in_time','over_time','milestone','percentage_completion')),
  is_variable_consideration boolean NOT NULL DEFAULT false,
  constraint_estimate numeric(18,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, contract_number)
);

CREATE TABLE IF NOT EXISTS performance_obligations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     uuid        NOT NULL REFERENCES revenue_contracts(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  standalone_price  numeric(18,2) NOT NULL DEFAULT 0,
  allocated_price   numeric(18,2) NOT NULL DEFAULT 0,
  fulfillment_method text     NOT NULL DEFAULT 'over_time' CHECK (fulfillment_method IN ('point_in_time','over_time')),
  start_date      date,
  end_date        date,
  progress_pct    numeric(5,2) NOT NULL DEFAULT 0,
  is_satisfied    boolean     NOT NULL DEFAULT false,
  satisfied_at    timestamptz,
  sort_order      int         NOT NULL DEFAULT 0,
  recognized_amount numeric(18,2) GENERATED ALWAYS AS (ROUND(allocated_price * progress_pct / 100.0, 2)) STORED,
  deferred_amount   numeric(18,2) GENERATED ALWAYS AS (ROUND(allocated_price * (100 - progress_pct) / 100.0, 2)) STORED
);

CREATE TABLE IF NOT EXISTS revenue_journal_entries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id     uuid        NOT NULL REFERENCES revenue_contracts(id) ON DELETE CASCADE,
  obligation_id   uuid        REFERENCES performance_obligations(id) ON DELETE CASCADE,
  entry_date      date        NOT NULL,
  entry_type      text        NOT NULL CHECK (entry_type IN ('deferred','recognized','adjustment','reversal')),
  debit_account   text        NOT NULL DEFAULT 'Accounts Receivable',
  credit_account  text        NOT NULL DEFAULT 'Deferred Revenue',
  amount          numeric(18,2) NOT NULL DEFAULT 0,
  description     text,
  period_month    text        NOT NULL,  -- YYYY-MM
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Monthly recognized vs deferred revenue waterfall
CREATE OR REPLACE FUNCTION get_revenue_waterfall(p_org_id uuid, p_months int DEFAULT 12)
RETURNS TABLE(
  period_month   text,
  new_contracts  numeric,
  recognized     numeric,
  deferred       numeric,
  cumulative_deferred numeric
) LANGUAGE sql STABLE AS $$
  WITH months AS (
    SELECT to_char(d, 'YYYY-MM') AS period_month
    FROM generate_series(
      date_trunc('month', now()) - ((p_months - 1) || ' months')::interval,
      date_trunc('month', now()),
      '1 month'::interval
    ) d
  )
  SELECT
    m.period_month,
    COALESCE(SUM(rje.amount) FILTER (WHERE rje.entry_type = 'deferred'), 0) AS new_contracts,
    COALESCE(SUM(rje.amount) FILTER (WHERE rje.entry_type = 'recognized'), 0) AS recognized,
    COALESCE(SUM(rje.amount) FILTER (WHERE rje.entry_type = 'deferred') -
             SUM(rje.amount) FILTER (WHERE rje.entry_type = 'recognized'), 0) AS deferred,
    COALESCE(SUM(SUM(rje.amount) FILTER (WHERE rje.entry_type = 'deferred') -
             SUM(rje.amount) FILTER (WHERE rje.entry_type = 'recognized'))
             OVER (ORDER BY m.period_month ROWS UNBOUNDED PRECEDING), 0) AS cumulative_deferred
  FROM months m
  LEFT JOIN revenue_journal_entries rje ON rje.period_month = m.period_month AND rje.org_id = p_org_id
  GROUP BY m.period_month
  ORDER BY m.period_month;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rev_contracts_org   ON revenue_contracts(org_id, status, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_perf_obs_contract   ON performance_obligations(contract_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_rev_journal_period  ON revenue_journal_entries(org_id, period_month, entry_type);

-- RLS
ALTER TABLE revenue_contracts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_obligations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_journal_entries   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_rev_contracts" ON revenue_contracts;
DROP POLICY IF EXISTS "org_perf_obs"      ON performance_obligations;
DROP POLICY IF EXISTS "org_rev_journal"   ON revenue_journal_entries;

CREATE POLICY "org_rev_contracts" ON revenue_contracts       USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_perf_obs"      ON performance_obligations USING (contract_id IN (SELECT id FROM revenue_contracts WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
CREATE POLICY "org_rev_journal"   ON revenue_journal_entries USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
