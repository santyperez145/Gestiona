-- Predictive Analytics & ML: forecasts, anomaly detection, AI recommendations

CREATE TABLE IF NOT EXISTS sales_forecasts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  forecast_date   date        NOT NULL,
  product_id      uuid        REFERENCES products(id) ON DELETE CASCADE,  -- NULL = org-level forecast
  model           text        NOT NULL DEFAULT 'moving_avg' CHECK (model IN ('moving_avg','exp_smoothing','arima','prophet','ml_ensemble')),
  horizon_days    int         NOT NULL DEFAULT 30,
  predicted_units numeric(14,4) NOT NULL DEFAULT 0,
  predicted_revenue numeric(18,2) NOT NULL DEFAULT 0,
  confidence_lo   numeric(14,4) NOT NULL DEFAULT 0,
  confidence_hi   numeric(14,4) NOT NULL DEFAULT 0,
  confidence_pct  int         NOT NULL DEFAULT 80,  -- 80% confidence interval
  mape            numeric(8,4),                      -- Mean Absolute Percentage Error
  rmse            numeric(14,4),
  seasonality_factor numeric(6,4) NOT NULL DEFAULT 1,
  trend_direction text        CHECK (trend_direction IN ('up','flat','down')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, forecast_date, product_id, model)
);

CREATE TABLE IF NOT EXISTS anomaly_detections (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  anomaly_type    text        NOT NULL CHECK (anomaly_type IN (
    'revenue_spike','revenue_drop','inventory_spike','inventory_drop',
    'expense_outlier','margin_erosion','churn_spike','conversion_drop',
    'cost_increase','supplier_delay'
  )),
  severity        text        NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical','high','medium','low')),
  entity_type     text        NOT NULL DEFAULT 'org' CHECK (entity_type IN ('org','product','supplier','customer','category')),
  entity_id       uuid,
  metric_name     text        NOT NULL,
  expected_value  numeric(18,4) NOT NULL,
  actual_value    numeric(18,4) NOT NULL,
  deviation_pct   numeric(8,4) NOT NULL,
  z_score         numeric(8,4),
  description     text        NOT NULL,
  suggested_action text,
  is_acknowledged boolean     NOT NULL DEFAULT false,
  acknowledged_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  false_positive  boolean     NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS ai_recommendations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rec_type        text        NOT NULL CHECK (rec_type IN (
    'restock','price_adjustment','bundle_opportunity','cross_sell','discontinue',
    'supplier_switch','marketing_spend','customer_winback','cost_reduction','expansion'
  )),
  title           text        NOT NULL,
  description     text        NOT NULL,
  impact_estimate numeric(18,2) NOT NULL DEFAULT 0,   -- estimated $ impact
  effort          text        NOT NULL DEFAULT 'medium' CHECK (effort IN ('low','medium','high')),
  confidence      numeric(4,3) NOT NULL DEFAULT 0.8,
  entity_type     text,
  entity_id       uuid,
  data_points     jsonb       NOT NULL DEFAULT '[]',  -- evidence data points
  action_url      text,       -- deep link to relevant page
  expires_at      timestamptz,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','snoozed','done')),
  user_feedback   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forecast_accuracy (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  forecast_id     uuid        NOT NULL REFERENCES sales_forecasts(id) ON DELETE CASCADE,
  actual_units    numeric(14,4) NOT NULL DEFAULT 0,
  actual_revenue  numeric(18,2) NOT NULL DEFAULT 0,
  accuracy_pct    numeric(6,2) GENERATED ALWAYS AS (
    CASE WHEN predicted_units_snap = 0 THEN 0
    ELSE ROUND((1 - ABS(actual_units - predicted_units_snap) / predicted_units_snap) * 100, 2) END
  ) STORED,
  predicted_units_snap numeric(14,4) NOT NULL DEFAULT 0,
  measured_at     timestamptz NOT NULL DEFAULT now()
);

-- Simple moving average forecast
CREATE OR REPLACE FUNCTION compute_moving_avg_forecast(
  p_org_id      uuid,
  p_product_id  uuid DEFAULT NULL,
  p_horizon     int DEFAULT 30,
  p_window      int DEFAULT 14   -- days of history for moving average
) RETURNS TABLE(
  day             date,
  predicted_units numeric,
  confidence_lo   numeric,
  confidence_hi   numeric
) LANGUAGE plpgsql AS $$
DECLARE
  v_avg_daily numeric;
  v_stddev    numeric;
BEGIN
  -- Compute average and stddev of daily sales
  SELECT
    COALESCE(AVG(daily_units), 0),
    COALESCE(STDDEV(daily_units), 0)
  INTO v_avg_daily, v_stddev
  FROM (
    SELECT DATE(created_at) AS day, SUM(quantity) AS daily_units
    FROM sales
    WHERE org_id = p_org_id
      AND (p_product_id IS NULL OR product_id = p_product_id)
      AND created_at >= now() - (p_window || ' days')::interval
    GROUP BY DATE(created_at)
  ) sub;

  RETURN QUERY
  SELECT
    (CURRENT_DATE + s.n)::date AS day,
    ROUND(v_avg_daily, 2) AS predicted_units,
    ROUND(GREATEST(0, v_avg_daily - 1.64 * v_stddev), 2) AS confidence_lo,
    ROUND(v_avg_daily + 1.64 * v_stddev, 2) AS confidence_hi
  FROM generate_series(1, p_horizon) AS s(n);
END;
$$;

-- Get top AI recommendations sorted by impact
CREATE OR REPLACE FUNCTION get_top_recommendations(p_org_id uuid, p_limit int DEFAULT 10)
RETURNS SETOF ai_recommendations LANGUAGE sql STABLE AS $$
  SELECT * FROM ai_recommendations
  WHERE org_id = p_org_id
    AND status = 'pending'
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY confidence * impact_estimate DESC
  LIMIT p_limit;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_forecasts_org         ON sales_forecasts(org_id, forecast_date DESC, product_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_org         ON anomaly_detections(org_id, is_acknowledged, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_recommendations_org   ON ai_recommendations(org_id, status, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_accuracy_org ON forecast_accuracy(org_id, measured_at DESC);

-- RLS
ALTER TABLE sales_forecasts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomaly_detections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_recommendations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_accuracy   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_forecasts"         ON sales_forecasts;
DROP POLICY IF EXISTS "org_anomalies"         ON anomaly_detections;
DROP POLICY IF EXISTS "org_ai_recommendations" ON ai_recommendations;
DROP POLICY IF EXISTS "org_forecast_accuracy" ON forecast_accuracy;

CREATE POLICY "org_forecasts"          ON sales_forecasts     USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_anomalies"          ON anomaly_detections  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ai_recommendations" ON ai_recommendations  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_forecast_accuracy"  ON forecast_accuracy   USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
