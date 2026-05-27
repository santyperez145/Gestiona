-- Product Lifecycle Management: PLM stages, versions, compliance, EOL

CREATE TABLE IF NOT EXISTS plm_products (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        REFERENCES products(id) ON DELETE SET NULL,
  internal_code   text        NOT NULL,
  name            text        NOT NULL,
  lifecycle_stage text        NOT NULL DEFAULT 'concept' CHECK (lifecycle_stage IN ('concept','development','testing','launch','growth','maturity','decline','eol','discontinued')),
  version         text        NOT NULL DEFAULT '1.0.0',
  launch_date     date,
  eol_date        date,
  responsible_id  uuid        REFERENCES auth.users(id),
  certifications  text[]      NOT NULL DEFAULT '{}',
  compliance_docs text[]      NOT NULL DEFAULT '{}',
  components      jsonb       NOT NULL DEFAULT '[]',  -- BOM list [{part_id, qty, unit}]
  quality_score   numeric(5,2) NOT NULL DEFAULT 0,
  market_share_pct numeric(5,2) NOT NULL DEFAULT 0,
  revenue_ltm     numeric(18,2) NOT NULL DEFAULT 0,
  margin_pct      numeric(5,2) NOT NULL DEFAULT 0,
  tags            text[]      NOT NULL DEFAULT '{}',
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, internal_code)
);

CREATE TABLE IF NOT EXISTS plm_stage_history (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plm_product_id  uuid        NOT NULL REFERENCES plm_products(id) ON DELETE CASCADE,
  from_stage      text,
  to_stage        text        NOT NULL,
  changed_by      uuid        REFERENCES auth.users(id),
  reason          text,
  gate_score      int,         -- 0-100 stage gate review score
  approved_by     uuid        REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plm_versions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plm_product_id  uuid        NOT NULL REFERENCES plm_products(id) ON DELETE CASCADE,
  version         text        NOT NULL,
  changes         text[],
  release_date    date,
  is_current      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plm_quality_checks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plm_product_id  uuid        NOT NULL REFERENCES plm_products(id) ON DELETE CASCADE,
  check_type      text        NOT NULL CHECK (check_type IN ('visual','functional','compliance','safety','durability','performance')),
  result          text        NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','pass','fail','conditional')),
  score           int         CHECK (score BETWEEN 0 AND 100),
  inspector       text,
  notes           text,
  checked_at      date        NOT NULL DEFAULT CURRENT_DATE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- BCG Matrix position based on market share and revenue growth
CREATE OR REPLACE FUNCTION get_bcg_matrix(p_org_id uuid)
RETURNS TABLE(
  product_id      uuid,
  product_name    text,
  market_share    numeric,
  growth_rate     numeric,
  quadrant        text,
  revenue_ltm     numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    pp.id,
    pp.name,
    pp.market_share_pct,
    CASE WHEN pp.revenue_ltm > 0 THEN pp.margin_pct ELSE 0 END AS growth_rate,
    CASE
      WHEN pp.market_share_pct >= 20 AND pp.margin_pct >= 15 THEN 'star'
      WHEN pp.market_share_pct >= 20 AND pp.margin_pct < 15 THEN 'cash_cow'
      WHEN pp.market_share_pct < 20 AND pp.margin_pct >= 15 THEN 'question_mark'
      ELSE 'dog'
    END AS quadrant,
    pp.revenue_ltm
  FROM plm_products pp
  WHERE pp.org_id = p_org_id
    AND pp.lifecycle_stage NOT IN ('discontinued','eol')
  ORDER BY pp.revenue_ltm DESC;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_plm_products_org   ON plm_products(org_id, lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_plm_stage_hist     ON plm_stage_history(plm_product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plm_quality        ON plm_quality_checks(plm_product_id, checked_at DESC);

-- RLS
ALTER TABLE plm_products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE plm_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE plm_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE plm_quality_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_plm_products"  ON plm_products;
DROP POLICY IF EXISTS "org_plm_history"   ON plm_stage_history;
DROP POLICY IF EXISTS "org_plm_versions"  ON plm_versions;
DROP POLICY IF EXISTS "org_plm_quality"   ON plm_quality_checks;

CREATE POLICY "org_plm_products"  ON plm_products       USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_plm_history"   ON plm_stage_history  USING (plm_product_id IN (SELECT id FROM plm_products WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
CREATE POLICY "org_plm_versions"  ON plm_versions       USING (plm_product_id IN (SELECT id FROM plm_products WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
CREATE POLICY "org_plm_quality"   ON plm_quality_checks USING (plm_product_id IN (SELECT id FROM plm_products WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
