-- Fixed Assets & Depreciation

CREATE TABLE IF NOT EXISTS fixed_assets (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_number        text,
  name                text        NOT NULL,
  category            text        NOT NULL DEFAULT 'equipment'
                                  CHECK (category IN ('equipment','furniture','vehicle','building','land','computer','software','other')),
  description         text,
  location            text,
  assigned_to         text,
  purchase_date       date        NOT NULL DEFAULT CURRENT_DATE,
  purchase_cost       numeric(14,2) NOT NULL DEFAULT 0,
  salvage_value       numeric(14,2) NOT NULL DEFAULT 0,
  useful_life_years   int         NOT NULL DEFAULT 5,
  depreciation_method text        NOT NULL DEFAULT 'straight_line'
                                  CHECK (depreciation_method IN ('straight_line','declining_balance','units_of_production')),
  annual_rate_pct     numeric(8,4),          -- for declining balance method
  status              text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active','disposed','fully_depreciated','written_off')),
  disposed_at         date,
  disposal_value      numeric(14,2),
  supplier_name       text,
  invoice_number      text,
  warranty_expiry     date,
  notes               text,
  active              boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asset_depreciation_entries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id        uuid        NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  period_year     int         NOT NULL,
  period_month    int         NOT NULL,
  depreciation    numeric(14,2) NOT NULL DEFAULT 0,
  book_value_end  numeric(14,2) NOT NULL DEFAULT 0,
  accumulated     numeric(14,2) NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, period_year, period_month)
);

-- Calculate annual straight-line depreciation
CREATE OR REPLACE FUNCTION calc_sl_depreciation(
  p_cost numeric, p_salvage numeric, p_life_years int
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_life_years > 0 THEN (p_cost - p_salvage) / p_life_years ELSE 0 END;
$$;

-- Auto-number assets per org
CREATE OR REPLACE FUNCTION set_asset_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
  IF NEW.asset_number IS NULL OR NEW.asset_number = '' THEN
    SELECT COUNT(*) + 1 INTO v_count FROM fixed_assets WHERE org_id = NEW.org_id;
    NEW.asset_number := 'AF-' || lpad(v_count::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_asset_number ON fixed_assets;
CREATE TRIGGER trg_asset_number BEFORE INSERT ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION set_asset_number();

CREATE OR REPLACE FUNCTION update_asset_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_asset_ts ON fixed_assets;
CREATE TRIGGER trg_asset_ts BEFORE UPDATE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION update_asset_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fixed_assets_org     ON fixed_assets(org_id, status, active);
CREATE INDEX IF NOT EXISTS idx_asset_depr_asset     ON asset_depreciation_entries(asset_id, period_year, period_month);

-- RLS
ALTER TABLE fixed_assets                ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_depreciation_entries  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_fixed_assets"    ON fixed_assets;
DROP POLICY IF EXISTS "org_asset_depr"      ON asset_depreciation_entries;

CREATE POLICY "org_fixed_assets" ON fixed_assets
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_asset_depr" ON asset_depreciation_entries
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
