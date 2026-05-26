-- Rental / Asset Management

CREATE TABLE IF NOT EXISTS rental_assets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  category        text        NOT NULL DEFAULT 'equipo',
  serial_number   text,
  condition       text        NOT NULL DEFAULT 'excellent'
                              CHECK (condition IN ('excellent','good','fair','poor')),
  daily_rate      numeric(14,2) NOT NULL DEFAULT 0,
  hourly_rate     numeric(14,2),
  weekly_rate     numeric(14,2),
  monthly_rate    numeric(14,2),
  deposit_amount  numeric(14,2) NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'available'
                              CHECK (status IN ('available','rented','maintenance','retired')),
  location        text,
  image_url       text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rental_contracts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_number text        NOT NULL,
  asset_id        uuid        NOT NULL REFERENCES rental_assets(id) ON DELETE CASCADE,
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   text        NOT NULL,
  customer_phone  text,
  customer_dni    text,
  start_date      timestamptz NOT NULL,
  end_date        timestamptz NOT NULL,
  returned_at     timestamptz,
  rate_type       text        NOT NULL DEFAULT 'daily'
                              CHECK (rate_type IN ('hourly','daily','weekly','monthly')),
  rate_amount     numeric(14,2) NOT NULL,
  total_amount    numeric(14,2) NOT NULL DEFAULT 0,
  deposit_paid    numeric(14,2) NOT NULL DEFAULT 0,
  deposit_returned numeric(14,2),
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('pending','active','returned','overdue','cancelled')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rental_payments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contract_id     uuid        NOT NULL REFERENCES rental_contracts(id) ON DELETE CASCADE,
  amount          numeric(14,2) NOT NULL,
  payment_method  text        NOT NULL DEFAULT 'cash',
  payment_date    date        NOT NULL DEFAULT CURRENT_DATE,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-generate contract number
CREATE OR REPLACE FUNCTION generate_rental_number(p_org_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_year  text := to_char(now(), 'YYYY');
  v_count int;
BEGIN
  SELECT COUNT(*) + 1 INTO v_count
  FROM rental_contracts WHERE org_id = p_org_id;
  RETURN 'RNT-' || v_year || '-' || lpad(v_count::text, 4, '0');
END;
$$;

-- Auto-set contract number + mark asset as rented
CREATE OR REPLACE FUNCTION set_rental_contract()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.contract_number := generate_rental_number(NEW.org_id);
  UPDATE rental_assets SET status = 'rented', updated_at = now() WHERE id = NEW.asset_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_contract ON rental_contracts;
CREATE TRIGGER trg_rental_contract BEFORE INSERT ON rental_contracts
  FOR EACH ROW EXECUTE FUNCTION set_rental_contract();

-- On return, free the asset
CREATE OR REPLACE FUNCTION on_rental_returned()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'returned' AND OLD.status != 'returned' THEN
    NEW.returned_at := COALESCE(NEW.returned_at, now());
    UPDATE rental_assets SET status = 'available', updated_at = now() WHERE id = NEW.asset_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rental_return ON rental_contracts;
CREATE TRIGGER trg_rental_return BEFORE UPDATE ON rental_contracts
  FOR EACH ROW EXECUTE FUNCTION on_rental_returned();

-- updated_at
CREATE OR REPLACE FUNCTION update_rental_asset_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_rental_asset_ts ON rental_assets;
CREATE TRIGGER trg_rental_asset_ts BEFORE UPDATE ON rental_assets
  FOR EACH ROW EXECUTE FUNCTION update_rental_asset_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rental_assets_org    ON rental_assets(org_id, status);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_org ON rental_contracts(org_id, status, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_ast ON rental_contracts(asset_id, status);
CREATE INDEX IF NOT EXISTS idx_rental_payments_con  ON rental_payments(contract_id, payment_date DESC);

-- RLS
ALTER TABLE rental_assets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_contracts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_payments    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_rental_assets"    ON rental_assets;
DROP POLICY IF EXISTS "org_rental_contracts" ON rental_contracts;
DROP POLICY IF EXISTS "org_rental_payments"  ON rental_payments;

CREATE POLICY "org_rental_assets" ON rental_assets
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_rental_contracts" ON rental_contracts
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_rental_payments" ON rental_payments
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
