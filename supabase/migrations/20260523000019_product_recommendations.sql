-- AI Product Recommendations — co-occurrence & collaborative filtering

CREATE TABLE IF NOT EXISTS product_cooccurrences (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_a_id    uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_b_id    uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  cooccurrence_count int      NOT NULL DEFAULT 1,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, product_a_id, product_b_id),
  CHECK (product_a_id < product_b_id)   -- canonical order to avoid duplicates
);

CREATE TABLE IF NOT EXISTS recommendation_rules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  rule_type       text        NOT NULL DEFAULT 'cross_sell'
                              CHECK (rule_type IN ('cross_sell','upsell','bundle','new_arrivals','seasonal')),
  trigger_product_id uuid     REFERENCES products(id) ON DELETE CASCADE,
  recommended_product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  position        int         NOT NULL DEFAULT 0,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recommendation_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type      text        NOT NULL CHECK (event_type IN ('impression','click','purchase')),
  source          text        NOT NULL DEFAULT 'pos', -- pos | catalog | email
  trigger_product_id uuid     REFERENCES products(id) ON DELETE SET NULL,
  recommended_product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cooccurrences_org    ON product_cooccurrences(org_id, product_a_id, cooccurrence_count DESC);
CREATE INDEX IF NOT EXISTS idx_rec_rules_org        ON recommendation_rules(org_id, rule_type, active);
CREATE INDEX IF NOT EXISTS idx_rec_events_org       ON recommendation_events(org_id, event_type, created_at DESC);

-- Rebuild co-occurrences from sale_items (call this periodically or on demand)
CREATE OR REPLACE FUNCTION rebuild_cooccurrences(p_org_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM product_cooccurrences WHERE org_id = p_org_id;

  INSERT INTO product_cooccurrences(org_id, product_a_id, product_b_id, cooccurrence_count, last_seen_at)
  SELECT
    p_org_id,
    LEAST(a.product_id, b.product_id),
    GREATEST(a.product_id, b.product_id),
    COUNT(*),
    MAX(s.created_at)
  FROM sale_items a
  JOIN sale_items b ON a.sale_id = b.sale_id AND a.product_id != b.product_id
  JOIN sales s ON s.id = a.sale_id
  WHERE s.org_id = p_org_id
    AND a.product_id IS NOT NULL
    AND b.product_id IS NOT NULL
    AND LEAST(a.product_id, b.product_id) < GREATEST(a.product_id, b.product_id)
  GROUP BY LEAST(a.product_id, b.product_id), GREATEST(a.product_id, b.product_id)
  ON CONFLICT (org_id, product_a_id, product_b_id)
  DO UPDATE SET
    cooccurrence_count = EXCLUDED.cooccurrence_count,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = now();
END;
$$;

-- Get top N recommendations for a product
CREATE OR REPLACE FUNCTION get_product_recommendations(p_org_id uuid, p_product_id uuid, p_limit int DEFAULT 5)
RETURNS TABLE(recommended_product_id uuid, score int) LANGUAGE sql STABLE AS $$
  SELECT
    CASE WHEN product_a_id = p_product_id THEN product_b_id ELSE product_a_id END,
    cooccurrence_count
  FROM product_cooccurrences
  WHERE org_id = p_org_id
    AND (product_a_id = p_product_id OR product_b_id = p_product_id)
  ORDER BY cooccurrence_count DESC
  LIMIT p_limit;
$$;

-- RLS
ALTER TABLE product_cooccurrences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_rules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_events  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_cooccurrences" ON product_cooccurrences;
DROP POLICY IF EXISTS "org_rec_rules"     ON recommendation_rules;
DROP POLICY IF EXISTS "org_rec_events"    ON recommendation_events;

CREATE POLICY "org_cooccurrences" ON product_cooccurrences
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_rec_rules" ON recommendation_rules
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_rec_events" ON recommendation_events
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
