-- Advanced Pricing Engine: rule-based dynamic pricing, margin control, A/B testing

CREATE TABLE IF NOT EXISTS pricing_rules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  rule_type       text        NOT NULL CHECK (rule_type IN (
    'margin_floor','cost_plus','competitor_based','time_based',
    'volume_tier','customer_tier','bundle_discount','clearance','dynamic'
  )),
  priority        int         NOT NULL DEFAULT 100,  -- lower = higher priority
  conditions      jsonb       NOT NULL DEFAULT '{}',  -- {product_ids, category_ids, customer_segments, min_qty, etc.}
  action          jsonb       NOT NULL DEFAULT '{}',  -- {type: 'pct_markup'|'fixed_price'|'pct_discount', value, min_price, max_price}
  schedule        jsonb,                              -- {start, end, days_of_week, hours}
  applies_to      text        NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all','products','categories','customers')),
  is_active       boolean     NOT NULL DEFAULT true,
  is_exclusive    boolean     NOT NULL DEFAULT false, -- if true, no other rules apply when this matches
  run_count       int         NOT NULL DEFAULT 0,
  last_applied_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pricing_experiments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  hypothesis      text,
  control_price   numeric(14,2) NOT NULL,
  variant_price   numeric(14,2) NOT NULL,
  traffic_split   int         NOT NULL DEFAULT 50 CHECK (traffic_split BETWEEN 1 AND 99),
  start_date      date        NOT NULL DEFAULT CURRENT_DATE,
  end_date        date,
  status          text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','completed')),
  -- Results
  control_conversions  int   NOT NULL DEFAULT 0,
  variant_conversions  int   NOT NULL DEFAULT 0,
  control_revenue      numeric(14,2) NOT NULL DEFAULT 0,
  variant_revenue      numeric(14,2) NOT NULL DEFAULT 0,
  control_impressions  int   NOT NULL DEFAULT 0,
  variant_impressions  int   NOT NULL DEFAULT 0,
  winner              text   CHECK (winner IN ('control','variant','inconclusive')),
  confidence_pct      numeric(5,2),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS margin_targets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL DEFAULT 'General',
  applies_to      text        NOT NULL DEFAULT 'all',
  entity_id       uuid,       -- product_id or category_id
  min_margin_pct  numeric(5,2) NOT NULL DEFAULT 20,
  target_margin_pct numeric(5,2) NOT NULL DEFAULT 40,
  alert_threshold  numeric(5,2) NOT NULL DEFAULT 15,  -- alert if margin drops below this
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (org_id, applies_to, entity_id)
);

CREATE TABLE IF NOT EXISTS price_history (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  old_price       numeric(14,2) NOT NULL,
  new_price       numeric(14,2) NOT NULL,
  change_pct      numeric(8,4) GENERATED ALWAYS AS (
    CASE WHEN old_price = 0 THEN 0
    ELSE ROUND(((new_price - old_price) / old_price) * 100, 4) END
  ) STORED,
  change_reason   text,
  rule_id         uuid        REFERENCES pricing_rules(id) ON DELETE SET NULL,
  changed_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at      timestamptz NOT NULL DEFAULT now()
);

-- Apply pricing rules to a product and return computed price
CREATE OR REPLACE FUNCTION apply_pricing_rules(
  p_org_id      uuid,
  p_product_id  uuid,
  p_cost_price  numeric,
  p_base_price  numeric,
  p_quantity    int DEFAULT 1,
  p_customer_segment text DEFAULT 'general'
) RETURNS TABLE(
  computed_price  numeric,
  applied_rule_id uuid,
  applied_rule    text,
  margin_pct      numeric
) LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_price     numeric := p_base_price;
  v_rule      pricing_rules%ROWTYPE;
  v_rule_id   uuid;
  v_rule_name text;
BEGIN
  FOR v_rule IN
    SELECT * FROM pricing_rules
    WHERE org_id = p_org_id
      AND is_active = true
      AND (
        applies_to = 'all'
        OR (applies_to = 'products' AND (conditions->>'product_ids')::jsonb @> to_jsonb(p_product_id::text))
      )
    ORDER BY priority ASC
    LIMIT 5
  LOOP
    -- Apply rule action
    CASE (v_rule.action->>'type')
      WHEN 'pct_markup' THEN
        v_price := p_cost_price * (1 + (v_rule.action->>'value')::numeric / 100);
      WHEN 'pct_discount' THEN
        v_price := p_base_price * (1 - (v_rule.action->>'value')::numeric / 100);
      WHEN 'fixed_price' THEN
        v_price := (v_rule.action->>'value')::numeric;
      WHEN 'cost_plus' THEN
        v_price := p_cost_price + (v_rule.action->>'value')::numeric;
      ELSE
        v_price := p_base_price;
    END CASE;

    -- Enforce min/max price guards
    IF v_rule.action->>'min_price' IS NOT NULL THEN
      v_price := GREATEST(v_price, (v_rule.action->>'min_price')::numeric);
    END IF;
    IF v_rule.action->>'max_price' IS NOT NULL THEN
      v_price := LEAST(v_price, (v_rule.action->>'max_price')::numeric);
    END IF;

    v_rule_id   := v_rule.id;
    v_rule_name := v_rule.name;

    IF v_rule.is_exclusive THEN EXIT; END IF;
  END LOOP;

  RETURN QUERY SELECT
    ROUND(v_price, 2),
    v_rule_id,
    v_rule_name,
    CASE WHEN v_price = 0 THEN 0
    ELSE ROUND(((v_price - p_cost_price) / v_price) * 100, 2) END;
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pricing_rules_org     ON pricing_rules(org_id, is_active, priority);
CREATE INDEX IF NOT EXISTS idx_experiments_org       ON pricing_experiments(org_id, product_id, status);
CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(org_id, product_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_margin_targets_org    ON margin_targets(org_id, applies_to);

-- RLS
ALTER TABLE pricing_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE margin_targets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_pricing_rules"    ON pricing_rules;
DROP POLICY IF EXISTS "org_experiments"      ON pricing_experiments;
DROP POLICY IF EXISTS "org_margin_targets"   ON margin_targets;
DROP POLICY IF EXISTS "org_price_history"    ON price_history;

CREATE POLICY "org_pricing_rules"   ON pricing_rules       USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_experiments"     ON pricing_experiments USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_margin_targets"  ON margin_targets      USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_price_history"   ON price_history       USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
