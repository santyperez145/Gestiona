-- Carbon Footprint Tracker: emissions by scope, offset programs, ESG reporting

CREATE TABLE IF NOT EXISTS carbon_emission_categories (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope           int         NOT NULL CHECK (scope IN (1, 2, 3)),  -- GHG Protocol scopes
  category        text        NOT NULL,
  subcategory     text,
  emission_factor numeric(12,6) NOT NULL DEFAULT 0,  -- kgCO2e per unit
  unit            text        NOT NULL DEFAULT 'kwh',
  source          text        NOT NULL DEFAULT 'IPCC_2021',
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carbon_emissions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id     uuid        NOT NULL REFERENCES carbon_emission_categories(id) ON DELETE CASCADE,
  period_date     date        NOT NULL,
  quantity        numeric(14,4) NOT NULL DEFAULT 0,
  co2e_kg         numeric(14,4) GENERATED ALWAYS AS (ROUND(quantity * (SELECT emission_factor FROM carbon_emission_categories WHERE id = category_id), 4)) STORED,
  source          text,
  notes           text,
  verified        boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carbon_offsets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  program_name    text        NOT NULL,
  provider        text,
  offset_type     text        NOT NULL DEFAULT 'reforestation' CHECK (offset_type IN ('reforestation','renewable_energy','methane_capture','ocean','other')),
  certificate_id  text,
  co2e_kg_offset  numeric(14,4) NOT NULL DEFAULT 0,
  cost_ars        numeric(14,2) NOT NULL DEFAULT 0,
  purchase_date   date        NOT NULL,
  valid_until     date,
  is_retired      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS carbon_targets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  target_year     int         NOT NULL,
  baseline_year   int         NOT NULL DEFAULT 2023,
  baseline_co2e   numeric(14,4) NOT NULL DEFAULT 0,
  reduction_pct   numeric(5,2) NOT NULL DEFAULT 30,
  target_co2e     numeric(14,4) GENERATED ALWAYS AS (ROUND(baseline_co2e * (1 - reduction_pct / 100.0), 4)) STORED,
  strategy        text,
  is_science_based boolean    NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, target_year)
);

-- Monthly emissions summary by scope
CREATE OR REPLACE VIEW carbon_monthly_summary AS
SELECT
  ce.org_id,
  to_char(ce.period_date, 'YYYY-MM') AS period_month,
  cec.scope,
  SUM(ce.co2e_kg) AS total_co2e_kg,
  SUM(ce.quantity) AS total_quantity,
  COUNT(*) AS entry_count
FROM carbon_emissions ce
JOIN carbon_emission_categories cec ON cec.id = ce.category_id
GROUP BY ce.org_id, to_char(ce.period_date, 'YYYY-MM'), cec.scope;

-- Net emissions (gross - offsets)
CREATE OR REPLACE FUNCTION get_net_emissions(p_org_id uuid, p_year int DEFAULT 2026)
RETURNS TABLE(
  scope         int,
  gross_co2e    numeric,
  offsets_co2e  numeric,
  net_co2e      numeric,
  reduction_pct numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    cec.scope,
    COALESCE(SUM(ce.co2e_kg), 0) AS gross_co2e,
    COALESCE((SELECT SUM(co2e_kg_offset) FROM carbon_offsets WHERE org_id = p_org_id
              AND EXTRACT(YEAR FROM purchase_date) = p_year AND NOT is_retired), 0) AS offsets_co2e,
    COALESCE(SUM(ce.co2e_kg), 0) - COALESCE((SELECT SUM(co2e_kg_offset) FROM carbon_offsets WHERE org_id = p_org_id
              AND EXTRACT(YEAR FROM purchase_date) = p_year AND NOT is_retired), 0) AS net_co2e,
    CASE WHEN COALESCE(SUM(ce.co2e_kg), 0) = 0 THEN 0
    ELSE ROUND(COALESCE((SELECT SUM(co2e_kg_offset) FROM carbon_offsets WHERE org_id = p_org_id
              AND EXTRACT(YEAR FROM purchase_date) = p_year AND NOT is_retired), 0) /
              NULLIF(SUM(ce.co2e_kg), 0) * 100, 2) END AS reduction_pct
  FROM carbon_emission_categories cec
  LEFT JOIN carbon_emissions ce ON ce.category_id = cec.id AND ce.org_id = p_org_id
    AND EXTRACT(YEAR FROM ce.period_date) = p_year
  WHERE cec.org_id = p_org_id
  GROUP BY cec.scope;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_carbon_emissions_org    ON carbon_emissions(org_id, period_date DESC);
CREATE INDEX IF NOT EXISTS idx_carbon_offsets_org      ON carbon_offsets(org_id, purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_carbon_targets_org      ON carbon_targets(org_id, target_year);

-- RLS
ALTER TABLE carbon_emission_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE carbon_emissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE carbon_offsets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE carbon_targets             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_carbon_categories" ON carbon_emission_categories;
DROP POLICY IF EXISTS "org_carbon_emissions"  ON carbon_emissions;
DROP POLICY IF EXISTS "org_carbon_offsets"    ON carbon_offsets;
DROP POLICY IF EXISTS "org_carbon_targets"    ON carbon_targets;

CREATE POLICY "org_carbon_categories" ON carbon_emission_categories USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_carbon_emissions"  ON carbon_emissions           USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_carbon_offsets"    ON carbon_offsets             USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_carbon_targets"    ON carbon_targets             USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
