-- Dropshipping Order Management

CREATE TABLE IF NOT EXISTS dropship_suppliers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  contact_name    text,
  email           text,
  phone           text,
  website         text,
  country         text        NOT NULL DEFAULT 'AR',
  currency        text        NOT NULL DEFAULT 'ARS',
  avg_dispatch_days int       NOT NULL DEFAULT 3,
  commission_pct  numeric(6,4) NOT NULL DEFAULT 0,   -- % the org earns
  payment_terms   text,       -- 'prepaid', 'net30', etc.
  notes           text,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dropship_products (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id     uuid        NOT NULL REFERENCES dropship_suppliers(id) ON DELETE CASCADE,
  product_id      uuid        REFERENCES products(id) ON DELETE SET NULL,  -- linked internal product
  supplier_sku    text,
  supplier_price  numeric(14,2) NOT NULL DEFAULT 0,
  sell_price      numeric(14,2) NOT NULL DEFAULT 0,
  margin_pct      numeric(6,4) GENERATED ALWAYS AS (
    CASE WHEN sell_price > 0
    THEN ROUND(((sell_price - supplier_price) / sell_price) * 100, 4)
    ELSE 0 END
  ) STORED,
  stock_status    text        NOT NULL DEFAULT 'available'
                              CHECK (stock_status IN ('available','out_of_stock','discontinued')),
  supplier_url    text,
  notes           text,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dropship_orders (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_number    text        NOT NULL,
  supplier_id     uuid        NOT NULL REFERENCES dropship_suppliers(id) ON DELETE CASCADE,
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   text        NOT NULL,
  customer_phone  text,
  -- Shipping address
  ship_address    text,
  ship_city       text,
  ship_province   text,
  ship_zip        text,
  -- Financials
  supplier_total  numeric(14,2) NOT NULL DEFAULT 0,
  sell_total      numeric(14,2) NOT NULL DEFAULT 0,
  profit          numeric(14,2) GENERATED ALWAYS AS (sell_total - supplier_total) STORED,
  -- Status
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','ordered_from_supplier','dispatched','in_transit','delivered','cancelled','returned')),
  supplier_order_ref text,
  tracking_code   text,
  estimated_delivery date,
  dispatched_at   timestamptz,
  delivered_at    timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dropship_order_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid        NOT NULL REFERENCES dropship_orders(id) ON DELETE CASCADE,
  dropship_product_id uuid    REFERENCES dropship_products(id) ON DELETE SET NULL,
  product_name    text        NOT NULL,
  supplier_sku    text,
  quantity        int         NOT NULL DEFAULT 1,
  supplier_price  numeric(14,2) NOT NULL,
  sell_price      numeric(14,2) NOT NULL,
  notes           text
);

-- Auto order number
CREATE OR REPLACE FUNCTION generate_dropship_number(p_org_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) + 1 INTO v_count FROM dropship_orders WHERE org_id = p_org_id;
  RETURN 'DS-' || to_char(now(), 'YYYY') || '-' || lpad(v_count::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION set_dropship_order_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.order_number := generate_dropship_number(NEW.org_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dropship_order_num ON dropship_orders;
CREATE TRIGGER trg_dropship_order_num BEFORE INSERT ON dropship_orders
  FOR EACH ROW EXECUTE FUNCTION set_dropship_order_number();

-- updated_at
CREATE OR REPLACE FUNCTION update_dropship_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_dropship_ts ON dropship_orders;
CREATE TRIGGER trg_dropship_ts BEFORE UPDATE ON dropship_orders FOR EACH ROW EXECUTE FUNCTION update_dropship_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ds_suppliers_org ON dropship_suppliers(org_id, active);
CREATE INDEX IF NOT EXISTS idx_ds_products_org  ON dropship_products(org_id, active);
CREATE INDEX IF NOT EXISTS idx_ds_products_sup  ON dropship_products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_ds_orders_org    ON dropship_orders(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ds_order_items   ON dropship_order_items(order_id);

-- RLS
ALTER TABLE dropship_suppliers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE dropship_products     ENABLE ROW LEVEL SECURITY;
ALTER TABLE dropship_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE dropship_order_items  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_ds_suppliers"    ON dropship_suppliers;
DROP POLICY IF EXISTS "org_ds_products"     ON dropship_products;
DROP POLICY IF EXISTS "org_ds_orders"       ON dropship_orders;
DROP POLICY IF EXISTS "org_ds_order_items"  ON dropship_order_items;

CREATE POLICY "org_ds_suppliers" ON dropship_suppliers
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ds_products" ON dropship_products
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ds_orders" ON dropship_orders
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ds_order_items" ON dropship_order_items
  USING (order_id IN (SELECT id FROM dropship_orders WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
