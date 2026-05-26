-- Tax Management & AFIP Preparation

CREATE TABLE IF NOT EXISTS tax_rates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,  -- IVA 21%, IVA 10.5%, Monotributo, etc.
  rate_pct        numeric(8,4) NOT NULL DEFAULT 0,
  tax_type        text        NOT NULL DEFAULT 'iva'
                              CHECK (tax_type IN ('iva','iibb','ganancias','monotributo','sellos','municipal','otro')),
  applies_to      text        NOT NULL DEFAULT 'sales'
                              CHECK (applies_to IN ('sales','purchases','both')),
  jurisdiction    text,       -- AFIP, AGIP, ARBA, etc.
  code            text,       -- AFIP tax code
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tax_declarations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tax_rate_id     uuid        NOT NULL REFERENCES tax_rates(id) ON DELETE CASCADE,
  period_type     text        NOT NULL DEFAULT 'monthly'
                              CHECK (period_type IN ('monthly','bimonthly','quarterly','annual')),
  year            int         NOT NULL,
  period          int         NOT NULL,  -- month number or quarter
  taxable_base    numeric(14,2) NOT NULL DEFAULT 0,
  tax_collected   numeric(14,2) NOT NULL DEFAULT 0,  -- debito fiscal
  tax_paid        numeric(14,2) NOT NULL DEFAULT 0,  -- credito fiscal
  tax_balance     numeric(14,2) GENERATED ALWAYS AS (tax_collected - tax_paid) STORED,
  status          text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','filed','paid','amended')),
  due_date        date,
  filed_at        timestamptz,
  paid_at         timestamptz,
  declaration_number text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, tax_rate_id, year, period)
);

CREATE TABLE IF NOT EXISTS withholding_records (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  withholding_type text       NOT NULL CHECK (withholding_type IN ('ganancias','iva','iibb','suss')),
  counterpart_name text       NOT NULL,  -- proveedor o cliente
  counterpart_cuit text,
  amount          numeric(14,2) NOT NULL,
  rate_pct        numeric(8,4) NOT NULL DEFAULT 0,
  base_amount     numeric(14,2) NOT NULL DEFAULT 0,
  direction       text        NOT NULL DEFAULT 'suffered'
                              CHECK (direction IN ('suffered','applied')), -- retenido / retenemos
  date            date        NOT NULL DEFAULT CURRENT_DATE,
  certificate_number text,
  reference_type  text,  -- 'purchase', 'sale'
  reference_id    uuid,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iibb_registrations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  province        text        NOT NULL,
  regime          text        NOT NULL DEFAULT 'convenio'
                              CHECK (regime IN ('local','convenio','cm')),
  cuit            text,
  registration_number text,
  rate_pct        numeric(8,4) NOT NULL DEFAULT 0,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed common Argentine tax rates
CREATE OR REPLACE FUNCTION seed_tax_rates(p_org_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO tax_rates(org_id, name, rate_pct, tax_type, applies_to, jurisdiction, code) VALUES
    (p_org_id, 'IVA 21%',       21.00,  'iva',         'sales',     'AFIP',  '0021'),
    (p_org_id, 'IVA 10.5%',     10.50,  'iva',         'sales',     'AFIP',  '0010'),
    (p_org_id, 'IVA 27%',       27.00,  'iva',         'sales',     'AFIP',  '0027'),
    (p_org_id, 'IVA 2.5%',       2.50,  'iva',         'sales',     'AFIP',  '0002'),
    (p_org_id, 'IVA 5%',         5.00,  'iva',         'sales',     'AFIP',  '0005'),
    (p_org_id, 'IIBB CABA',      3.00,  'iibb',        'sales',     'AGIP',  NULL),
    (p_org_id, 'IIBB Provincia', 3.50,  'iibb',        'sales',     'ARBA',  NULL),
    (p_org_id, 'Monotributo',    0.00,  'monotributo', 'both',      'AFIP',  NULL),
    (p_org_id, 'Ganancias 35%',  35.00, 'ganancias',   'both',      'AFIP',  NULL)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tax_rates_org        ON tax_rates(org_id, active);
CREATE INDEX IF NOT EXISTS idx_tax_declarations_org ON tax_declarations(org_id, year, period);
CREATE INDEX IF NOT EXISTS idx_withholdings_org     ON withholding_records(org_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_iibb_registrations   ON iibb_registrations(org_id, active);

-- RLS
ALTER TABLE tax_rates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_declarations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE withholding_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE iibb_registrations     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_tax_rates"        ON tax_rates;
DROP POLICY IF EXISTS "org_tax_declarations" ON tax_declarations;
DROP POLICY IF EXISTS "org_withholdings"     ON withholding_records;
DROP POLICY IF EXISTS "org_iibb"             ON iibb_registrations;

CREATE POLICY "org_tax_rates" ON tax_rates
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_tax_declarations" ON tax_declarations
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_withholdings" ON withholding_records
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_iibb" ON iibb_registrations
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
