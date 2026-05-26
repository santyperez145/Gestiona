-- KPI Builder & Metrics Dashboard

CREATE TABLE IF NOT EXISTS kpi_dashboards (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  description   text,
  is_default    boolean     NOT NULL DEFAULT false,
  layout        jsonb       NOT NULL DEFAULT '[]',   -- widget grid positions
  created_by    uuid        REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kpi_widgets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id    uuid        NOT NULL REFERENCES kpi_dashboards(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           text        NOT NULL,
  widget_type     text        NOT NULL CHECK (widget_type IN ('number','trend','bar_chart','pie_chart','table','gauge','sparkline','comparison')),
  data_source     text        NOT NULL CHECK (data_source IN (
                    'sales_total','sales_count','avg_ticket','top_products',
                    'inventory_value','low_stock_count','stockout_count',
                    'accounts_receivable','accounts_payable','cash_balance',
                    'expense_total','revenue_total','gross_margin',
                    'new_customers','active_customers','churn_rate',
                    'open_quotes','quote_conversion',
                    'open_tasks','overdue_tasks',
                    'custom_query'
                  )),
  time_range      text        NOT NULL DEFAULT 'current_month' CHECK (time_range IN ('today','yesterday','last_7_days','last_30_days','current_month','last_month','current_quarter','current_year','custom')),
  custom_from     date,
  custom_to       date,
  filters         jsonb       NOT NULL DEFAULT '{}',   -- {category_id, supplier_id, ...}
  display_config  jsonb       NOT NULL DEFAULT '{}',   -- {color, prefix, suffix, decimals, goal, comparison_period}
  custom_sql      text,                                -- only when data_source = 'custom_query'
  position_x      int         NOT NULL DEFAULT 0,
  position_y      int         NOT NULL DEFAULT 0,
  width           int         NOT NULL DEFAULT 2 CHECK (width BETWEEN 1 AND 4),
  height          int         NOT NULL DEFAULT 1 CHECK (height BETWEEN 1 AND 4),
  is_visible      boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kpi_goals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  widget_id       uuid        REFERENCES kpi_widgets(id) ON DELETE SET NULL,
  name            text        NOT NULL,
  metric          text        NOT NULL,
  target_value    numeric(18,4) NOT NULL,
  current_value   numeric(18,4) NOT NULL DEFAULT 0,
  unit            text        NOT NULL DEFAULT '',
  period_start    date        NOT NULL,
  period_end      date        NOT NULL,
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','missed','paused')),
  color           text        NOT NULL DEFAULT '#3b82f6',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kpi_alerts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  widget_id       uuid        REFERENCES kpi_widgets(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  condition       text        NOT NULL CHECK (condition IN ('above','below','equals','change_pct')),
  threshold       numeric(18,4) NOT NULL,
  notification_type text      NOT NULL DEFAULT 'in_app' CHECK (notification_type IN ('in_app','email','both')),
  is_active       boolean     NOT NULL DEFAULT true,
  last_triggered  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Enforce single default dashboard per org
CREATE OR REPLACE FUNCTION enforce_single_default_dashboard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_default = TRUE THEN
    UPDATE kpi_dashboards
    SET is_default = FALSE
    WHERE org_id = NEW.org_id AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_single_default_dashboard
AFTER INSERT OR UPDATE ON kpi_dashboards
FOR EACH ROW WHEN (NEW.is_default = TRUE)
EXECUTE FUNCTION enforce_single_default_dashboard();

-- Updated_at triggers
CREATE OR REPLACE FUNCTION update_kpi_dashboard_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE OR REPLACE TRIGGER trg_kpi_dashboard_ts
BEFORE UPDATE ON kpi_dashboards
FOR EACH ROW EXECUTE FUNCTION update_kpi_dashboard_ts();

CREATE OR REPLACE FUNCTION update_kpi_widget_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE OR REPLACE TRIGGER trg_kpi_widget_ts
BEFORE UPDATE ON kpi_widgets
FOR EACH ROW EXECUTE FUNCTION update_kpi_widget_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kpi_dashboards_org ON kpi_dashboards(org_id);
CREATE INDEX IF NOT EXISTS idx_kpi_widgets_dash   ON kpi_widgets(dashboard_id, is_visible);
CREATE INDEX IF NOT EXISTS idx_kpi_goals_org      ON kpi_goals(org_id, status, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_kpi_alerts_widget  ON kpi_alerts(widget_id, is_active);

-- RLS
ALTER TABLE kpi_dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_widgets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_goals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_alerts     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_kpi_dashboards" ON kpi_dashboards;
DROP POLICY IF EXISTS "org_kpi_widgets"    ON kpi_widgets;
DROP POLICY IF EXISTS "org_kpi_goals"      ON kpi_goals;
DROP POLICY IF EXISTS "org_kpi_alerts"     ON kpi_alerts;

CREATE POLICY "org_kpi_dashboards" ON kpi_dashboards
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_kpi_widgets" ON kpi_widgets
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_kpi_goals" ON kpi_goals
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_kpi_alerts" ON kpi_alerts
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
