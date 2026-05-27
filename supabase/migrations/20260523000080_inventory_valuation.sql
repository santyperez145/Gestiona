-- Inventory Valuation: FIFO, LIFO, Average Cost, stock layers

CREATE TABLE IF NOT EXISTS inventory_valuation_config (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  method          text        NOT NULL DEFAULT 'average' CHECK (method IN ('fifo','lifo','average','specific')),
  base_currency   text        NOT NULL DEFAULT 'ARS',
  revalue_on_inflation boolean NOT NULL DEFAULT false,
  last_revaluation date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

CREATE TABLE IF NOT EXISTS inventory_layers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  layer_date      date        NOT NULL,
  layer_type      text        NOT NULL CHECK (layer_type IN ('purchase','adjustment','production','return')),
  quantity_in     numeric(14,4) NOT NULL DEFAULT 0,
  quantity_out    numeric(14,4) NOT NULL DEFAULT 0,
  quantity_remaining numeric(14,4) GENERATED ALWAYS AS (quantity_in - quantity_out) STORED,
  unit_cost       numeric(14,4) NOT NULL DEFAULT 0,
  total_cost      numeric(18,4) GENERATED ALWAYS AS (ROUND((quantity_in - quantity_out) * unit_cost, 4)) STORED,
  reference_id    uuid,        -- purchase_id or sale_id
  reference_type  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_valuation_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_date   date        NOT NULL,
  method          text        NOT NULL,
  total_units     numeric(14,4) NOT NULL DEFAULT 0,
  total_cost_avg  numeric(18,4) NOT NULL DEFAULT 0,
  total_cost_fifo numeric(18,4) NOT NULL DEFAULT 0,
  total_cost_lifo numeric(18,4) NOT NULL DEFAULT 0,
  total_market_value numeric(18,4) NOT NULL DEFAULT 0,
  unrealized_gain_loss numeric(18,4) GENERATED ALWAYS AS (total_market_value - total_cost_avg) STORED,
  details         jsonb       NOT NULL DEFAULT '{}',  -- per-product breakdown
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, snapshot_date)
);

-- Compute weighted average cost for a product
CREATE OR REPLACE FUNCTION get_average_cost(p_org_id uuid, p_product_id uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN SUM(quantity_remaining) = 0 THEN 0
    ELSE ROUND(SUM(total_cost) / NULLIF(SUM(quantity_remaining), 0), 4)
  END
  FROM inventory_layers
  WHERE org_id = p_org_id AND product_id = p_product_id AND quantity_remaining > 0;
$$;

-- FIFO valuation: oldest layers consumed first
CREATE OR REPLACE FUNCTION get_fifo_value(p_org_id uuid, p_product_id uuid)
RETURNS TABLE(layer_date date, quantity numeric, unit_cost numeric, layer_total numeric) LANGUAGE sql STABLE AS $$
  SELECT layer_date, quantity_remaining, unit_cost, total_cost
  FROM inventory_layers
  WHERE org_id = p_org_id AND product_id = p_product_id AND quantity_remaining > 0
  ORDER BY layer_date ASC, created_at ASC;
$$;

-- LIFO valuation: newest layers consumed first
CREATE OR REPLACE FUNCTION get_lifo_value(p_org_id uuid, p_product_id uuid)
RETURNS TABLE(layer_date date, quantity numeric, unit_cost numeric, layer_total numeric) LANGUAGE sql STABLE AS $$
  SELECT layer_date, quantity_remaining, unit_cost, total_cost
  FROM inventory_layers
  WHERE org_id = p_org_id AND product_id = p_product_id AND quantity_remaining > 0
  ORDER BY layer_date DESC, created_at DESC;
$$;

-- Full valuation report
CREATE OR REPLACE FUNCTION compute_inventory_valuation(p_org_id uuid)
RETURNS TABLE(
  product_id    uuid,
  product_name  text,
  total_units   numeric,
  avg_cost      numeric,
  fifo_value    numeric,
  market_value  numeric,
  gain_loss     numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    p.id,
    p.name,
    COALESCE(SUM(il.quantity_remaining), 0) AS total_units,
    get_average_cost(p_org_id, p.id) AS avg_cost,
    COALESCE((
      SELECT SUM(total_cost) FROM inventory_layers
      WHERE org_id = p_org_id AND product_id = p.id AND quantity_remaining > 0
    ), 0) AS fifo_value,
    p.price_ars * COALESCE(SUM(il.quantity_remaining), 0) AS market_value,
    (p.price_ars - get_average_cost(p_org_id, p.id)) * COALESCE(SUM(il.quantity_remaining), 0) AS gain_loss
  FROM products p
  LEFT JOIN inventory_layers il ON il.product_id = p.id AND il.org_id = p_org_id
  WHERE p.org_id = p_org_id AND p.is_active = true
  GROUP BY p.id, p.name, p.price_ars
  HAVING COALESCE(SUM(il.quantity_remaining), 0) > 0;
$$;

-- Updated_at trigger
CREATE OR REPLACE TRIGGER trg_inv_val_config_ts BEFORE UPDATE ON inventory_valuation_config FOR EACH ROW EXECUTE FUNCTION update_scenario_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inv_layers_product  ON inventory_layers(org_id, product_id, layer_date);
CREATE INDEX IF NOT EXISTS idx_inv_snapshots_org   ON inventory_valuation_snapshots(org_id, snapshot_date DESC);

-- RLS
ALTER TABLE inventory_valuation_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_layers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_valuation_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_inv_val_config"     ON inventory_valuation_config;
DROP POLICY IF EXISTS "org_inv_layers"         ON inventory_layers;
DROP POLICY IF EXISTS "org_inv_val_snapshots"  ON inventory_valuation_snapshots;

CREATE POLICY "org_inv_val_config"    ON inventory_valuation_config    USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_inv_layers"        ON inventory_layers              USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_inv_val_snapshots" ON inventory_valuation_snapshots USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
