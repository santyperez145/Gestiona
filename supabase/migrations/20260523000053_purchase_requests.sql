-- Internal Purchase Requests (Solicitudes de Compra)

CREATE TABLE IF NOT EXISTS purchase_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_number  text        NOT NULL,
  title           text        NOT NULL,
  requested_by    text        NOT NULL,
  department      text,
  priority        text        NOT NULL DEFAULT 'normal'
                              CHECK (priority IN ('low','normal','high','urgent')),
  status          text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','submitted','approved','rejected','ordered','received','cancelled')),
  total_estimated numeric(14,2) NOT NULL DEFAULT 0,
  approved_by     text,
  approved_at     timestamptz,
  rejected_reason text,
  notes           text,
  needed_by       date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_request_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid        NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  product_id      uuid        REFERENCES products(id) ON DELETE SET NULL,
  product_name    text        NOT NULL,
  description     text,
  quantity        numeric(14,4) NOT NULL DEFAULT 1,
  unit            text        NOT NULL DEFAULT 'un',
  estimated_price numeric(14,2) NOT NULL DEFAULT 0,
  total_estimated numeric(14,2) GENERATED ALWAYS AS (quantity * estimated_price) STORED,
  preferred_supplier text,
  notes           text
);

-- Auto-generate request number
CREATE OR REPLACE FUNCTION generate_request_number(p_org_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) + 1 INTO v_count FROM purchase_requests WHERE org_id = p_org_id;
  RETURN 'SC-' || to_char(now(), 'YYYY') || '-' || lpad(v_count::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION set_request_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.request_number IS NULL OR NEW.request_number = '' THEN
    NEW.request_number := generate_request_number(NEW.org_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_request_number ON purchase_requests;
CREATE TRIGGER trg_request_number BEFORE INSERT ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION set_request_number();

-- Sync total_estimated from items
CREATE OR REPLACE FUNCTION sync_request_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE purchase_requests
  SET total_estimated = (
    SELECT COALESCE(SUM(total_estimated), 0) FROM purchase_request_items WHERE request_id = COALESCE(NEW.request_id, OLD.request_id)
  ),
  updated_at = now()
  WHERE id = COALESCE(NEW.request_id, OLD.request_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_req_total_ins ON purchase_request_items;
DROP TRIGGER IF EXISTS trg_sync_req_total_del ON purchase_request_items;
DROP TRIGGER IF EXISTS trg_sync_req_total_upd ON purchase_request_items;

CREATE TRIGGER trg_sync_req_total_ins AFTER INSERT ON purchase_request_items FOR EACH ROW EXECUTE FUNCTION sync_request_total();
CREATE TRIGGER trg_sync_req_total_del AFTER DELETE ON purchase_request_items FOR EACH ROW EXECUTE FUNCTION sync_request_total();
CREATE TRIGGER trg_sync_req_total_upd AFTER UPDATE ON purchase_request_items FOR EACH ROW EXECUTE FUNCTION sync_request_total();

CREATE OR REPLACE FUNCTION update_request_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_req_ts ON purchase_requests;
CREATE TRIGGER trg_req_ts BEFORE UPDATE ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION update_request_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_purchase_reqs_org    ON purchase_requests(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_req_items   ON purchase_request_items(request_id);

-- RLS
ALTER TABLE purchase_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_request_items  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_purchase_reqs"       ON purchase_requests;
DROP POLICY IF EXISTS "org_purchase_req_items"  ON purchase_request_items;

CREATE POLICY "org_purchase_reqs" ON purchase_requests
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_purchase_req_items" ON purchase_request_items
  USING (request_id IN (SELECT id FROM purchase_requests WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
