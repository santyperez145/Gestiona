-- Product Bundles / Kits
-- Allow grouping products into sell-as-one bundles

CREATE TABLE IF NOT EXISTS product_bundles (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  description   text,
  image_url     text,
  sale_price    numeric(12,2) NOT NULL DEFAULT 0,
  active        boolean     NOT NULL DEFAULT true,
  featured      boolean     NOT NULL DEFAULT false,
  sold_count    int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_bundle_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id     uuid        NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
  product_id    uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity      int         NOT NULL DEFAULT 1,
  UNIQUE (bundle_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_bundles_org    ON product_bundles(org_id, active);
CREATE INDEX IF NOT EXISTS idx_bundle_items   ON product_bundle_items(bundle_id);
CREATE INDEX IF NOT EXISTS idx_bundle_product ON product_bundle_items(product_id);

-- Compute bundle cost from components
CREATE OR REPLACE FUNCTION get_bundle_component_cost(p_bundle_id uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(p.sale_price_ars * bi.quantity), 0)
  FROM product_bundle_items bi
  JOIN products p ON p.id = bi.product_id
  WHERE bi.bundle_id = p_bundle_id;
$$;

-- Check if all components have sufficient stock
CREATE OR REPLACE FUNCTION bundle_has_stock(p_bundle_id uuid, p_qty int DEFAULT 1)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT bool_and(p.stock >= bi.quantity * p_qty)
  FROM product_bundle_items bi
  JOIN products p ON p.id = bi.product_id
  WHERE bi.bundle_id = p_bundle_id;
$$;

-- Deduct stock from bundle components
CREATE OR REPLACE FUNCTION deduct_bundle_stock(p_bundle_id uuid, p_qty int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products p
  SET stock = stock - (bi.quantity * p_qty)
  FROM product_bundle_items bi
  WHERE bi.bundle_id = p_bundle_id AND p.id = bi.product_id;

  UPDATE product_bundles SET sold_count = sold_count + p_qty, updated_at = now()
  WHERE id = p_bundle_id;
END;
$$;

-- updated_at
CREATE OR REPLACE FUNCTION update_bundle_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_bundles_updated ON product_bundles;
CREATE TRIGGER trg_bundles_updated
  BEFORE UPDATE ON product_bundles
  FOR EACH ROW EXECUTE FUNCTION update_bundle_timestamp();

-- RLS
ALTER TABLE product_bundles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_bundle_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_bundles"      ON product_bundles;
DROP POLICY IF EXISTS "org_bundle_items" ON product_bundle_items;

CREATE POLICY "org_bundles" ON product_bundles
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_bundle_items" ON product_bundle_items
  USING (bundle_id IN (SELECT id FROM product_bundles WHERE org_id IN (
    SELECT org_id FROM org_members WHERE user_id = auth.uid()
  )));
