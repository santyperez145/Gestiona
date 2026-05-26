-- Currency Exchange Rate Tracker (ARS/USD/EUR/BRL)

CREATE TABLE IF NOT EXISTS exchange_rates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date            date        NOT NULL,
  base_currency   text        NOT NULL DEFAULT 'USD',
  usd_ars         numeric(12,4) NOT NULL DEFAULT 0,  -- USD → ARS
  eur_ars         numeric(12,4) NOT NULL DEFAULT 0,
  brl_ars         numeric(12,4) NOT NULL DEFAULT 0,
  source          text        NOT NULL DEFAULT 'manual'
                              CHECK (source IN ('manual','api','bcra','dolar_blue')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, date, base_currency, source)
);

CREATE TABLE IF NOT EXISTS currency_price_updates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  rate_before     numeric(12,4) NOT NULL,
  rate_after      numeric(12,4) NOT NULL,
  pct_change      numeric(8,4) GENERATED ALWAYS AS (
    CASE WHEN rate_before > 0
    THEN ROUND(((rate_after - rate_before) / rate_before) * 100, 4)
    ELSE 0 END
  ) STORED,
  products_updated int        NOT NULL DEFAULT 0,
  margin_type     text        NOT NULL DEFAULT 'fixed_pct'
                              CHECK (margin_type IN ('fixed_pct','keep_margin','custom')),
  margin_value    numeric(8,4) NOT NULL DEFAULT 0,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  applied_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rates_org  ON exchange_rates(org_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_cpu_org    ON currency_price_updates(org_id, applied_at DESC);

-- RLS
ALTER TABLE exchange_rates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE currency_price_updates  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_rates" ON exchange_rates;
DROP POLICY IF EXISTS "org_cpu"   ON currency_price_updates;

CREATE POLICY "org_rates" ON exchange_rates
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_cpu" ON currency_price_updates
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
