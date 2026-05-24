-- Digital Products & Downloads

CREATE TABLE IF NOT EXISTS digital_products (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  file_url        text,
  preview_url     text,
  price           numeric(12,2) NOT NULL DEFAULT 0,
  currency        text        NOT NULL DEFAULT 'ARS',
  category        text,
  tags            text[]      NOT NULL DEFAULT '{}',
  download_limit  int,                             -- NULL = unlimited
  total_sold      int         NOT NULL DEFAULT 0,
  total_revenue   numeric(14,2) NOT NULL DEFAULT 0,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS digital_product_licenses (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      uuid        NOT NULL REFERENCES digital_products(id) ON DELETE CASCADE,
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   text        NOT NULL,
  customer_email  text        NOT NULL,
  license_key     text        NOT NULL UNIQUE,
  download_token  text        NOT NULL UNIQUE,
  amount_paid     numeric(12,2) NOT NULL DEFAULT 0,
  downloads_used  int         NOT NULL DEFAULT 0,
  max_downloads   int,                             -- NULL = unlimited
  expires_at      timestamptz,
  revoked         boolean     NOT NULL DEFAULT false,
  revoked_reason  text,
  last_downloaded_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS digital_download_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id      uuid        NOT NULL REFERENCES digital_product_licenses(id) ON DELETE CASCADE,
  ip_address      text,
  user_agent      text,
  downloaded_at   timestamptz NOT NULL DEFAULT now()
);

-- Generate secure license key
CREATE OR REPLACE FUNCTION generate_license_key()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  key text;
  exists_flag bool;
BEGIN
  LOOP
    key := upper(
      substring(md5(random()::text) for 4) || '-' ||
      substring(md5(random()::text) for 4) || '-' ||
      substring(md5(random()::text) for 4) || '-' ||
      substring(md5(random()::text) for 4)
    );
    SELECT EXISTS(SELECT 1 FROM digital_product_licenses WHERE license_key = key) INTO exists_flag;
    EXIT WHEN NOT exists_flag;
  END LOOP;
  RETURN key;
END;
$$;

-- Generate download token
CREATE OR REPLACE FUNCTION generate_download_token()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  token text;
  exists_flag bool;
BEGIN
  LOOP
    token := md5(random()::text || clock_timestamp()::text || random()::text);
    SELECT EXISTS(SELECT 1 FROM digital_product_licenses WHERE download_token = token) INTO exists_flag;
    EXIT WHEN NOT exists_flag;
  END LOOP;
  RETURN token;
END;
$$;

-- Auto-set license_key and download_token on insert
CREATE OR REPLACE FUNCTION set_license_credentials()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.license_key IS NULL OR NEW.license_key = '' THEN
    NEW.license_key := generate_license_key();
  END IF;
  IF NEW.download_token IS NULL OR NEW.download_token = '' THEN
    NEW.download_token := generate_download_token();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_license_creds ON digital_product_licenses;
CREATE TRIGGER trg_license_creds BEFORE INSERT ON digital_product_licenses
  FOR EACH ROW EXECUTE FUNCTION set_license_credentials();

-- Update digital_products stats on license insert
CREATE OR REPLACE FUNCTION update_dp_stats()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE digital_products
  SET total_sold    = total_sold + 1,
      total_revenue = total_revenue + NEW.amount_paid,
      updated_at    = now()
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dp_stats ON digital_product_licenses;
CREATE TRIGGER trg_dp_stats AFTER INSERT ON digital_product_licenses
  FOR EACH ROW EXECUTE FUNCTION update_dp_stats();

-- Update download count on event insert
CREATE OR REPLACE FUNCTION update_download_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE digital_product_licenses
  SET downloads_used = downloads_used + 1,
      last_downloaded_at = now()
  WHERE id = NEW.license_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dl_count ON digital_download_events;
CREATE TRIGGER trg_dl_count AFTER INSERT ON digital_download_events
  FOR EACH ROW EXECUTE FUNCTION update_download_count();

-- updated_at
CREATE OR REPLACE FUNCTION update_dp_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_dp_updated ON digital_products;
CREATE TRIGGER trg_dp_updated BEFORE UPDATE ON digital_products
  FOR EACH ROW EXECUTE FUNCTION update_dp_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dp_org           ON digital_products(org_id, active);
CREATE INDEX IF NOT EXISTS idx_dp_licenses_prod ON digital_product_licenses(product_id);
CREATE INDEX IF NOT EXISTS idx_dp_licenses_org  ON digital_product_licenses(org_id);
CREATE INDEX IF NOT EXISTS idx_dp_licenses_key  ON digital_product_licenses(license_key);
CREATE INDEX IF NOT EXISTS idx_dp_events_lic    ON digital_download_events(license_id);

-- RLS
ALTER TABLE digital_products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_product_licenses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE digital_download_events   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_dp"       ON digital_products;
DROP POLICY IF EXISTS "org_licenses" ON digital_product_licenses;
DROP POLICY IF EXISTS "org_dl_evt"   ON digital_download_events;

CREATE POLICY "org_dp" ON digital_products
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_licenses" ON digital_product_licenses
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_dl_evt" ON digital_download_events
  USING (license_id IN (
    SELECT id FROM digital_product_licenses
    WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
  ));
