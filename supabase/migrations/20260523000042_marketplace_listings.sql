-- Marketplace Channel Listings (MercadoLibre, Tiendanube, WooCommerce, etc.)

CREATE TABLE IF NOT EXISTS marketplace_channels (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel         text        NOT NULL
                              CHECK (channel IN ('mercadolibre','tiendanube','woocommerce','shopify','instagram_shop','facebook_shop','amazon','otro')),
  store_name      text        NOT NULL,
  store_url       text,
  api_key         text,         -- stored encrypted in practice; here as text for schema
  access_token    text,
  refresh_token   text,
  is_active       boolean     NOT NULL DEFAULT true,
  last_synced_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_id      uuid        NOT NULL REFERENCES marketplace_channels(id) ON DELETE CASCADE,
  product_id      uuid        REFERENCES products(id) ON DELETE SET NULL,
  external_id     text,         -- ID on the marketplace (e.g. MLA123456)
  title           text        NOT NULL,
  description     text,
  price           numeric(14,2) NOT NULL DEFAULT 0,
  original_price  numeric(14,2),
  currency        text        NOT NULL DEFAULT 'ARS',
  stock           int         NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','paused','closed','pending','deleted')),
  listing_url     text,
  thumbnail_url   text,
  condition       text        NOT NULL DEFAULT 'new'
                              CHECK (condition IN ('new','used','refurbished')),
  -- Fees
  commission_pct  numeric(6,4) NOT NULL DEFAULT 0,
  shipping_cost   numeric(14,2),
  -- Metrics
  views           int         NOT NULL DEFAULT 0,
  sales_count     int         NOT NULL DEFAULT 0,
  revenue         numeric(14,2) NOT NULL DEFAULT 0,
  last_synced_at  timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_orders (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_id      uuid        NOT NULL REFERENCES marketplace_channels(id) ON DELETE CASCADE,
  listing_id      uuid        REFERENCES marketplace_listings(id) ON DELETE SET NULL,
  external_order_id text,
  buyer_name      text,
  buyer_email     text,
  quantity        int         NOT NULL DEFAULT 1,
  unit_price      numeric(14,2) NOT NULL,
  total_amount    numeric(14,2) NOT NULL,
  commission      numeric(14,2) NOT NULL DEFAULT 0,
  net_amount      numeric(14,2) NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','paid','shipped','delivered','cancelled','refunded')),
  shipping_status text,
  tracking_code   text,
  order_date      timestamptz NOT NULL DEFAULT now(),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- updated_at
CREATE OR REPLACE FUNCTION update_marketplace_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_ml_listing_ts ON marketplace_listings;
CREATE TRIGGER trg_ml_listing_ts BEFORE UPDATE ON marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION update_marketplace_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ml_channels_org     ON marketplace_channels(org_id);
CREATE INDEX IF NOT EXISTS idx_ml_listings_org     ON marketplace_listings(org_id, status);
CREATE INDEX IF NOT EXISTS idx_ml_listings_channel ON marketplace_listings(channel_id);
CREATE INDEX IF NOT EXISTS idx_ml_listings_product ON marketplace_listings(product_id);
CREATE INDEX IF NOT EXISTS idx_ml_orders_org       ON marketplace_orders(org_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_ml_orders_channel   ON marketplace_orders(channel_id, order_date DESC);

-- RLS
ALTER TABLE marketplace_channels  ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_listings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_orders     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_ml_channels"  ON marketplace_channels;
DROP POLICY IF EXISTS "org_ml_listings"  ON marketplace_listings;
DROP POLICY IF EXISTS "org_ml_orders"    ON marketplace_orders;

CREATE POLICY "org_ml_channels" ON marketplace_channels
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ml_listings" ON marketplace_listings
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ml_orders" ON marketplace_orders
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
