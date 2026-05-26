-- Competitor Price Intelligence

CREATE TABLE IF NOT EXISTS competitors (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  website         text,
  notes           text,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS competitor_products (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competitor_id   uuid        NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  our_product_id  uuid        REFERENCES products(id) ON DELETE SET NULL,
  competitor_sku  text,
  competitor_name text        NOT NULL,
  url             text,
  image_url       text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS competitor_prices (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competitor_product_id uuid      NOT NULL REFERENCES competitor_products(id) ON DELETE CASCADE,
  price               numeric(14,2) NOT NULL,
  currency            text        NOT NULL DEFAULT 'ARS',
  in_stock            boolean     NOT NULL DEFAULT true,
  promotion           text,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  recorded_by         uuid        REFERENCES auth.users(id),
  source              text        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','scraper','api','import'))
);

CREATE TABLE IF NOT EXISTS pricing_alerts (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competitor_product_id uuid        REFERENCES competitor_products(id) ON DELETE CASCADE,
  our_product_id        uuid        REFERENCES products(id) ON DELETE CASCADE,
  alert_type            text        NOT NULL CHECK (alert_type IN ('price_drop','price_increase','undercut','parity','out_of_stock')),
  threshold_pct         numeric(6,2),  -- % difference that triggers the alert
  is_active             boolean     NOT NULL DEFAULT true,
  last_triggered        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- View: latest price per competitor product + comparison with our price
CREATE OR REPLACE VIEW competitor_price_comparison AS
SELECT
  cp.id                    AS competitor_product_id,
  cp.org_id,
  cp.competitor_id,
  c.name                   AS competitor_name,
  cp.our_product_id,
  p.name                   AS our_product_name,
  p.price                  AS our_price,
  cp.competitor_name       AS their_product_name,
  cp.url,
  latest.price             AS their_price,
  latest.in_stock          AS their_in_stock,
  latest.promotion         AS their_promotion,
  latest.recorded_at,
  CASE
    WHEN p.price IS NULL OR latest.price IS NULL THEN NULL
    ELSE ROUND(((latest.price - p.price) / NULLIF(p.price, 0)) * 100, 2)
  END AS price_diff_pct,   -- positive = competitor is more expensive
  CASE
    WHEN p.price IS NULL OR latest.price IS NULL THEN 'unknown'
    WHEN latest.price < p.price THEN 'undercut'
    WHEN latest.price > p.price THEN 'above'
    ELSE 'parity'
  END AS position
FROM competitor_products cp
JOIN competitors c ON c.id = cp.competitor_id
LEFT JOIN products p ON p.id = cp.our_product_id
LEFT JOIN LATERAL (
  SELECT price, in_stock, promotion, recorded_at
  FROM competitor_prices
  WHERE competitor_product_id = cp.id
  ORDER BY recorded_at DESC
  LIMIT 1
) latest ON TRUE;

-- Function: price trend for a competitor product (last N records)
CREATE OR REPLACE FUNCTION get_price_trend(
  p_competitor_product_id uuid,
  p_limit int DEFAULT 30
)
RETURNS TABLE(recorded_at timestamptz, price numeric, in_stock boolean)
LANGUAGE sql STABLE AS $$
  SELECT recorded_at, price, in_stock
  FROM competitor_prices
  WHERE competitor_product_id = p_competitor_product_id
  ORDER BY recorded_at DESC
  LIMIT p_limit;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_competitors_org         ON competitors(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_comp_products_org       ON competitor_products(org_id, competitor_id);
CREATE INDEX IF NOT EXISTS idx_comp_products_ours      ON competitor_products(our_product_id);
CREATE INDEX IF NOT EXISTS idx_comp_prices_product     ON competitor_prices(competitor_product_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_alerts_org      ON pricing_alerts(org_id, is_active);

-- RLS
ALTER TABLE competitors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_prices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_alerts      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_competitors"         ON competitors;
DROP POLICY IF EXISTS "org_competitor_products" ON competitor_products;
DROP POLICY IF EXISTS "org_competitor_prices"   ON competitor_prices;
DROP POLICY IF EXISTS "org_pricing_alerts"      ON pricing_alerts;

CREATE POLICY "org_competitors"         ON competitors         USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_competitor_products" ON competitor_products USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_competitor_prices"   ON competitor_prices   USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_pricing_alerts"      ON pricing_alerts      USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
