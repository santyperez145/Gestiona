-- Financial Scenarios & Planning: P&L builder, break-even, scenario modeling

CREATE TABLE IF NOT EXISTS financial_scenarios (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  scenario_type   text        NOT NULL DEFAULT 'projection' CHECK (scenario_type IN ('projection','budget','actual','variance','what_if')),
  base_period     text        NOT NULL DEFAULT 'monthly',  -- monthly/quarterly/annual
  start_date      date        NOT NULL,
  end_date        date        NOT NULL,
  currency        text        NOT NULL DEFAULT 'ARS',
  is_baseline     boolean     NOT NULL DEFAULT false,
  assumptions     jsonb       NOT NULL DEFAULT '{}',   -- {inflation_rate, growth_rate, etc.}
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS financial_line_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scenario_id     uuid        NOT NULL REFERENCES financial_scenarios(id) ON DELETE CASCADE,
  parent_id       uuid        REFERENCES financial_line_items(id) ON DELETE SET NULL,
  category        text        NOT NULL CHECK (category IN ('revenue','cogs','gross_profit','opex','ebitda','depreciation','ebit','interest','taxes','net_income')),
  name            text        NOT NULL,
  sort_order      int         NOT NULL DEFAULT 0,
  is_subtotal     boolean     NOT NULL DEFAULT false,
  formula         text,       -- simple formula like "revenue - cogs"
  values          jsonb       NOT NULL DEFAULT '{}',   -- {2026-01: 50000, 2026-02: 55000, ...}
  unit            text        NOT NULL DEFAULT 'ARS',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS breakeven_analysis (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scenario_id     uuid        REFERENCES financial_scenarios(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  fixed_costs     numeric(18,2) NOT NULL DEFAULT 0,
  variable_cost_pct numeric(5,2) NOT NULL DEFAULT 40,    -- % of revenue
  avg_price       numeric(14,2) NOT NULL DEFAULT 0,
  avg_unit_cost   numeric(14,2) NOT NULL DEFAULT 0,
  -- Computed
  contribution_margin_pct numeric(5,2) GENERATED ALWAYS AS (
    CASE WHEN avg_price = 0 THEN 0
    ELSE ROUND((1 - variable_cost_pct / 100.0 - avg_unit_cost / NULLIF(avg_price, 0)) * 100, 2) END
  ) STORED,
  breakeven_revenue numeric(18,2) GENERATED ALWAYS AS (
    CASE WHEN variable_cost_pct >= 100 THEN 0
    ELSE ROUND(fixed_costs / (1 - variable_cost_pct / 100.0), 2) END
  ) STORED,
  breakeven_units numeric(14,2) GENERATED ALWAYS AS (
    CASE WHEN avg_price = 0 OR avg_unit_cost >= avg_price THEN 0
    ELSE ROUND(fixed_costs / NULLIF(avg_price - avg_unit_cost, 0), 2) END
  ) STORED,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_projections (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scenario_id     uuid        NOT NULL REFERENCES financial_scenarios(id) ON DELETE CASCADE,
  period_date     date        NOT NULL,
  opening_balance numeric(18,2) NOT NULL DEFAULT 0,
  cash_inflows    jsonb       NOT NULL DEFAULT '{}',   -- {sales, collections, loans, other}
  cash_outflows   jsonb       NOT NULL DEFAULT '{}',   -- {payroll, rent, suppliers, taxes, other}
  total_inflows   numeric(18,2) NOT NULL DEFAULT 0,
  total_outflows  numeric(18,2) NOT NULL DEFAULT 0,
  closing_balance numeric(18,2) GENERATED ALWAYS AS (opening_balance + total_inflows - total_outflows) STORED,
  is_deficit      boolean     GENERATED ALWAYS AS (opening_balance + total_inflows - total_outflows < 0) STORED,
  UNIQUE (scenario_id, period_date)
);

-- Compute variance between two scenarios
CREATE OR REPLACE FUNCTION compute_scenario_variance(
  p_base_id   uuid,
  p_comp_id   uuid,
  p_category  text DEFAULT NULL
) RETURNS TABLE(
  category      text,
  name          text,
  base_total    numeric,
  comp_total    numeric,
  variance_abs  numeric,
  variance_pct  numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    base.category,
    base.name,
    (SELECT SUM(value::numeric) FROM jsonb_each_text(base.values)) AS base_total,
    (SELECT SUM(value::numeric) FROM jsonb_each_text(comp.values)) AS comp_total,
    (SELECT SUM(value::numeric) FROM jsonb_each_text(comp.values)) -
    (SELECT SUM(value::numeric) FROM jsonb_each_text(base.values)) AS variance_abs,
    CASE WHEN (SELECT SUM(value::numeric) FROM jsonb_each_text(base.values)) = 0 THEN 0
    ELSE ROUND(((SELECT SUM(value::numeric) FROM jsonb_each_text(comp.values)) -
                (SELECT SUM(value::numeric) FROM jsonb_each_text(base.values))) /
               ABS((SELECT SUM(value::numeric) FROM jsonb_each_text(base.values))) * 100, 2)
    END AS variance_pct
  FROM financial_line_items base
  JOIN financial_line_items comp
    ON comp.scenario_id = p_comp_id AND comp.name = base.name
  WHERE base.scenario_id = p_base_id
    AND (p_category IS NULL OR base.category = p_category)
  ORDER BY base.sort_order;
$$;

-- Triggers
CREATE OR REPLACE FUNCTION update_scenario_ts() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE OR REPLACE TRIGGER trg_scenario_ts BEFORE UPDATE ON financial_scenarios FOR EACH ROW EXECUTE FUNCTION update_scenario_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scenarios_org     ON financial_scenarios(org_id, scenario_type, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_line_items_scen   ON financial_line_items(scenario_id, category, sort_order);
CREATE INDEX IF NOT EXISTS idx_breakeven_org     ON breakeven_analysis(org_id, scenario_id);
CREATE INDEX IF NOT EXISTS idx_cash_proj_scen    ON cash_projections(scenario_id, period_date);

-- RLS
ALTER TABLE financial_scenarios  ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE breakeven_analysis   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_projections     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_fin_scenarios"   ON financial_scenarios;
DROP POLICY IF EXISTS "org_fin_line_items"  ON financial_line_items;
DROP POLICY IF EXISTS "org_breakeven"       ON breakeven_analysis;
DROP POLICY IF EXISTS "org_cash_proj"       ON cash_projections;

CREATE POLICY "org_fin_scenarios"  ON financial_scenarios  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_fin_line_items" ON financial_line_items USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_breakeven"      ON breakeven_analysis   USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_cash_proj"      ON cash_projections     USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
