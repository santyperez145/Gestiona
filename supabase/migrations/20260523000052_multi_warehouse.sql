-- Multi-Warehouse Bin / Location Management

CREATE TABLE IF NOT EXISTS warehouses (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  code        text,
  address     text,
  manager     text,
  phone       text,
  active      boolean     NOT NULL DEFAULT true,
  is_default  boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_zones (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id  uuid        NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  org_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          text        NOT NULL,    -- Zona A, Zona B, Zona Frío...
  zone_type     text        NOT NULL DEFAULT 'general'
                            CHECK (zone_type IN ('general','cold','bulk','hazardous','quarantine','dispatch','receiving')),
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_bins (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id     uuid        NOT NULL REFERENCES warehouse_zones(id) ON DELETE CASCADE,
  warehouse_id uuid       NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  org_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code        text        NOT NULL,      -- A-01-01, B-02-03...
  description text,
  capacity    numeric(10,2),             -- unidades o m3
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, code)
);

CREATE TABLE IF NOT EXISTS bin_stock (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bin_id      uuid        NOT NULL REFERENCES warehouse_bins(id) ON DELETE CASCADE,
  product_id  uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    numeric(14,4) NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bin_id, product_id)
);

-- Ensure only 1 default warehouse per org
CREATE OR REPLACE FUNCTION enforce_single_default_warehouse()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE warehouses SET is_default = false WHERE org_id = NEW.org_id AND id <> NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_warehouse ON warehouses;
CREATE TRIGGER trg_default_warehouse AFTER INSERT OR UPDATE ON warehouses
  FOR EACH ROW WHEN (NEW.is_default = true) EXECUTE FUNCTION enforce_single_default_warehouse();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_warehouses_org     ON warehouses(org_id, active);
CREATE INDEX IF NOT EXISTS idx_zones_warehouse    ON warehouse_zones(warehouse_id, active);
CREATE INDEX IF NOT EXISTS idx_bins_zone          ON warehouse_bins(zone_id, active);
CREATE INDEX IF NOT EXISTS idx_bin_stock_bin      ON bin_stock(bin_id, product_id);
CREATE INDEX IF NOT EXISTS idx_bin_stock_product  ON bin_stock(product_id, org_id);

-- RLS
ALTER TABLE warehouses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_bins  ENABLE ROW LEVEL SECURITY;
ALTER TABLE bin_stock       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_warehouses"      ON warehouses;
DROP POLICY IF EXISTS "org_wh_zones"        ON warehouse_zones;
DROP POLICY IF EXISTS "org_wh_bins"         ON warehouse_bins;
DROP POLICY IF EXISTS "org_bin_stock"       ON bin_stock;

CREATE POLICY "org_warehouses" ON warehouses
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_wh_zones" ON warehouse_zones
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_wh_bins" ON warehouse_bins
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_bin_stock" ON bin_stock
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
