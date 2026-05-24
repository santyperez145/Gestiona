-- Affiliate & Referral Partner Program

CREATE TABLE IF NOT EXISTS affiliate_partners (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  email           text        NOT NULL,
  phone           text,
  company         text,
  code            text        NOT NULL,          -- unique referral code
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','active','suspended','inactive')),
  commission_type text        NOT NULL DEFAULT 'percentage'
                              CHECK (commission_type IN ('percentage','fixed','tiered')),
  commission_rate numeric(8,4) NOT NULL DEFAULT 10,  -- % or fixed amount
  payout_threshold numeric(12,2) NOT NULL DEFAULT 1000,
  total_referrals int         NOT NULL DEFAULT 0,
  total_revenue   numeric(14,2) NOT NULL DEFAULT 0,
  total_commission numeric(14,2) NOT NULL DEFAULT 0,
  pending_payout  numeric(14,2) NOT NULL DEFAULT 0,
  notes           text,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS affiliate_conversions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      uuid        NOT NULL REFERENCES affiliate_partners(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sale_id         uuid        REFERENCES sales(id) ON DELETE SET NULL,
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   text,
  sale_amount     numeric(12,2) NOT NULL DEFAULT 0,
  commission_amount numeric(12,2) NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','paid','rejected')),
  approved_at     timestamptz,
  paid_at         timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id      uuid        NOT NULL REFERENCES affiliate_partners(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  amount          numeric(12,2) NOT NULL,
  currency        text        NOT NULL DEFAULT 'ARS',
  payment_method  text,
  reference       text,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','processed','failed')),
  processed_at    timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_affiliates_org    ON affiliate_partners(org_id, status);
CREATE INDEX IF NOT EXISTS idx_aff_code          ON affiliate_partners(org_id, code);
CREATE INDEX IF NOT EXISTS idx_aff_conversions   ON affiliate_conversions(partner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aff_payouts       ON affiliate_payouts(partner_id, status);

-- Update partner stats on conversion change
CREATE OR REPLACE FUNCTION update_affiliate_stats()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE affiliate_partners
  SET
    total_referrals = (SELECT COUNT(*) FROM affiliate_conversions WHERE partner_id = COALESCE(NEW.partner_id, OLD.partner_id) AND status != 'rejected'),
    total_revenue   = COALESCE((SELECT SUM(sale_amount) FROM affiliate_conversions WHERE partner_id = COALESCE(NEW.partner_id, OLD.partner_id) AND status IN ('approved','paid')), 0),
    total_commission= COALESCE((SELECT SUM(commission_amount) FROM affiliate_conversions WHERE partner_id = COALESCE(NEW.partner_id, OLD.partner_id) AND status IN ('approved','paid')), 0),
    pending_payout  = COALESCE((SELECT SUM(commission_amount) FROM affiliate_conversions WHERE partner_id = COALESCE(NEW.partner_id, OLD.partner_id) AND status = 'approved'), 0),
    updated_at = now()
  WHERE id = COALESCE(NEW.partner_id, OLD.partner_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_affiliate_stats ON affiliate_conversions;
CREATE TRIGGER trg_affiliate_stats
  AFTER INSERT OR UPDATE OR DELETE ON affiliate_conversions
  FOR EACH ROW EXECUTE FUNCTION update_affiliate_stats();

-- updated_at
CREATE OR REPLACE FUNCTION update_affiliate_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_aff_updated ON affiliate_partners;
CREATE TRIGGER trg_aff_updated BEFORE UPDATE ON affiliate_partners FOR EACH ROW EXECUTE FUNCTION update_affiliate_timestamp();

-- RLS
ALTER TABLE affiliate_partners   ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_payouts    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_affiliates"          ON affiliate_partners;
DROP POLICY IF EXISTS "org_aff_conversions"     ON affiliate_conversions;
DROP POLICY IF EXISTS "org_aff_payouts"         ON affiliate_payouts;

CREATE POLICY "org_affiliates"       ON affiliate_partners   USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_aff_conversions"  ON affiliate_conversions USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_aff_payouts"      ON affiliate_payouts     USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
