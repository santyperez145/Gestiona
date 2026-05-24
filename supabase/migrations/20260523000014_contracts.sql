-- Contract Management — Salesforce CPQ equivalent

CREATE TABLE IF NOT EXISTS contracts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_number text        NOT NULL,
  title           text        NOT NULL,
  description     text,
  status          text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','active','expired','cancelled','renewed')),
  type            text        NOT NULL DEFAULT 'customer'
                              CHECK (type IN ('customer','supplier','partner','employee','nda','other')),
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   text,
  customer_email  text,
  deal_id         uuid,       -- optional link to pipeline deal
  value           numeric(15,2) NOT NULL DEFAULT 0,
  currency        text        NOT NULL DEFAULT 'ARS',
  start_date      date,
  end_date        date,
  auto_renewal    boolean     NOT NULL DEFAULT false,
  renewal_days    int         NOT NULL DEFAULT 30, -- days before expiry to alert
  terms           text,       -- contract terms text
  document_url    text,       -- link to external document
  signed_at       timestamptz,
  signer_name     text,
  signed_ip       text,
  tags            text[],
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_org     ON contracts(org_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_dates   ON contracts(org_id, end_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_contracts_cust    ON contracts(customer_id);

-- View: contracts expiring in next 30 days
CREATE OR REPLACE VIEW contracts_expiring_soon AS
SELECT c.*,
  (c.end_date - CURRENT_DATE) AS days_until_expiry
FROM contracts c
WHERE c.status = 'active'
  AND c.end_date IS NOT NULL
  AND c.end_date >= CURRENT_DATE
  AND (c.end_date - CURRENT_DATE) <= c.renewal_days
ORDER BY c.end_date;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_contract_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_contracts_updated ON contracts;
CREATE TRIGGER trg_contracts_updated
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION update_contract_timestamp();

-- Auto-expire contracts whose end_date has passed (called by cron)
CREATE OR REPLACE FUNCTION expire_overdue_contracts()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE expired_count int;
BEGIN
  UPDATE contracts SET status = 'expired'
  WHERE status = 'active' AND end_date < CURRENT_DATE AND auto_renewal = false;
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;

-- RLS
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_contracts" ON contracts;
CREATE POLICY "org_contracts" ON contracts
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
