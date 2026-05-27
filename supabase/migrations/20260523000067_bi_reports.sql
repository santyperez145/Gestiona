-- Business Intelligence & Advanced Reports

CREATE TABLE IF NOT EXISTS bi_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_date   date        NOT NULL DEFAULT CURRENT_DATE,
  -- Revenue
  revenue_day     numeric(18,2) NOT NULL DEFAULT 0,
  revenue_week    numeric(18,2) NOT NULL DEFAULT 0,
  revenue_month   numeric(18,2) NOT NULL DEFAULT 0,
  revenue_ytd     numeric(18,2) NOT NULL DEFAULT 0,
  -- Transactions
  orders_day      int         NOT NULL DEFAULT 0,
  orders_week     int         NOT NULL DEFAULT 0,
  orders_month    int         NOT NULL DEFAULT 0,
  avg_order_value numeric(14,2) NOT NULL DEFAULT 0,
  -- Products
  unique_products_sold int    NOT NULL DEFAULT 0,
  top_product_id  uuid        REFERENCES products(id) ON DELETE SET NULL,
  top_product_rev numeric(14,2) NOT NULL DEFAULT 0,
  -- Customers
  new_customers   int         NOT NULL DEFAULT 0,
  returning_customers int     NOT NULL DEFAULT 0,
  churn_risk_count int        NOT NULL DEFAULT 0,
  -- Inventory
  total_stock_value numeric(18,2) NOT NULL DEFAULT 0,
  low_stock_count int         NOT NULL DEFAULT 0,
  dead_stock_count int        NOT NULL DEFAULT 0,
  -- Expenses
  expenses_day    numeric(18,2) NOT NULL DEFAULT 0,
  expenses_month  numeric(18,2) NOT NULL DEFAULT 0,
  gross_margin_pct numeric(6,3) NOT NULL DEFAULT 0,
  -- AR/AP
  receivables     numeric(18,2) NOT NULL DEFAULT 0,
  payables        numeric(18,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS saved_reports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  name            text        NOT NULL,
  description     text,
  report_type     text        NOT NULL CHECK (report_type IN ('sales','inventory','finance','customers','marketing','custom')),
  filters         jsonb       NOT NULL DEFAULT '{}',
  columns         text[]      NOT NULL DEFAULT '{}',
  grouping        text,       -- field to group by
  sort_field      text,
  sort_dir        text        NOT NULL DEFAULT 'desc' CHECK (sort_dir IN ('asc','desc')),
  chart_type      text        CHECK (chart_type IN ('line','bar','area','pie','scatter','table','heatmap')),
  is_shared       boolean     NOT NULL DEFAULT false,
  is_pinned       boolean     NOT NULL DEFAULT false,
  run_count       int         NOT NULL DEFAULT 0,
  last_run_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_schedules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_id       uuid        NOT NULL REFERENCES saved_reports(id) ON DELETE CASCADE,
  cron_expr       text        NOT NULL DEFAULT '0 8 * * 1',  -- Monday 8am
  format          text        NOT NULL DEFAULT 'pdf' CHECK (format IN ('pdf','csv','xlsx','json')),
  recipients      text[]      NOT NULL DEFAULT '{}',
  subject         text        NOT NULL DEFAULT 'Reporte periódico',
  is_active       boolean     NOT NULL DEFAULT true,
  last_sent_at    timestamptz,
  next_run_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bi_drilldowns (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_id       uuid        REFERENCES saved_reports(id) ON DELETE SET NULL,
  dimension       text        NOT NULL,   -- product, customer, region, seller
  dimension_value text        NOT NULL,
  metrics         jsonb       NOT NULL DEFAULT '{}',
  period_start    date,
  period_end      date,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Generate daily BI snapshot from live data
CREATE OR REPLACE FUNCTION generate_bi_snapshot(p_org_id uuid, p_date date DEFAULT CURRENT_DATE)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_rev_day       numeric;
  v_rev_week      numeric;
  v_rev_month     numeric;
  v_rev_ytd       numeric;
  v_orders_day    int;
  v_orders_week   int;
  v_orders_month  int;
  v_aov           numeric;
  v_exp_month     numeric;
  v_stock_value   numeric;
BEGIN
  -- Revenue rollups
  SELECT COALESCE(SUM(total_ars),0) INTO v_rev_day   FROM sales WHERE org_id=p_org_id AND DATE(created_at)=p_date;
  SELECT COALESCE(SUM(total_ars),0) INTO v_rev_week  FROM sales WHERE org_id=p_org_id AND created_at >= date_trunc('week', p_date::timestamptz);
  SELECT COALESCE(SUM(total_ars),0) INTO v_rev_month FROM sales WHERE org_id=p_org_id AND created_at >= date_trunc('month', p_date::timestamptz);
  SELECT COALESCE(SUM(total_ars),0) INTO v_rev_ytd   FROM sales WHERE org_id=p_org_id AND created_at >= date_trunc('year', p_date::timestamptz);

  -- Order counts
  SELECT COUNT(*) INTO v_orders_day   FROM sales WHERE org_id=p_org_id AND DATE(created_at)=p_date;
  SELECT COUNT(*) INTO v_orders_week  FROM sales WHERE org_id=p_org_id AND created_at >= date_trunc('week', p_date::timestamptz);
  SELECT COUNT(*) INTO v_orders_month FROM sales WHERE org_id=p_org_id AND created_at >= date_trunc('month', p_date::timestamptz);
  v_aov := CASE WHEN v_orders_month = 0 THEN 0 ELSE ROUND(v_rev_month / v_orders_month, 2) END;

  -- Expenses month
  SELECT COALESCE(SUM(amount),0) INTO v_exp_month FROM expenses WHERE org_id=p_org_id AND created_at >= date_trunc('month', p_date::timestamptz);

  -- Stock value
  SELECT COALESCE(SUM(stock * cost_price),0) INTO v_stock_value FROM products WHERE org_id=p_org_id;

  INSERT INTO bi_snapshots (
    org_id, snapshot_date,
    revenue_day, revenue_week, revenue_month, revenue_ytd,
    orders_day, orders_week, orders_month, avg_order_value,
    expenses_month, total_stock_value,
    gross_margin_pct
  )
  VALUES (
    p_org_id, p_date,
    v_rev_day, v_rev_week, v_rev_month, v_rev_ytd,
    v_orders_day, v_orders_week, v_orders_month, v_aov,
    v_exp_month, v_stock_value,
    CASE WHEN v_rev_month = 0 THEN 0
         ELSE ROUND(((v_rev_month - v_exp_month) / v_rev_month) * 100, 3) END
  )
  ON CONFLICT (org_id, snapshot_date) DO UPDATE SET
    revenue_day       = EXCLUDED.revenue_day,
    revenue_week      = EXCLUDED.revenue_week,
    revenue_month     = EXCLUDED.revenue_month,
    revenue_ytd       = EXCLUDED.revenue_ytd,
    orders_day        = EXCLUDED.orders_day,
    orders_week       = EXCLUDED.orders_week,
    orders_month      = EXCLUDED.orders_month,
    avg_order_value   = EXCLUDED.avg_order_value,
    expenses_month    = EXCLUDED.expenses_month,
    total_stock_value = EXCLUDED.total_stock_value,
    gross_margin_pct  = EXCLUDED.gross_margin_pct;
END;
$$;

-- Cohort retention query helper
CREATE OR REPLACE FUNCTION get_cohort_retention(p_org_id uuid, p_months int DEFAULT 6)
RETURNS TABLE(
  cohort_month  date,
  month_offset  int,
  customers     bigint,
  retained      bigint,
  retention_pct numeric
) LANGUAGE sql STABLE AS $$
  WITH first_purchase AS (
    SELECT customer_id, MIN(DATE_TRUNC('month', created_at)) AS cohort_month
    FROM sales
    WHERE org_id = p_org_id AND customer_id IS NOT NULL
    GROUP BY customer_id
  ),
  cohort_activity AS (
    SELECT
      fp.cohort_month,
      DATE_TRUNC('month', s.created_at) AS activity_month,
      s.customer_id
    FROM sales s
    JOIN first_purchase fp ON fp.customer_id = s.customer_id
    WHERE s.org_id = p_org_id
  )
  SELECT
    cohort_month::date,
    EXTRACT(MONTH FROM AGE(activity_month, cohort_month))::int AS month_offset,
    COUNT(DISTINCT ca.customer_id) FILTER (WHERE month_offset = 0) OVER (PARTITION BY cohort_month) AS customers,
    COUNT(DISTINCT ca.customer_id) AS retained,
    ROUND(COUNT(DISTINCT ca.customer_id) * 100.0 /
      NULLIF(COUNT(DISTINCT ca.customer_id) FILTER (WHERE EXTRACT(MONTH FROM AGE(activity_month, cohort_month)) = 0) OVER (PARTITION BY cohort_month), 0), 1) AS retention_pct
  FROM cohort_activity ca
  WHERE cohort_month >= DATE_TRUNC('month', NOW()) - ((p_months-1) || ' months')::interval
  GROUP BY cohort_month, activity_month, ca.customer_id
  ORDER BY cohort_month, month_offset;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bi_snapshots_org      ON bi_snapshots(org_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_saved_reports_org     ON saved_reports(org_id, report_type, is_pinned);
CREATE INDEX IF NOT EXISTS idx_report_schedules_org  ON report_schedules(org_id, is_active, next_run_at);
CREATE INDEX IF NOT EXISTS idx_bi_drilldowns_org     ON bi_drilldowns(org_id, user_id, created_at DESC);

-- RLS
ALTER TABLE bi_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_reports    ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE bi_drilldowns    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_bi_snapshots"     ON bi_snapshots;
DROP POLICY IF EXISTS "org_saved_reports"    ON saved_reports;
DROP POLICY IF EXISTS "org_report_schedules" ON report_schedules;
DROP POLICY IF EXISTS "org_bi_drilldowns"    ON bi_drilldowns;

CREATE POLICY "org_bi_snapshots"     ON bi_snapshots     USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_saved_reports"    ON saved_reports    USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_report_schedules" ON report_schedules USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_bi_drilldowns"    ON bi_drilldowns    USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
