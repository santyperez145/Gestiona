-- Multi-currency Price Lists & Customer Segments

CREATE TABLE IF NOT EXISTS price_lists (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  currency        text        NOT NULL DEFAULT 'ARS',
  is_default      boolean     NOT NULL DEFAULT false,
  active          boolean     NOT NULL DEFAULT true,
  valid_from      date,
  valid_until     date,
  applies_to      text        NOT NULL DEFAULT 'all'
                              CHECK (applies_to IN ('all','segment','customer')),
  customer_segment text,      -- 'vip', 'wholesale', 'retail', etc.
  discount_type   text        NOT NULL DEFAULT 'none'
                              CHECK (discount_type IN ('none','percentage','fixed')),
  discount_value  numeric(10,4) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_list_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id   uuid        NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        REFERENCES products(id) ON DELETE CASCADE,
  custom_price    numeric(12,2) NOT NULL,
  min_quantity    int         NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (price_list_id, product_id, min_quantity)
);

CREATE INDEX IF NOT EXISTS idx_price_lists_org   ON price_lists(org_id, active, is_default);
CREATE INDEX IF NOT EXISTS idx_price_list_items  ON price_list_items(price_list_id, product_id);
CREATE INDEX IF NOT EXISTS idx_pli_org_product   ON price_list_items(org_id, product_id);

-- Get effective price for a product given a price list
CREATE OR REPLACE FUNCTION get_effective_price(
  p_product_id uuid,
  p_price_list_id uuid,
  p_base_price numeric,
  p_quantity int DEFAULT 1
)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    -- 1st: explicit price list item
    (SELECT pli.custom_price
     FROM price_list_items pli
     WHERE pli.price_list_id = p_price_list_id
       AND pli.product_id = p_product_id
       AND pli.min_quantity <= p_quantity
     ORDER BY pli.min_quantity DESC
     LIMIT 1),
    -- 2nd: apply list-level discount
    (SELECT CASE pl.discount_type
       WHEN 'percentage' THEN p_base_price * (1 - pl.discount_value / 100)
       WHEN 'fixed' THEN GREATEST(0, p_base_price - pl.discount_value)
       ELSE p_base_price
     END
     FROM price_lists pl WHERE pl.id = p_price_list_id),
    p_base_price
  );
$$;

-- Ensure only one default price list per org
CREATE OR REPLACE FUNCTION ensure_one_default_price_list()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE price_lists SET is_default = false
    WHERE org_id = NEW.org_id AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_price_list ON price_lists;
CREATE TRIGGER trg_default_price_list
  BEFORE INSERT OR UPDATE ON price_lists
  FOR EACH ROW WHEN (NEW.is_default = true)
  EXECUTE FUNCTION ensure_one_default_price_list();

-- updated_at triggers
CREATE OR REPLACE FUNCTION update_pl_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_pl_updated ON price_lists;
CREATE TRIGGER trg_pl_updated BEFORE UPDATE ON price_lists FOR EACH ROW EXECUTE FUNCTION update_pl_timestamp();

DROP TRIGGER IF EXISTS trg_pli_updated ON price_list_items;
CREATE TRIGGER trg_pli_updated BEFORE UPDATE ON price_list_items FOR EACH ROW EXECUTE FUNCTION update_pl_timestamp();

-- RLS
ALTER TABLE price_lists       ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_list_items  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_price_lists"      ON price_lists;
DROP POLICY IF EXISTS "org_price_list_items" ON price_list_items;

CREATE POLICY "org_price_lists" ON price_lists
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_price_list_items" ON price_list_items
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
