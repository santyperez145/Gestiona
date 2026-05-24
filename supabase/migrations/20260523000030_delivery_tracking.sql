-- Delivery Tracking & Logistics

CREATE TABLE IF NOT EXISTS deliveries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sale_id         uuid        REFERENCES sales(id) ON DELETE SET NULL,
  tracking_code   text        NOT NULL UNIQUE,
  customer_name   text        NOT NULL,
  customer_phone  text,
  customer_email  text,
  address_street  text        NOT NULL,
  address_city    text        NOT NULL,
  address_province text,
  address_zip     text,
  address_notes   text,
  driver_name     text,
  driver_phone    text,
  vehicle_plate   text,
  carrier         text        NOT NULL DEFAULT 'propio'
                              CHECK (carrier IN ('propio','oca','andreani','correo_arg','mercado_envios','otro')),
  external_tracking text,
  scheduled_for   timestamptz,
  picked_up_at    timestamptz,
  delivered_at    timestamptz,
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','assigned','picked_up','in_transit','out_for_delivery','delivered','failed','returned')),
  priority        text        NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  weight_kg       numeric(8,2),
  cod_amount      numeric(12,2) NOT NULL DEFAULT 0,
  cod_collected   boolean     NOT NULL DEFAULT false,
  signature_url   text,
  proof_photo_url text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id     uuid        NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  status          text        NOT NULL,
  description     text        NOT NULL,
  latitude        numeric(10,7),
  longitude       numeric(10,7),
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-generate tracking code
CREATE OR REPLACE FUNCTION generate_tracking_code(p_org_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  code text;
  exists_flag bool;
  prefix text := 'TRK';
BEGIN
  LOOP
    code := prefix || '-' || upper(substring(md5(random()::text) for 8));
    SELECT EXISTS(SELECT 1 FROM deliveries WHERE tracking_code = code) INTO exists_flag;
    EXIT WHEN NOT exists_flag;
  END LOOP;
  RETURN code;
END;
$$;

-- Auto-set tracking code and create first event on insert
CREATE OR REPLACE FUNCTION set_delivery_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tracking_code IS NULL OR NEW.tracking_code = '' THEN
    NEW.tracking_code := generate_tracking_code(NEW.org_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_code ON deliveries;
CREATE TRIGGER trg_delivery_code BEFORE INSERT ON deliveries
  FOR EACH ROW EXECUTE FUNCTION set_delivery_code();

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_delivery_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_updated ON deliveries;
CREATE TRIGGER trg_delivery_updated BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION update_delivery_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_deliveries_org     ON deliveries(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliveries_sale    ON deliveries(sale_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_driver  ON deliveries(driver_name, status);
CREATE INDEX IF NOT EXISTS idx_delivery_events    ON delivery_events(delivery_id, created_at DESC);

-- RLS
ALTER TABLE deliveries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_events  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_deliveries"      ON deliveries;
DROP POLICY IF EXISTS "org_delivery_events" ON delivery_events;

CREATE POLICY "org_deliveries" ON deliveries
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_delivery_events" ON delivery_events
  USING (delivery_id IN (
    SELECT id FROM deliveries
    WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  ));
