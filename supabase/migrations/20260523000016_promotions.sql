-- Promotions / Flash Sales Manager

CREATE TABLE IF NOT EXISTS promotions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  type            text        NOT NULL DEFAULT 'percentage'
                              CHECK (type IN ('percentage','fixed','buy_x_get_y','free_shipping','bundle_price')),
  status          text        NOT NULL DEFAULT 'scheduled'
                              CHECK (status IN ('scheduled','active','paused','ended','cancelled')),
  discount_value  numeric(10,4) NOT NULL DEFAULT 0,  -- % or ARS amount
  min_order_value numeric(12,2) NOT NULL DEFAULT 0,   -- minimum order to qualify
  max_uses        int,                                 -- null = unlimited
  uses_count      int         NOT NULL DEFAULT 0,
  uses_per_customer int       NOT NULL DEFAULT 0,     -- 0 = unlimited
  applies_to      text        NOT NULL DEFAULT 'all'
                              CHECK (applies_to IN ('all','products','categories','customers')),
  product_ids     uuid[],     -- if applies_to = 'products'
  category_names  text[],     -- if applies_to = 'categories'
  coupon_code     text,       -- optional coupon code (NULL = auto-apply)
  starts_at       timestamptz NOT NULL DEFAULT now(),
  ends_at         timestamptz,
  banner_text     text,       -- text for storefront banner
  banner_color    text        NOT NULL DEFAULT '#e11d48',
  show_countdown  boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promotion_usages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id    uuid        NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   text,
  order_value     numeric(12,2) NOT NULL DEFAULT 0,
  discount_applied numeric(12,2) NOT NULL DEFAULT 0,
  used_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotions_org    ON promotions(org_id, status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_promotions_code   ON promotions(org_id, coupon_code) WHERE coupon_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotion_usages  ON promotion_usages(promotion_id, used_at);

-- Active promotions view (currently running)
CREATE OR REPLACE VIEW active_promotions AS
SELECT * FROM promotions
WHERE status = 'active'
  AND starts_at <= now()
  AND (ends_at IS NULL OR ends_at > now());

-- Auto-activate scheduled promotions
CREATE OR REPLACE FUNCTION activate_scheduled_promotions()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE cnt int;
BEGIN
  UPDATE promotions SET status = 'active', updated_at = now()
  WHERE status = 'scheduled' AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now());
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN cnt;
END;
$$;

-- Auto-end expired promotions
CREATE OR REPLACE FUNCTION end_expired_promotions()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE cnt int;
BEGIN
  UPDATE promotions SET status = 'ended', updated_at = now()
  WHERE status IN ('active','scheduled') AND ends_at IS NOT NULL AND ends_at <= now();
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN cnt;
END;
$$;

-- Increment usage count
CREATE OR REPLACE FUNCTION increment_promotion_usage()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE promotions SET uses_count = uses_count + 1, updated_at = now()
  WHERE id = NEW.promotion_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promotion_usage ON promotion_usages;
CREATE TRIGGER trg_promotion_usage
  AFTER INSERT ON promotion_usages
  FOR EACH ROW EXECUTE FUNCTION increment_promotion_usage();

-- updated_at
CREATE OR REPLACE FUNCTION update_promotion_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_promotions_updated ON promotions;
CREATE TRIGGER trg_promotions_updated
  BEFORE UPDATE ON promotions
  FOR EACH ROW EXECUTE FUNCTION update_promotion_timestamp();

-- RLS
ALTER TABLE promotions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_usages  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_promotions"       ON promotions;
DROP POLICY IF EXISTS "org_promo_usages"     ON promotion_usages;

CREATE POLICY "org_promotions" ON promotions
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_promo_usages" ON promotion_usages
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
