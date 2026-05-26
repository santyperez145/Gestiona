-- Fleet / Vehicle Management

CREATE TABLE IF NOT EXISTS vehicles (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text        NOT NULL,   -- e.g. "Camioneta Ford Ranger"
  plate             text,                   -- patente
  brand             text,
  model             text,
  year              int,
  vin               text,                   -- número de chasis
  fuel_type         text        NOT NULL DEFAULT 'nafta'
                                CHECK (fuel_type IN ('nafta','diesel','gnc','electrico','hibrido','otro')),
  status            text        NOT NULL DEFAULT 'available'
                                CHECK (status IN ('available','in_use','maintenance','inactive')),
  odometer_km       numeric(10,2) NOT NULL DEFAULT 0,
  insurance_expiry  date,
  vtv_expiry        date,       -- verificación técnica vehicular
  assigned_to_name  text,       -- nombre del responsable
  notes             text,
  active            boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id        uuid        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  maintenance_type  text        NOT NULL DEFAULT 'service'
                                CHECK (maintenance_type IN ('service','tire','brake','oil','filter','battery','bodywork','inspection','other')),
  title             text        NOT NULL,
  description       text,
  scheduled_date    date,
  completed_date    date,
  odometer_at_service numeric(10,2),
  next_service_km   numeric(10,2),          -- km para el próximo service
  cost              numeric(14,2) NOT NULL DEFAULT 0,
  provider_name     text,
  status            text        NOT NULL DEFAULT 'scheduled'
                                CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicle_fuel_logs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id        uuid        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  date              date        NOT NULL DEFAULT CURRENT_DATE,
  liters            numeric(8,2) NOT NULL DEFAULT 0,
  price_per_liter   numeric(10,4) NOT NULL DEFAULT 0,
  total_cost        numeric(14,2) GENERATED ALWAYS AS (liters * price_per_liter) STORED,
  odometer_km       numeric(10,2),
  km_since_last     numeric(10,2),
  fuel_type         text        NOT NULL DEFAULT 'nafta',
  station_name      text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicle_trips (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vehicle_id        uuid        NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  driver_name       text        NOT NULL,
  purpose           text,
  origin            text,
  destination       text,
  start_odometer    numeric(10,2),
  end_odometer      numeric(10,2),
  km_driven         numeric(10,2) GENERATED ALWAYS AS (
    CASE WHEN end_odometer IS NOT NULL AND start_odometer IS NOT NULL
    THEN end_odometer - start_odometer ELSE NULL END
  ) STORED,
  start_time        timestamptz NOT NULL DEFAULT now(),
  end_time          timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- updated_at trigger for vehicles
CREATE OR REPLACE FUNCTION update_vehicle_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_vehicle_ts ON vehicles;
CREATE TRIGGER trg_vehicle_ts BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION update_vehicle_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicles_org         ON vehicles(org_id, status, active);
CREATE INDEX IF NOT EXISTS idx_vehicle_maint_org    ON vehicle_maintenance(org_id, vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicle_fuel_org     ON vehicle_fuel_logs(org_id, vehicle_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_trips_org    ON vehicle_trips(org_id, vehicle_id, start_time DESC);

-- RLS
ALTER TABLE vehicles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_fuel_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_trips       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_vehicles"      ON vehicles;
DROP POLICY IF EXISTS "org_veh_maint"     ON vehicle_maintenance;
DROP POLICY IF EXISTS "org_veh_fuel"      ON vehicle_fuel_logs;
DROP POLICY IF EXISTS "org_veh_trips"     ON vehicle_trips;

CREATE POLICY "org_vehicles" ON vehicles
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_veh_maint" ON vehicle_maintenance
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_veh_fuel" ON vehicle_fuel_logs
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_veh_trips" ON vehicle_trips
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
