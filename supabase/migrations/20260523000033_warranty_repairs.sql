-- Warranty Claims & Repair Tracking

CREATE TABLE IF NOT EXISTS warranty_claims (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  claim_number    text        NOT NULL UNIQUE,
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   text        NOT NULL,
  customer_email  text,
  customer_phone  text,
  product_id      uuid        REFERENCES products(id) ON DELETE SET NULL,
  product_name    text        NOT NULL,
  serial_number   text,
  purchase_date   date,
  warranty_end    date,
  issue_type      text        NOT NULL DEFAULT 'defect'
                              CHECK (issue_type IN ('defect','damage','missing_part','not_working','other')),
  description     text        NOT NULL,
  status          text        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','in_diagnosis','in_repair','waiting_parts','ready','delivered','rejected','cancelled')),
  priority        text        NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to     text,
  estimated_ready date,
  actual_ready    date,
  resolution      text,
  cost_parts      numeric(12,2) NOT NULL DEFAULT 0,
  cost_labor      numeric(12,2) NOT NULL DEFAULT 0,
  cost_customer   numeric(12,2) NOT NULL DEFAULT 0,
  covered_by_warranty boolean NOT NULL DEFAULT true,
  attachments     text[]      NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warranty_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id        uuid        NOT NULL REFERENCES warranty_claims(id) ON DELETE CASCADE,
  status          text        NOT NULL,
  note            text        NOT NULL,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-generate claim number
CREATE OR REPLACE FUNCTION generate_claim_number(p_org_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n int;
BEGIN
  SELECT COUNT(*) + 1 INTO n FROM warranty_claims WHERE org_id = p_org_id;
  RETURN 'WCL-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
END;
$$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_warranty_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_warranty_updated ON warranty_claims;
CREATE TRIGGER trg_warranty_updated BEFORE UPDATE ON warranty_claims
  FOR EACH ROW EXECUTE FUNCTION update_warranty_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_warranty_org    ON warranty_claims(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warranty_cust   ON warranty_claims(customer_id);
CREATE INDEX IF NOT EXISTS idx_warranty_prod   ON warranty_claims(product_id);
CREATE INDEX IF NOT EXISTS idx_warranty_events ON warranty_events(claim_id, created_at DESC);

-- RLS
ALTER TABLE warranty_claims  ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_events  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_warranty" ON warranty_claims;
DROP POLICY IF EXISTS "org_wevents"  ON warranty_events;

CREATE POLICY "org_warranty" ON warranty_claims
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_wevents"  ON warranty_events
  USING (claim_id IN (
    SELECT id FROM warranty_claims
    WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  ));
