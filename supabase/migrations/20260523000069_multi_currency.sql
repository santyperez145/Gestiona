-- Multi-Currency & FX Management

CREATE TABLE IF NOT EXISTS currencies (
  code            text        PRIMARY KEY,   -- ISO 4217: ARS, USD, EUR, BRL
  name            text        NOT NULL,
  symbol          text        NOT NULL,
  decimal_places  int         NOT NULL DEFAULT 2,
  is_active       boolean     NOT NULL DEFAULT true
);

-- Seed common currencies
INSERT INTO currencies (code, name, symbol, decimal_places) VALUES
  ('ARS', 'Peso Argentino',   '$',  2),
  ('USD', 'Dólar Estadounidense', 'US$', 2),
  ('EUR', 'Euro',             '€',  2),
  ('BRL', 'Real Brasileño',   'R$', 2),
  ('UYU', 'Peso Uruguayo',    '$U', 2),
  ('CLP', 'Peso Chileno',     '$',  0),
  ('COP', 'Peso Colombiano',  '$',  0)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS exchange_rates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = global rate
  currency_from   text        NOT NULL REFERENCES currencies(code),
  currency_to     text        NOT NULL REFERENCES currencies(code),
  rate            numeric(18,6) NOT NULL CHECK (rate > 0),
  rate_type       text        NOT NULL DEFAULT 'oficial' CHECK (rate_type IN ('oficial','blue','mep','ccl','custom')),
  source          text        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','bcra','bluelytics','custom')),
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (org_id, currency_from, currency_to, rate_type, valid_from)
);

CREATE TABLE IF NOT EXISTS org_currencies (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  currency_code   text        NOT NULL REFERENCES currencies(code),
  is_default      boolean     NOT NULL DEFAULT false,
  display_order   int         NOT NULL DEFAULT 0,
  UNIQUE (org_id, currency_code)
);

CREATE TABLE IF NOT EXISTS multi_currency_transactions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type     text        NOT NULL CHECK (entity_type IN ('sale','purchase','expense','invoice','transfer')),
  entity_id       uuid,
  base_currency   text        NOT NULL REFERENCES currencies(code),
  transaction_currency text   NOT NULL REFERENCES currencies(code),
  base_amount     numeric(18,2) NOT NULL,
  transaction_amount numeric(18,2) NOT NULL,
  exchange_rate   numeric(18,6) NOT NULL,
  rate_type       text        NOT NULL DEFAULT 'oficial',
  rate_date       date        NOT NULL DEFAULT CURRENT_DATE,
  fx_gain_loss    numeric(18,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fx_exposure (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_date   date        NOT NULL DEFAULT CURRENT_DATE,
  currency_code   text        NOT NULL REFERENCES currencies(code),
  receivables_fc  numeric(18,2) NOT NULL DEFAULT 0,  -- foreign currency receivables
  payables_fc     numeric(18,2) NOT NULL DEFAULT 0,
  net_exposure_fc numeric(18,2) GENERATED ALWAYS AS (receivables_fc - payables_fc) STORED,
  spot_rate       numeric(18,6) NOT NULL DEFAULT 1,
  net_exposure_bc numeric(18,2) GENERATED ALWAYS AS (
    ROUND((receivables_fc - payables_fc) * spot_rate, 2)
  ) STORED,
  UNIQUE (org_id, snapshot_date, currency_code)
);

-- Convert amount between currencies using latest rate
CREATE OR REPLACE FUNCTION convert_amount(
  p_amount        numeric,
  p_from          text,
  p_to            text,
  p_org_id        uuid DEFAULT NULL,
  p_rate_type     text DEFAULT 'oficial'
) RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_rate numeric;
BEGIN
  IF p_from = p_to THEN RETURN p_amount; END IF;

  SELECT rate INTO v_rate
  FROM exchange_rates
  WHERE currency_from = p_from
    AND currency_to   = p_to
    AND rate_type     = p_rate_type
    AND (org_id = p_org_id OR org_id IS NULL)
    AND (valid_to IS NULL OR valid_to > now())
  ORDER BY (org_id IS NOT NULL) DESC, valid_from DESC
  LIMIT 1;

  IF v_rate IS NULL THEN
    -- Try inverse
    SELECT 1.0 / rate INTO v_rate
    FROM exchange_rates
    WHERE currency_from = p_to
      AND currency_to   = p_from
      AND rate_type     = p_rate_type
      AND (org_id = p_org_id OR org_id IS NULL)
      AND (valid_to IS NULL OR valid_to > now())
    ORDER BY (org_id IS NOT NULL) DESC, valid_from DESC
    LIMIT 1;
  END IF;

  RETURN ROUND(p_amount * COALESCE(v_rate, 1), 2);
END;
$$;

-- Get rate history for sparkline
CREATE OR REPLACE FUNCTION get_rate_history(
  p_from text, p_to text, p_rate_type text DEFAULT 'oficial', p_days int DEFAULT 30
) RETURNS TABLE(day date, rate numeric) LANGUAGE sql STABLE AS $$
  SELECT DATE(valid_from) AS day, rate
  FROM exchange_rates
  WHERE currency_from = p_from
    AND currency_to   = p_to
    AND rate_type     = p_rate_type
    AND valid_from >= now() - (p_days || ' days')::interval
  ORDER BY valid_from DESC;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup ON exchange_rates(currency_from, currency_to, rate_type, valid_from DESC);
CREATE INDEX IF NOT EXISTS idx_fx_exposure_org       ON fx_exposure(org_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_mct_org_entity        ON multi_currency_transactions(org_id, entity_type, created_at DESC);

-- RLS
ALTER TABLE exchange_rates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_currencies              ENABLE ROW LEVEL SECURITY;
ALTER TABLE multi_currency_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_exposure                 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_exchange_rates" ON exchange_rates;
DROP POLICY IF EXISTS "org_currencies_cfg" ON org_currencies;
DROP POLICY IF EXISTS "org_mct"            ON multi_currency_transactions;
DROP POLICY IF EXISTS "org_fx_exposure"    ON fx_exposure;

CREATE POLICY "org_exchange_rates" ON exchange_rates              USING (org_id IS NULL OR org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_currencies_cfg" ON org_currencies              USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_mct"            ON multi_currency_transactions USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_fx_exposure"    ON fx_exposure                 USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
