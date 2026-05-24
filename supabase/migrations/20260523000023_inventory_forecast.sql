-- Advanced Inventory Demand Forecasting

CREATE TABLE IF NOT EXISTS demand_forecasts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  forecast_date   date        NOT NULL,
  horizon_days    int         NOT NULL DEFAULT 30,
  predicted_units numeric(10,2) NOT NULL DEFAULT 0,
  lower_bound     numeric(10,2) NOT NULL DEFAULT 0,  -- 80% CI lower
  upper_bound     numeric(10,2) NOT NULL DEFAULT 0,  -- 80% CI upper
  model_type      text        NOT NULL DEFAULT 'moving_average'
                              CHECK (model_type IN ('moving_average','exponential_smoothing','trend','seasonal')),
  confidence      numeric(5,2) NOT NULL DEFAULT 75,   -- 0-100
  actual_units    numeric(10,2),                       -- filled in after period ends
  mape            numeric(8,4),                        -- mean absolute % error
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, product_id, forecast_date, horizon_days)
);

CREATE TABLE IF NOT EXISTS forecast_configs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        REFERENCES products(id) ON DELETE CASCADE,
  model_type      text        NOT NULL DEFAULT 'exponential_smoothing',
  smoothing_alpha numeric(4,3) NOT NULL DEFAULT 0.3,   -- ETS alpha
  trend_damping   numeric(4,3) NOT NULL DEFAULT 0.95,
  seasonality_period int      NOT NULL DEFAULT 7,      -- days
  reorder_point   int         NOT NULL DEFAULT 0,      -- auto-calc if 0
  safety_stock    int         NOT NULL DEFAULT 0,
  lead_time_days  int         NOT NULL DEFAULT 3,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_forecasts_org     ON demand_forecasts(org_id, product_id, forecast_date DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_configs  ON forecast_configs(org_id, product_id);

-- Compute simple moving average forecast for a product
CREATE OR REPLACE FUNCTION compute_moving_average_forecast(
  p_org_id uuid,
  p_product_id uuid,
  p_window_days int DEFAULT 30,
  p_horizon_days int DEFAULT 30
)
RETURNS TABLE(predicted_units numeric, lower_bound numeric, upper_bound numeric, confidence numeric) LANGUAGE plpgsql STABLE AS $$
DECLARE
  avg_daily  numeric;
  stddev_daily numeric;
  total_units  numeric;
  days_with_sales int;
BEGIN
  SELECT
    COALESCE(SUM(si.quantity), 0),
    COUNT(DISTINCT DATE(s.created_at))
  INTO total_units, days_with_sales
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  WHERE s.org_id = p_org_id
    AND si.product_id = p_product_id
    AND s.created_at >= now() - (p_window_days || ' days')::interval;

  avg_daily := CASE WHEN days_with_sales > 0 THEN total_units / p_window_days ELSE 0 END;

  -- Simplified stddev approximation
  stddev_daily := avg_daily * 0.3; -- 30% coefficient of variation

  RETURN QUERY SELECT
    ROUND(avg_daily * p_horizon_days, 2),
    ROUND(GREATEST(0, (avg_daily - 1.28 * stddev_daily) * p_horizon_days), 2),  -- 80% CI
    ROUND((avg_daily + 1.28 * stddev_daily) * p_horizon_days, 2),
    CASE WHEN days_with_sales >= 7 THEN 80.0 WHEN days_with_sales >= 3 THEN 60.0 ELSE 40.0 END::numeric;
END;
$$;

-- Compute reorder point for a product
CREATE OR REPLACE FUNCTION compute_reorder_point(
  p_org_id uuid,
  p_product_id uuid,
  p_lead_time_days int DEFAULT 3,
  p_safety_stock_days int DEFAULT 7
)
RETURNS int LANGUAGE plpgsql STABLE AS $$
DECLARE
  avg_daily numeric;
BEGIN
  SELECT COALESCE(SUM(si.quantity), 0) / 30.0
  INTO avg_daily
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  WHERE s.org_id = p_org_id
    AND si.product_id = p_product_id
    AND s.created_at >= now() - INTERVAL '30 days';

  RETURN CEIL(avg_daily * (p_lead_time_days + p_safety_stock_days));
END;
$$;

-- updated_at for config
CREATE OR REPLACE FUNCTION update_fc_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_fc_updated ON forecast_configs;
CREATE TRIGGER trg_fc_updated BEFORE UPDATE ON forecast_configs FOR EACH ROW EXECUTE FUNCTION update_fc_timestamp();

-- RLS
ALTER TABLE demand_forecasts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_configs  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_forecasts"        ON demand_forecasts;
DROP POLICY IF EXISTS "org_forecast_configs" ON forecast_configs;

CREATE POLICY "org_forecasts"        ON demand_forecasts  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_forecast_configs" ON forecast_configs  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
