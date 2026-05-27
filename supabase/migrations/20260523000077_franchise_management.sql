-- Franchise Management: multi-franchise org hierarchy, royalties, compliance

CREATE TABLE IF NOT EXISTS franchise_network (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  franchisor_org  uuid        REFERENCES organizations(id) ON DELETE SET NULL,
  network_type    text        NOT NULL DEFAULT 'direct' CHECK (network_type IN ('direct','master','sub')),
  royalty_pct     numeric(5,2) NOT NULL DEFAULT 5.0,
  marketing_fee_pct numeric(5,2) NOT NULL DEFAULT 2.0,
  territory       text,
  country         text        NOT NULL DEFAULT 'AR',
  inception_date  date,
  contract_end    date,
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','terminated','prospect')),
  kpis            jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS franchise_units (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid        NOT NULL REFERENCES franchise_network(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_code       text        NOT NULL,
  owner_name      text        NOT NULL,
  address         jsonb       NOT NULL DEFAULT '{}',
  opened_at       date,
  revenue_mtd     numeric(18,2) NOT NULL DEFAULT 0,
  revenue_ytd     numeric(18,2) NOT NULL DEFAULT 0,
  compliance_score int        NOT NULL DEFAULT 100 CHECK (compliance_score BETWEEN 0 AND 100),
  last_audit      date,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network_id, unit_code)
);

CREATE TABLE IF NOT EXISTS franchise_royalties (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id      uuid        NOT NULL REFERENCES franchise_network(id) ON DELETE CASCADE,
  unit_id         uuid        NOT NULL REFERENCES franchise_units(id) ON DELETE CASCADE,
  period_month    text        NOT NULL,  -- YYYY-MM
  gross_revenue   numeric(18,2) NOT NULL DEFAULT 0,
  royalty_amount  numeric(18,2) GENERATED ALWAYS AS (
    ROUND(gross_revenue * (
      SELECT royalty_pct FROM franchise_network WHERE id = network_id
    ) / 100.0, 2)
  ) STORED,
  marketing_fee   numeric(18,2) GENERATED ALWAYS AS (
    ROUND(gross_revenue * (
      SELECT marketing_fee_pct FROM franchise_network WHERE id = network_id
    ) / 100.0, 2)
  ) STORED,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','invoiced','paid','overdue')),
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, period_month)
);

CREATE TABLE IF NOT EXISTS franchise_compliance (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         uuid        NOT NULL REFERENCES franchise_units(id) ON DELETE CASCADE,
  audit_date      date        NOT NULL,
  auditor_name    text,
  category        text        NOT NULL CHECK (category IN ('operations','branding','training','financial','hygiene','other')),
  score           int         NOT NULL CHECK (score BETWEEN 0 AND 100),
  findings        text[],
  action_required boolean     NOT NULL DEFAULT false,
  resolved_at     date,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Network performance summary
CREATE OR REPLACE VIEW franchise_network_kpis AS
SELECT
  fn.id AS network_id,
  fn.name AS network_name,
  COUNT(fu.id) AS total_units,
  COUNT(fu.id) FILTER (WHERE fu.is_active) AS active_units,
  SUM(fu.revenue_mtd) AS total_revenue_mtd,
  SUM(fu.revenue_ytd) AS total_revenue_ytd,
  ROUND(AVG(fu.compliance_score), 1) AS avg_compliance,
  SUM(fr.royalty_amount) FILTER (WHERE fr.status = 'pending') AS pending_royalties
FROM franchise_network fn
LEFT JOIN franchise_units fu ON fu.network_id = fn.id
LEFT JOIN franchise_royalties fr ON fr.unit_id = fu.id
GROUP BY fn.id, fn.name;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_franchise_units_network  ON franchise_units(network_id, is_active);
CREATE INDEX IF NOT EXISTS idx_franchise_royalties_unit ON franchise_royalties(unit_id, period_month DESC);
CREATE INDEX IF NOT EXISTS idx_franchise_compliance     ON franchise_compliance(unit_id, audit_date DESC);

-- RLS
ALTER TABLE franchise_network    ENABLE ROW LEVEL SECURITY;
ALTER TABLE franchise_units      ENABLE ROW LEVEL SECURITY;
ALTER TABLE franchise_royalties  ENABLE ROW LEVEL SECURITY;
ALTER TABLE franchise_compliance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_franchise_network"    ON franchise_network;
DROP POLICY IF EXISTS "org_franchise_units"      ON franchise_units;
DROP POLICY IF EXISTS "org_franchise_royalties"  ON franchise_royalties;
DROP POLICY IF EXISTS "org_franchise_compliance" ON franchise_compliance;

CREATE POLICY "org_franchise_network"    ON franchise_network    USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_franchise_units"      ON franchise_units      USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_franchise_royalties"  ON franchise_royalties  USING (unit_id IN (SELECT fu.id FROM franchise_units fu JOIN franchise_network fn ON fn.id = fu.network_id WHERE fn.org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
CREATE POLICY "org_franchise_compliance" ON franchise_compliance USING (unit_id IN (SELECT fu.id FROM franchise_units fu JOIN franchise_network fn ON fn.id = fu.network_id WHERE fn.org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
