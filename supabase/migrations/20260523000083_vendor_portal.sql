-- Vendor Portal: supplier self-service, catalog, invoices, communications

CREATE TABLE IF NOT EXISTS vendor_portal_access (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id     uuid        NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  portal_token    text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  email           text        NOT NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  last_login      timestamptz,
  permissions     text[]      NOT NULL DEFAULT '{view_orders,submit_invoices,update_catalog}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS vendor_catalog_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id     uuid        NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  sku             text        NOT NULL,
  name            text        NOT NULL,
  description     text,
  category        text,
  unit_price      numeric(14,2) NOT NULL DEFAULT 0,
  currency        text        NOT NULL DEFAULT 'ARS',
  min_order_qty   int         NOT NULL DEFAULT 1,
  lead_time_days  int         NOT NULL DEFAULT 7,
  stock_available int         NOT NULL DEFAULT 0,
  is_active       boolean     NOT NULL DEFAULT true,
  images          text[]      NOT NULL DEFAULT '{}',
  specs           jsonb       NOT NULL DEFAULT '{}',
  last_updated    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, supplier_id, sku)
);

CREATE TABLE IF NOT EXISTS vendor_invoices (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id     uuid        NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  invoice_number  text        NOT NULL,
  invoice_date    date        NOT NULL,
  due_date        date,
  amount          numeric(18,2) NOT NULL,
  currency        text        NOT NULL DEFAULT 'ARS',
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid','disputed')),
  purchase_order_ref text,
  items           jsonb       NOT NULL DEFAULT '[]',
  notes           text,
  file_url        text,
  approved_by     uuid        REFERENCES auth.users(id),
  approved_at     timestamptz,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, supplier_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS vendor_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id     uuid        NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  sender_type     text        NOT NULL CHECK (sender_type IN ('org','supplier')),
  subject         text,
  body            text        NOT NULL,
  attachments     text[]      NOT NULL DEFAULT '{}',
  is_read         boolean     NOT NULL DEFAULT false,
  thread_id       uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Pending invoice amounts by supplier
CREATE OR REPLACE VIEW vendor_pending_summary AS
SELECT
  vi.org_id,
  vi.supplier_id,
  s.name AS supplier_name,
  COUNT(*) FILTER (WHERE vi.status = 'pending') AS pending_count,
  SUM(vi.amount) FILTER (WHERE vi.status = 'pending') AS pending_amount,
  SUM(vi.amount) FILTER (WHERE vi.status = 'approved') AS approved_amount,
  SUM(vi.amount) FILTER (WHERE vi.status = 'paid') AS paid_amount,
  MAX(vi.created_at) AS last_invoice
FROM vendor_invoices vi
JOIN suppliers s ON s.id = vi.supplier_id
GROUP BY vi.org_id, vi.supplier_id, s.name;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vendor_access_org      ON vendor_portal_access(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_vendor_catalog_sup     ON vendor_catalog_items(supplier_id, is_active);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_org    ON vendor_invoices(org_id, status, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_messages_org    ON vendor_messages(org_id, supplier_id, created_at DESC);

-- RLS
ALTER TABLE vendor_portal_access  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_catalog_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_invoices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_messages       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_vendor_access"    ON vendor_portal_access;
DROP POLICY IF EXISTS "org_vendor_catalog"   ON vendor_catalog_items;
DROP POLICY IF EXISTS "org_vendor_invoices"  ON vendor_invoices;
DROP POLICY IF EXISTS "org_vendor_messages"  ON vendor_messages;

CREATE POLICY "org_vendor_access"   ON vendor_portal_access  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_vendor_catalog"  ON vendor_catalog_items  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_vendor_invoices" ON vendor_invoices       USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_vendor_messages" ON vendor_messages       USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
