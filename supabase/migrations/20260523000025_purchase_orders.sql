-- Formal Purchase Orders (OC) to Suppliers

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_number    text        NOT NULL,
  supplier_id     uuid        REFERENCES proveedores(id) ON DELETE SET NULL,
  supplier_name   text        NOT NULL,
  supplier_email  text,
  status          text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','sent','confirmed','partially_received','received','cancelled')),
  currency        text        NOT NULL DEFAULT 'ARS',
  subtotal        numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount      numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount    numeric(14,2) NOT NULL DEFAULT 0,
  notes           text,
  internal_notes  text,
  expected_date   date,
  received_date   date,
  payment_terms   text,       -- 'immediate','15_days','30_days','60_days'
  sent_at         timestamptz,
  confirmed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, order_number)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid        NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        REFERENCES products(id) ON DELETE SET NULL,
  product_name    text        NOT NULL,
  sku             text,
  quantity_ordered numeric(10,3) NOT NULL DEFAULT 1,
  quantity_received numeric(10,3) NOT NULL DEFAULT 0,
  unit_cost       numeric(12,2) NOT NULL DEFAULT 0,
  tax_rate        numeric(5,2) NOT NULL DEFAULT 21,   -- IVA %
  total_cost      numeric(14,2) GENERATED ALWAYS AS (quantity_ordered * unit_cost) STORED,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_receipts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid        NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  receipt_number  text        NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_org        ON purchase_orders(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_supplier   ON purchase_orders(supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_po_items      ON purchase_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_po_receipts   ON purchase_order_receipts(order_id);

-- Recalculate PO totals when items change
CREATE OR REPLACE FUNCTION recalculate_po_totals()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  oid uuid := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
  UPDATE purchase_orders
  SET
    subtotal = COALESCE((SELECT SUM(total_cost) FROM purchase_order_items WHERE order_id = oid), 0),
    tax_amount = COALESCE((SELECT SUM(total_cost * tax_rate / 100) FROM purchase_order_items WHERE order_id = oid), 0),
    total_amount = COALESCE((SELECT SUM(total_cost * (1 + tax_rate / 100)) FROM purchase_order_items WHERE order_id = oid), 0),
    updated_at = now()
  WHERE id = oid;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_po_totals ON purchase_order_items;
CREATE TRIGGER trg_po_totals
  AFTER INSERT OR UPDATE OR DELETE ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION recalculate_po_totals();

-- Generate OC number
CREATE OR REPLACE FUNCTION generate_po_number(p_org_id uuid)
RETURNS text LANGUAGE sql AS $$
  SELECT 'OC-' || TO_CHAR(now(), 'YYYY') || '-' || LPAD(
    (SELECT COUNT(*) + 1 FROM purchase_orders WHERE org_id = p_org_id)::text, 5, '0'
  );
$$;

-- updated_at
CREATE OR REPLACE FUNCTION update_po_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_po_updated ON purchase_orders;
CREATE TRIGGER trg_po_updated BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION update_po_timestamp();

-- RLS
ALTER TABLE purchase_orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_purchase_orders"   ON purchase_orders;
DROP POLICY IF EXISTS "org_po_items"          ON purchase_order_items;
DROP POLICY IF EXISTS "org_po_receipts"       ON purchase_order_receipts;

CREATE POLICY "org_purchase_orders" ON purchase_orders         USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_po_items"        ON purchase_order_items    USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_po_receipts"     ON purchase_order_receipts USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
