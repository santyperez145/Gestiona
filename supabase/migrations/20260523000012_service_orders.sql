-- Service Orders (Work Orders) — Salesforce Field Service equivalent

CREATE TABLE IF NOT EXISTS service_orders (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_number    text        NOT NULL,
  title           text        NOT NULL,
  description     text,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','assigned','in_progress','on_hold','completed','cancelled')),
  priority        text        NOT NULL DEFAULT 'medium'
                              CHECK (priority IN ('low','medium','high','urgent')),
  service_type    text        NOT NULL DEFAULT 'repair'
                              CHECK (service_type IN ('repair','installation','maintenance','inspection','consultation','other')),
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   text,
  customer_phone  text,
  customer_address text,
  assigned_to     uuid,
  assigned_name   text,
  scheduled_at    timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  estimated_hours numeric(5,2),
  actual_hours    numeric(5,2),
  labor_cost      numeric(12,2) NOT NULL DEFAULT 0,
  parts_cost      numeric(12,2) NOT NULL DEFAULT 0,
  total_cost      numeric(12,2) GENERATED ALWAYS AS (labor_cost + parts_cost) STORED,
  notes           text,
  internal_notes  text,
  signature_name  text,
  signature_at    timestamptz,
  signature_data  text,   -- base64 SVG or PNG of signature
  rating          int     CHECK (rating BETWEEN 1 AND 5),
  rating_comment  text,
  tags            text[],
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_order_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid        NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_type       text        NOT NULL DEFAULT 'part'
                              CHECK (item_type IN ('part','labor','material','other')),
  description     text        NOT NULL,
  quantity        numeric(10,3) NOT NULL DEFAULT 1,
  unit_price      numeric(12,2) NOT NULL DEFAULT 0,
  total_price     numeric(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  product_id      uuid        REFERENCES products(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_orders_org    ON service_orders(org_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_service_orders_cust   ON service_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_service_orders_assign ON service_orders(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_service_order_items   ON service_order_items(order_id);

-- Order number generator
CREATE OR REPLACE FUNCTION generate_service_order_number(p_org_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  seq int;
BEGIN
  SELECT COUNT(*) + 1 INTO seq FROM service_orders WHERE org_id = p_org_id;
  RETURN 'OT-' || TO_CHAR(now(), 'YYYYMMDD') || '-' || LPAD(seq::text, 4, '0');
END;
$$;

-- Recalculate costs trigger
CREATE OR REPLACE FUNCTION recalculate_service_order_costs()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE service_orders
  SET parts_cost = (
    SELECT COALESCE(SUM(total_price), 0) FROM service_order_items
    WHERE order_id = NEW.order_id AND item_type != 'labor'
  ),
  labor_cost = (
    SELECT COALESCE(SUM(total_price), 0) FROM service_order_items
    WHERE order_id = NEW.order_id AND item_type = 'labor'
  ),
  updated_at = now()
  WHERE id = NEW.order_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_order_costs ON service_order_items;
CREATE TRIGGER trg_service_order_costs
  AFTER INSERT OR UPDATE OR DELETE ON service_order_items
  FOR EACH ROW EXECUTE FUNCTION recalculate_service_order_costs();

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_service_order_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_service_orders_updated ON service_orders;
CREATE TRIGGER trg_service_orders_updated
  BEFORE UPDATE ON service_orders
  FOR EACH ROW EXECUTE FUNCTION update_service_order_timestamp();

-- RLS
ALTER TABLE service_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_service_orders"      ON service_orders;
DROP POLICY IF EXISTS "org_service_order_items" ON service_order_items;

CREATE POLICY "org_service_orders" ON service_orders
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_service_order_items" ON service_order_items
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
