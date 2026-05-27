-- Logistics & Delivery: carriers, zones, rate tables, tracking

CREATE TABLE IF NOT EXISTS carriers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  code            text        NOT NULL,
  carrier_type    text        NOT NULL DEFAULT 'courier' CHECK (carrier_type IN ('courier','freight','own','marketplace','postal')),
  logo_url        text,
  tracking_url    text,       -- {tracking_number} placeholder
  api_key_ref     text,       -- reference to api_keys table
  is_active       boolean     NOT NULL DEFAULT true,
  avg_days        numeric(4,1) NOT NULL DEFAULT 3,
  max_weight_kg   numeric(8,2),
  max_dimensions  jsonb,      -- {l,w,h} in cm
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS shipping_zones (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  provinces       text[]      NOT NULL DEFAULT '{}',
  postal_codes    text[]      NOT NULL DEFAULT '{}',
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shipping_rates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  carrier_id      uuid        NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  zone_id         uuid        NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE,
  service_name    text        NOT NULL DEFAULT 'Estándar',
  min_weight_kg   numeric(8,2) NOT NULL DEFAULT 0,
  max_weight_kg   numeric(8,2),
  min_value       numeric(14,2) NOT NULL DEFAULT 0,
  max_value       numeric(14,2),
  base_cost       numeric(10,2) NOT NULL DEFAULT 0,
  cost_per_kg     numeric(10,2) NOT NULL DEFAULT 0,
  free_above      numeric(14,2),  -- free shipping if order value >= this
  estimated_days  int         NOT NULL DEFAULT 3,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shipments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  carrier_id      uuid        REFERENCES carriers(id) ON DELETE SET NULL,
  zone_id         uuid        REFERENCES shipping_zones(id) ON DELETE SET NULL,
  order_ref       text,       -- reference to sale/ecommerce_order
  tracking_number text,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','label_created','picked_up','in_transit','out_for_delivery','delivered','failed','returned')),
  origin_address  jsonb       NOT NULL DEFAULT '{}',
  dest_address    jsonb       NOT NULL DEFAULT '{}',
  weight_kg       numeric(8,2) NOT NULL DEFAULT 0,
  dimensions      jsonb,
  shipping_cost   numeric(10,2) NOT NULL DEFAULT 0,
  insurance_value numeric(14,2) NOT NULL DEFAULT 0,
  estimated_delivery date,
  actual_delivery timestamp,
  events          jsonb       NOT NULL DEFAULT '[]',  -- [{status, ts, location, description}]
  label_url       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Compute shipping cost for an order
CREATE OR REPLACE FUNCTION calculate_shipping_cost(
  p_org_id      uuid,
  p_zone_id     uuid,
  p_carrier_id  uuid,
  p_weight_kg   numeric,
  p_order_value numeric
) RETURNS TABLE(
  carrier_name  text,
  service_name  text,
  base_cost     numeric,
  weight_cost   numeric,
  total_cost    numeric,
  is_free       boolean,
  estimated_days int
) LANGUAGE sql STABLE AS $$
  SELECT
    c.name,
    sr.service_name,
    sr.base_cost,
    sr.cost_per_kg * p_weight_kg AS weight_cost,
    CASE WHEN sr.free_above IS NOT NULL AND p_order_value >= sr.free_above THEN 0
    ELSE ROUND(sr.base_cost + sr.cost_per_kg * p_weight_kg, 2) END AS total_cost,
    (sr.free_above IS NOT NULL AND p_order_value >= sr.free_above) AS is_free,
    sr.estimated_days
  FROM shipping_rates sr
  JOIN carriers c ON c.id = sr.carrier_id
  WHERE sr.org_id = p_org_id
    AND sr.zone_id = p_zone_id
    AND sr.carrier_id = p_carrier_id
    AND sr.is_active = true
    AND sr.min_weight_kg <= p_weight_kg
    AND (sr.max_weight_kg IS NULL OR sr.max_weight_kg >= p_weight_kg)
    AND sr.min_value <= p_order_value
    AND (sr.max_value IS NULL OR sr.max_value >= p_order_value)
  LIMIT 3;
$$;

-- Delivery performance stats
CREATE OR REPLACE FUNCTION get_carrier_performance(p_org_id uuid, p_days int DEFAULT 30)
RETURNS TABLE(
  carrier_id    uuid,
  carrier_name  text,
  total_shipments bigint,
  on_time       bigint,
  late          bigint,
  returned      bigint,
  on_time_rate  numeric,
  avg_days      numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    s.carrier_id,
    c.name AS carrier_name,
    COUNT(*) AS total_shipments,
    COUNT(*) FILTER (WHERE s.status = 'delivered' AND s.actual_delivery::date <= s.estimated_delivery) AS on_time,
    COUNT(*) FILTER (WHERE s.status = 'delivered' AND s.actual_delivery::date > s.estimated_delivery) AS late,
    COUNT(*) FILTER (WHERE s.status = 'returned') AS returned,
    ROUND(COUNT(*) FILTER (WHERE s.status = 'delivered' AND s.actual_delivery::date <= s.estimated_delivery) * 100.0 / NULLIF(COUNT(*) FILTER (WHERE s.status = 'delivered'), 0), 1) AS on_time_rate,
    ROUND(AVG(EXTRACT(DAY FROM s.actual_delivery::timestamp - s.created_at)) FILTER (WHERE s.status = 'delivered'), 1) AS avg_days
  FROM shipments s
  LEFT JOIN carriers c ON c.id = s.carrier_id
  WHERE s.org_id = p_org_id
    AND s.created_at >= now() - (p_days || ' days')::interval
  GROUP BY s.carrier_id, c.name;
$$;

-- Updated_at trigger
CREATE OR REPLACE TRIGGER trg_shipment_ts BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION update_ecommerce_cart_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_carriers_org      ON carriers(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_zones_org         ON shipping_zones(org_id);
CREATE INDEX IF NOT EXISTS idx_rates_carrier     ON shipping_rates(carrier_id, zone_id, is_active);
CREATE INDEX IF NOT EXISTS idx_shipments_org     ON shipments(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_number);

-- RLS
ALTER TABLE carriers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_carriers"  ON carriers;
DROP POLICY IF EXISTS "org_zones"     ON shipping_zones;
DROP POLICY IF EXISTS "org_rates"     ON shipping_rates;
DROP POLICY IF EXISTS "org_shipments" ON shipments;

CREATE POLICY "org_carriers"  ON carriers       USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_zones"     ON shipping_zones USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_rates"     ON shipping_rates USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_shipments" ON shipments      USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
