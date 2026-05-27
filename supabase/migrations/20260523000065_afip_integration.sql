-- AFIP / Facturación Electrónica Argentina

CREATE TABLE IF NOT EXISTS afip_config (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cuit              text        NOT NULL,
  razon_social      text        NOT NULL,
  punto_venta       int         NOT NULL DEFAULT 1,
  ambiente          text        NOT NULL DEFAULT 'homologacion' CHECK (ambiente IN ('homologacion','produccion')),
  cert_pem          text,       -- PEM certificate (encrypted at app level)
  key_pem           text,       -- private key (encrypted at app level)
  cert_expires_at   date,
  last_sync_at      timestamptz,
  is_active         boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

CREATE TABLE IF NOT EXISTS afip_comprobantes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id        uuid        REFERENCES invoices(id) ON DELETE SET NULL,
  tipo_cbte         int         NOT NULL,   -- 1=FA, 6=FB, 11=FC, etc.
  punto_venta       int         NOT NULL,
  nro_cbte          bigint      NOT NULL,
  fecha_cbte        date        NOT NULL DEFAULT CURRENT_DATE,
  tipo_doc          int         NOT NULL DEFAULT 80,  -- 80=CUIT, 96=DNI, 99=consumidor final
  nro_doc           text        NOT NULL DEFAULT '0',
  imp_neto          numeric(14,2) NOT NULL DEFAULT 0,
  imp_iva           numeric(14,2) NOT NULL DEFAULT 0,
  imp_total         numeric(14,2) NOT NULL DEFAULT 0,
  imp_op_ex         numeric(14,2) NOT NULL DEFAULT 0,
  imp_trib          numeric(14,2) NOT NULL DEFAULT 0,
  moneda_id         text        NOT NULL DEFAULT 'PES',
  moneda_cotiz      numeric(12,4) NOT NULL DEFAULT 1,
  cae               text,
  cae_fch_vto       date,
  resultado         text        CHECK (resultado IN ('A','R','O')),  -- Aprobado/Rechazado/Observado
  observaciones     jsonb       NOT NULL DEFAULT '[]',
  error_code        text,
  error_msg         text,
  qr_data           text,       -- encoded for QR sticker
  status            text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','authorized','rejected','cancelled')),
  raw_request       jsonb,
  raw_response      jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, tipo_cbte, punto_venta, nro_cbte)
);

CREATE TABLE IF NOT EXISTS afip_alicuotas (
  id                uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid  NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  producto_id       uuid  REFERENCES products(id) ON DELETE CASCADE,
  alicuota_iva      numeric(5,2) NOT NULL DEFAULT 21.0 CHECK (alicuota_iva IN (0, 2.5, 5, 10.5, 21, 27)),
  tipo_exento       boolean NOT NULL DEFAULT false,
  UNIQUE (org_id, producto_id)
);

CREATE TABLE IF NOT EXISTS afip_padron_cache (
  cuit              text  PRIMARY KEY,
  razon_social      text,
  tipo_persona      text,
  estado            text,
  domicilio         jsonb,
  actividades       jsonb NOT NULL DEFAULT '[]',
  categorias_iva    jsonb NOT NULL DEFAULT '[]',
  consulted_at      timestamptz NOT NULL DEFAULT now()
);

-- Get next CBte number for a punto_venta + tipo
CREATE OR REPLACE FUNCTION get_next_cbte_number(
  p_org_id      uuid,
  p_tipo_cbte   int,
  p_punto_venta int
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_next bigint;
BEGIN
  SELECT COALESCE(MAX(nro_cbte), 0) + 1
  INTO v_next
  FROM afip_comprobantes
  WHERE org_id = p_org_id
    AND tipo_cbte = p_tipo_cbte
    AND punto_venta = p_punto_venta;
  RETURN v_next;
END;
$$;

-- Stats: authorization rate per day
CREATE OR REPLACE FUNCTION get_afip_stats(p_org_id uuid, p_days int DEFAULT 30)
RETURNS TABLE(
  day           date,
  total         bigint,
  authorized    bigint,
  rejected      bigint,
  pending       bigint,
  total_amount  numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    DATE(created_at)            AS day,
    COUNT(*)                    AS total,
    COUNT(*) FILTER (WHERE status = 'authorized') AS authorized,
    COUNT(*) FILTER (WHERE status = 'rejected')   AS rejected,
    COUNT(*) FILTER (WHERE status = 'pending')    AS pending,
    SUM(imp_total)              AS total_amount
  FROM afip_comprobantes
  WHERE org_id = p_org_id
    AND created_at >= now() - (p_days || ' days')::interval
  GROUP BY DATE(created_at)
  ORDER BY day DESC;
$$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_afip_config_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE OR REPLACE TRIGGER trg_afip_config_ts
BEFORE UPDATE ON afip_config
FOR EACH ROW EXECUTE FUNCTION update_afip_config_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_afip_cbte_org_status ON afip_comprobantes(org_id, status, fecha_cbte DESC);
CREATE INDEX IF NOT EXISTS idx_afip_cbte_invoice    ON afip_comprobantes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_afip_alicuotas_org   ON afip_alicuotas(org_id);

-- RLS
ALTER TABLE afip_config       ENABLE ROW LEVEL SECURITY;
ALTER TABLE afip_comprobantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE afip_alicuotas    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_afip_config"       ON afip_config;
DROP POLICY IF EXISTS "org_afip_comprobantes" ON afip_comprobantes;
DROP POLICY IF EXISTS "org_afip_alicuotas"    ON afip_alicuotas;

CREATE POLICY "org_afip_config"       ON afip_config       USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_afip_comprobantes" ON afip_comprobantes USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_afip_alicuotas"    ON afip_alicuotas    USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
