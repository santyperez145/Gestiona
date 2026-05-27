-- Smart Inventory: ABC analysis, velocity tracking, demand signals

CREATE TABLE IF NOT EXISTS inventory_abc (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  analysis_date   date        NOT NULL DEFAULT CURRENT_DATE,
  period_days     int         NOT NULL DEFAULT 90,
  total_revenue   numeric(18,2) NOT NULL DEFAULT 0,
  total_units     int         NOT NULL DEFAULT 0,
  total_orders    int         NOT NULL DEFAULT 0,
  revenue_pct     numeric(6,3) NOT NULL DEFAULT 0,   -- share of total revenue
  cumulative_pct  numeric(6,3) NOT NULL DEFAULT 0,
  abc_class       text        NOT NULL DEFAULT 'C' CHECK (abc_class IN ('A','B','C')),
  xyz_class       text        CHECK (xyz_class IN ('X','Y','Z')),   -- demand variability
  velocity        text        NOT NULL DEFAULT 'slow' CHECK (velocity IN ('fast','medium','slow','dead')),
  reorder_point   int         NOT NULL DEFAULT 0,
  safety_stock    int         NOT NULL DEFAULT 0,
  eoq             int         NOT NULL DEFAULT 0,    -- economic order quantity
  days_on_hand    numeric(8,2) NOT NULL DEFAULT 0,
  stockout_risk   text        NOT NULL DEFAULT 'low' CHECK (stockout_risk IN ('critical','high','medium','low')),
  UNIQUE (org_id, product_id, analysis_date)
);

CREATE TABLE IF NOT EXISTS demand_signals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  signal_type     text        NOT NULL CHECK (signal_type IN ('spike','trend_up','trend_down','seasonal','promotion','stockout_risk')),
  detected_at     timestamptz NOT NULL DEFAULT now(),
  value           numeric(14,4),
  description     text,
  confidence      numeric(4,3) NOT NULL DEFAULT 0.8 CHECK (confidence BETWEEN 0 AND 1),
  is_resolved     boolean     NOT NULL DEFAULT false,
  resolved_at     timestamptz
);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_date   date        NOT NULL DEFAULT CURRENT_DATE,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stock_quantity  int         NOT NULL DEFAULT 0,
  stock_value     numeric(18,2) NOT NULL DEFAULT 0,
  avg_daily_sales numeric(10,4) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, product_id, snapshot_date)
);

-- Run ABC analysis: classify products by revenue contribution
CREATE OR REPLACE FUNCTION run_abc_analysis(p_org_id uuid, p_period_days int DEFAULT 90)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_total_revenue numeric;
  v_count         int := 0;
BEGIN
  -- Total revenue in period
  SELECT COALESCE(SUM(total_ars), 0)
  INTO v_total_revenue
  FROM sales
  WHERE org_id = p_org_id
    AND created_at >= now() - (p_period_days || ' days')::interval;

  -- Insert/update ABC data per product
  WITH product_stats AS (
    SELECT
      product_id,
      SUM(total_ars)    AS total_revenue,
      SUM(quantity)     AS total_units,
      COUNT(*)          AS total_orders
    FROM sales
    WHERE org_id = p_org_id
      AND created_at >= now() - (p_period_days || ' days')::interval
      AND product_id IS NOT NULL
    GROUP BY product_id
  ),
  ranked AS (
    SELECT *,
      ROUND((total_revenue / NULLIF(v_total_revenue, 0)) * 100, 3) AS revenue_pct,
      ROUND(SUM(total_revenue / NULLIF(v_total_revenue, 0) * 100)
        OVER (ORDER BY total_revenue DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 3) AS cumulative_pct
    FROM product_stats
  )
  INSERT INTO inventory_abc (
    org_id, product_id, analysis_date, period_days,
    total_revenue, total_units, total_orders,
    revenue_pct, cumulative_pct,
    abc_class,
    velocity
  )
  SELECT
    p_org_id, product_id, CURRENT_DATE, p_period_days,
    total_revenue, total_units, total_orders,
    revenue_pct, cumulative_pct,
    CASE
      WHEN cumulative_pct <= 80 THEN 'A'
      WHEN cumulative_pct <= 95 THEN 'B'
      ELSE 'C'
    END,
    CASE
      WHEN total_units / NULLIF(p_period_days, 0) >= 2   THEN 'fast'
      WHEN total_units / NULLIF(p_period_days, 0) >= 0.3 THEN 'medium'
      WHEN total_units > 0                                THEN 'slow'
      ELSE 'dead'
    END
  FROM ranked
  ON CONFLICT (org_id, product_id, analysis_date)
  DO UPDATE SET
    total_revenue = EXCLUDED.total_revenue,
    total_units   = EXCLUDED.total_units,
    total_orders  = EXCLUDED.total_orders,
    revenue_pct   = EXCLUDED.revenue_pct,
    cumulative_pct = EXCLUDED.cumulative_pct,
    abc_class     = EXCLUDED.abc_class,
    velocity      = EXCLUDED.velocity;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_abc_org_date       ON inventory_abc(org_id, analysis_date DESC, abc_class);
CREATE INDEX IF NOT EXISTS idx_abc_product        ON inventory_abc(product_id, analysis_date DESC);
CREATE INDEX IF NOT EXISTS idx_demand_signals_org ON demand_signals(org_id, is_resolved, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_org_date ON inventory_snapshots(org_id, snapshot_date DESC);

-- RLS
ALTER TABLE inventory_abc      ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_signals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_inventory_abc"       ON inventory_abc;
DROP POLICY IF EXISTS "org_demand_signals"      ON demand_signals;
DROP POLICY IF EXISTS "org_inventory_snapshots" ON inventory_snapshots;

CREATE POLICY "org_inventory_abc"       ON inventory_abc       USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_demand_signals"      ON demand_signals      USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_inventory_snapshots" ON inventory_snapshots USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
