-- Dynamic Pricing: time-based, demand-based, and AI-driven pricing rules

CREATE TABLE IF NOT EXISTS dynamic_price_rules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  rule_type       text        NOT NULL CHECK (rule_type IN ('time_of_day','day_of_week','demand','stock_level','competitor','weather','event','ai_optimized')),
  priority        int         NOT NULL DEFAULT 10,
  product_ids     uuid[]      NOT NULL DEFAULT '{}',
  category_ids    uuid[]      NOT NULL DEFAULT '{}',
  condition       jsonb       NOT NULL DEFAULT '{}',  -- {from, to, threshold, operator}
  action          text        NOT NULL CHECK (action IN ('pct_increase','pct_decrease','fixed_amount','fixed_price','match_competitor')),
  action_value    numeric(10,4) NOT NULL DEFAULT 0,
  min_price       numeric(14,2),
  max_price       numeric(14,2),
  applies_to      text        NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all','specific_products','category','segment')),
  schedule_start  timestamptz,
  schedule_end    timestamptz,
  is_active       boolean     NOT NULL DEFAULT true,
  trigger_count   int         NOT NULL DEFAULT 0,
  last_applied    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dynamic_price_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id         uuid        NOT NULL REFERENCES dynamic_price_rules(id) ON DELETE CASCADE,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  event_time      timestamptz NOT NULL DEFAULT now(),
  original_price  numeric(14,2) NOT NULL,
  adjusted_price  numeric(14,2) NOT NULL,
  adjustment_pct  numeric(8,4) GENERATED ALWAYS AS (
    CASE WHEN original_price = 0 THEN 0
    ELSE ROUND((adjusted_price - original_price) / original_price * 100, 4) END
  ) STORED,
  reason          text,
  units_sold      int         NOT NULL DEFAULT 0,
  revenue_impact  numeric(14,2) GENERATED ALWAYS AS (ROUND((adjusted_price - original_price) * units_sold, 2)) STORED
);

CREATE TABLE IF NOT EXISTS demand_signals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  signal_date     date        NOT NULL,
  views_count     int         NOT NULL DEFAULT 0,
  cart_adds       int         NOT NULL DEFAULT 0,
  searches        int         NOT NULL DEFAULT 0,
  orders          int         NOT NULL DEFAULT 0,
  demand_score    numeric(5,2) GENERATED ALWAYS AS (
    ROUND((views_count * 0.1 + cart_adds * 0.5 + searches * 0.2 + orders * 2.0), 2)
  ) STORED,
  elasticity_est  numeric(6,4) NOT NULL DEFAULT -1.5,
  UNIQUE (org_id, product_id, signal_date)
);

-- Suggest optimal price based on demand elasticity
CREATE OR REPLACE FUNCTION suggest_optimal_price(
  p_product_id    uuid,
  p_current_price numeric,
  p_demand_score  numeric,
  p_elasticity    numeric DEFAULT -1.5
) RETURNS TABLE(
  suggested_price numeric,
  expected_revenue_change_pct numeric,
  confidence text
) LANGUAGE sql STABLE AS $$
  SELECT
    CASE
      WHEN p_demand_score > 80 THEN ROUND(p_current_price * 1.10, 2)   -- high demand → increase
      WHEN p_demand_score > 50 THEN ROUND(p_current_price * 1.05, 2)
      WHEN p_demand_score < 20 THEN ROUND(p_current_price * 0.90, 2)   -- low demand → decrease
      ELSE p_current_price
    END AS suggested_price,
    CASE
      WHEN p_demand_score > 80 THEN ROUND((1 + (-1.5 * 0.10 + 0.10)) * 100 - 100, 2)
      WHEN p_demand_score > 50 THEN ROUND((1 + (-1.5 * 0.05 + 0.05)) * 100 - 100, 2)
      WHEN p_demand_score < 20 THEN ROUND((1 + (-1.5 * (-0.10) + (-0.10))) * 100 - 100, 2)
      ELSE 0
    END AS expected_revenue_change_pct,
    CASE
      WHEN p_demand_score > 80 THEN 'high'
      WHEN p_demand_score > 40 THEN 'medium'
      ELSE 'low'
    END AS confidence;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dyn_rules_org      ON dynamic_price_rules(org_id, is_active, priority);
CREATE INDEX IF NOT EXISTS idx_dyn_events_product ON dynamic_price_events(product_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_demand_signals_org ON demand_signals(org_id, product_id, signal_date DESC);

-- RLS
ALTER TABLE dynamic_price_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_price_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_signals        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_dyn_rules"   ON dynamic_price_rules;
DROP POLICY IF EXISTS "org_dyn_events"  ON dynamic_price_events;
DROP POLICY IF EXISTS "org_demand_sig"  ON demand_signals;

CREATE POLICY "org_dyn_rules"   ON dynamic_price_rules  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_dyn_events"  ON dynamic_price_events USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_demand_sig"  ON demand_signals        USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
