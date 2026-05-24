-- Supplier RFQ (Request for Quotation) System

CREATE TABLE IF NOT EXISTS rfq_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rfq_number      text        NOT NULL,
  supplier_id     uuid        REFERENCES proveedores(id) ON DELETE SET NULL,
  supplier_name   text        NOT NULL,
  supplier_email  text,
  title           text        NOT NULL,
  description     text,
  due_date        date,
  status          text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','sent','responded','accepted','rejected','expired')),
  currency        text        NOT NULL DEFAULT 'ARS',
  shipping_terms  text,
  payment_terms   text,
  delivery_days   int,
  notes           text,
  responded_at    timestamptz,
  accepted_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rfq_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id          uuid        NOT NULL REFERENCES rfq_requests(id) ON DELETE CASCADE,
  product_id      uuid        REFERENCES products(id) ON DELETE SET NULL,
  description     text        NOT NULL,
  quantity        numeric(12,3) NOT NULL DEFAULT 1,
  unit            text        NOT NULL DEFAULT 'unidad',
  quoted_price    numeric(14,4),
  min_order_qty   numeric(12,3),
  lead_time_days  int,
  notes           text
);

CREATE TABLE IF NOT EXISTS rfq_comparisons (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           text        NOT NULL,
  rfq_ids         uuid[]      NOT NULL DEFAULT '{}',
  winner_rfq_id   uuid        REFERENCES rfq_requests(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-generate RFQ number
CREATE OR REPLACE FUNCTION generate_rfq_number(p_org_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n int;
BEGIN
  SELECT COUNT(*) + 1 INTO n FROM rfq_requests WHERE org_id = p_org_id;
  RETURN 'RFQ-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
END;
$$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_rfq_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_rfq_updated ON rfq_requests;
CREATE TRIGGER trg_rfq_updated BEFORE UPDATE ON rfq_requests
  FOR EACH ROW EXECUTE FUNCTION update_rfq_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rfq_org     ON rfq_requests(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfq_supp    ON rfq_requests(supplier_id);
CREATE INDEX IF NOT EXISTS idx_rfq_items   ON rfq_items(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_comp    ON rfq_comparisons(org_id);

-- RLS
ALTER TABLE rfq_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_comparisons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_rfq"      ON rfq_requests;
DROP POLICY IF EXISTS "org_rfq_items" ON rfq_items;
DROP POLICY IF EXISTS "org_rfq_comp" ON rfq_comparisons;

CREATE POLICY "org_rfq" ON rfq_requests
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_rfq_items" ON rfq_items
  USING (rfq_id IN (
    SELECT id FROM rfq_requests
    WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  ));
CREATE POLICY "org_rfq_comp" ON rfq_comparisons
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
