-- Competitor Intelligence: price monitoring, market positioning, SWOT

CREATE TABLE IF NOT EXISTS competitors (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  website         text,
  category        text        NOT NULL DEFAULT 'direct' CHECK (category IN ('direct','indirect','substitute','potential')),
  market_share_pct numeric(5,2),
  revenue_est     numeric(18,2),
  founded_year    int,
  employee_count  int,
  logo_url        text,
  tags            text[]      NOT NULL DEFAULT '{}',
  is_tracked      boolean     NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS competitor_products (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  competitor_id   uuid        NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  category        text,
  url             text,
  price           numeric(14,2),
  currency        text        NOT NULL DEFAULT 'ARS',
  last_checked    timestamptz NOT NULL DEFAULT now(),
  price_history   jsonb       NOT NULL DEFAULT '[]',  -- [{date, price}]
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_signals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competitor_id   uuid        REFERENCES competitors(id) ON DELETE CASCADE,
  signal_type     text        NOT NULL CHECK (signal_type IN ('price_change','new_product','promotion','news','review','social','funding','expansion')),
  title           text        NOT NULL,
  description     text,
  impact          text        NOT NULL DEFAULT 'medium' CHECK (impact IN ('high','medium','low')),
  sentiment       text        DEFAULT 'neutral' CHECK (sentiment IN ('positive','negative','neutral')),
  source_url      text,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  is_read         boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS swot_analysis (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competitor_id   uuid        REFERENCES competitors(id) ON DELETE CASCADE,
  quadrant        text        NOT NULL CHECK (quadrant IN ('strength','weakness','opportunity','threat')),
  item            text        NOT NULL,
  impact_score    int         NOT NULL DEFAULT 5 CHECK (impact_score BETWEEN 1 AND 10),
  evidence        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Price gap analysis between our products and competitors
CREATE OR REPLACE FUNCTION get_price_gap_analysis(p_org_id uuid)
RETURNS TABLE(
  competitor_name   text,
  our_avg_price     numeric,
  their_avg_price   numeric,
  price_gap_pct     numeric,
  positioning       text
) LANGUAGE sql STABLE AS $$
  SELECT
    c.name AS competitor_name,
    (SELECT AVG(p.price_ars) FROM products p WHERE p.org_id = p_org_id AND p.is_active = true) AS our_avg_price,
    AVG(cp.price) AS their_avg_price,
    CASE WHEN AVG(cp.price) = 0 THEN 0
    ELSE ROUND(
      ((SELECT AVG(p.price_ars) FROM products p WHERE p.org_id = p_org_id AND p.is_active = true) - AVG(cp.price)) /
      NULLIF(AVG(cp.price), 0) * 100, 2)
    END AS price_gap_pct,
    CASE
      WHEN (SELECT AVG(p.price_ars) FROM products p WHERE p.org_id = p_org_id AND p.is_active = true) > AVG(cp.price) * 1.1 THEN 'premium'
      WHEN (SELECT AVG(p.price_ars) FROM products p WHERE p.org_id = p_org_id AND p.is_active = true) < AVG(cp.price) * 0.9 THEN 'value'
      ELSE 'competitive'
    END AS positioning
  FROM competitors c
  JOIN competitor_products cp ON cp.competitor_id = c.id AND cp.is_active = true
  WHERE c.org_id = p_org_id AND c.is_tracked = true
  GROUP BY c.id, c.name;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_competitors_org       ON competitors(org_id, is_tracked);
CREATE INDEX IF NOT EXISTS idx_comp_products         ON competitor_products(competitor_id, last_checked DESC);
CREATE INDEX IF NOT EXISTS idx_market_signals_org    ON market_signals(org_id, detected_at DESC, is_read);
CREATE INDEX IF NOT EXISTS idx_swot_org              ON swot_analysis(org_id, competitor_id, quadrant);

-- RLS
ALTER TABLE competitors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_signals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE swot_analysis       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_competitors"         ON competitors;
DROP POLICY IF EXISTS "org_comp_products"       ON competitor_products;
DROP POLICY IF EXISTS "org_market_signals"      ON market_signals;
DROP POLICY IF EXISTS "org_swot"                ON swot_analysis;

CREATE POLICY "org_competitors"         ON competitors         USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_comp_products"       ON competitor_products USING (competitor_id IN (SELECT id FROM competitors WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
CREATE POLICY "org_market_signals"      ON market_signals      USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_swot"                ON swot_analysis       USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
