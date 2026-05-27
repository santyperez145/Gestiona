-- E-commerce Store: online shop management, cart sessions, order funnel

CREATE TABLE IF NOT EXISTS ecommerce_stores (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL DEFAULT 'Mi Tienda',
  slug            text        NOT NULL,
  domain          text,
  custom_domain   text,
  theme           text        NOT NULL DEFAULT 'minimal' CHECK (theme IN ('minimal','bold','luxury','sport','natural')),
  primary_color   text        NOT NULL DEFAULT '#f59e0b',
  logo_url        text,
  banner_url      text,
  description     text,
  currency        text        NOT NULL DEFAULT 'ARS',
  tax_included    boolean     NOT NULL DEFAULT true,
  free_shipping_above numeric(14,2),
  shipping_cost   numeric(10,2) NOT NULL DEFAULT 0,
  is_active       boolean     NOT NULL DEFAULT false,
  meta_title      text,
  meta_description text,
  social_links    jsonb       NOT NULL DEFAULT '{}',
  payment_methods text[]      NOT NULL DEFAULT ARRAY['mercadopago','transferencia'],
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id),
  UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS ecommerce_categories (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid        NOT NULL REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  slug            text        NOT NULL,
  parent_id       uuid        REFERENCES ecommerce_categories(id) ON DELETE SET NULL,
  image_url       text,
  description     text,
  sort_order      int         NOT NULL DEFAULT 0,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, slug)
);

CREATE TABLE IF NOT EXISTS ecommerce_cart_sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid        NOT NULL REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
  session_token   text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  customer_email  text,
  items           jsonb       NOT NULL DEFAULT '[]',   -- [{product_id, qty, price, name}]
  subtotal        numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  shipping_cost   numeric(10,2) NOT NULL DEFAULT 0,
  total           numeric(14,2) NOT NULL DEFAULT 0,
  coupon_code     text,
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','abandoned','converted','expired')),
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  ip_address      text,
  user_agent      text,
  abandoned_email_sent boolean NOT NULL DEFAULT false,
  converted_at    timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ecommerce_orders (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  store_id        uuid        NOT NULL REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
  cart_session_id uuid        REFERENCES ecommerce_cart_sessions(id) ON DELETE SET NULL,
  order_number    text        NOT NULL,
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  customer_email  text        NOT NULL,
  customer_name   text        NOT NULL,
  customer_phone  text,
  shipping_address jsonb      NOT NULL DEFAULT '{}',
  billing_address  jsonb      NOT NULL DEFAULT '{}',
  items           jsonb       NOT NULL DEFAULT '[]',
  subtotal        numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  shipping_cost   numeric(10,2) NOT NULL DEFAULT 0,
  tax_amount      numeric(14,2) NOT NULL DEFAULT 0,
  total           numeric(14,2) NOT NULL DEFAULT 0,
  payment_method  text        NOT NULL DEFAULT 'mercadopago',
  payment_status  text        NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded','partial')),
  fulfillment_status text     NOT NULL DEFAULT 'pending' CHECK (fulfillment_status IN ('pending','processing','shipped','delivered','cancelled','returned')),
  tracking_number text,
  carrier         text,
  notes           text,
  coupon_code     text,
  utm_source      text,
  tags            text[]      NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-generate order numbers
CREATE OR REPLACE FUNCTION set_ecommerce_order_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_next int;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 4) AS int)), 0) + 1
  INTO v_next
  FROM ecommerce_orders
  WHERE org_id = NEW.org_id;
  NEW.order_number := 'ORD' || LPAD(v_next::text, 6, '0');
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER trg_ecommerce_order_number
BEFORE INSERT ON ecommerce_orders
FOR EACH ROW WHEN (NEW.order_number IS NULL OR NEW.order_number = '')
EXECUTE FUNCTION set_ecommerce_order_number();

-- Conversion funnel view
CREATE OR REPLACE VIEW ecommerce_funnel AS
SELECT
  s.org_id,
  s.id AS store_id,
  DATE_TRUNC('day', cs.created_at) AS day,
  COUNT(DISTINCT cs.id) AS total_sessions,
  COUNT(DISTINCT cs.id) FILTER (WHERE jsonb_array_length(cs.items) > 0) AS sessions_with_items,
  COUNT(DISTINCT cs.id) FILTER (WHERE cs.status = 'converted') AS converted,
  COUNT(DISTINCT cs.id) FILTER (WHERE cs.status = 'abandoned') AS abandoned,
  ROUND(COUNT(DISTINCT cs.id) FILTER (WHERE cs.status = 'converted') * 100.0 /
    NULLIF(COUNT(DISTINCT cs.id), 0), 2) AS conversion_rate
FROM ecommerce_stores s
LEFT JOIN ecommerce_cart_sessions cs ON cs.store_id = s.id
GROUP BY s.org_id, s.id, DATE_TRUNC('day', cs.created_at);

-- Updated_at triggers
CREATE OR REPLACE FUNCTION update_ecommerce_cart_ts() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE OR REPLACE TRIGGER trg_cart_ts BEFORE UPDATE ON ecommerce_cart_sessions FOR EACH ROW EXECUTE FUNCTION update_ecommerce_cart_ts();
CREATE OR REPLACE TRIGGER trg_order_ts BEFORE UPDATE ON ecommerce_orders FOR EACH ROW EXECUTE FUNCTION update_ecommerce_cart_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ecom_store_org       ON ecommerce_stores(org_id);
CREATE INDEX IF NOT EXISTS idx_ecom_categories_store ON ecommerce_categories(store_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_ecom_carts_org       ON ecommerce_cart_sessions(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ecom_orders_org      ON ecommerce_orders(org_id, payment_status, fulfillment_status, created_at DESC);

-- RLS
ALTER TABLE ecommerce_stores         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_cart_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_orders         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_ecom_stores"      ON ecommerce_stores;
DROP POLICY IF EXISTS "org_ecom_categories"  ON ecommerce_categories;
DROP POLICY IF EXISTS "org_ecom_carts"       ON ecommerce_cart_sessions;
DROP POLICY IF EXISTS "org_ecom_orders"      ON ecommerce_orders;

CREATE POLICY "org_ecom_stores"     ON ecommerce_stores        USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ecom_categories" ON ecommerce_categories    USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ecom_carts"      ON ecommerce_cart_sessions USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_ecom_orders"     ON ecommerce_orders        USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
