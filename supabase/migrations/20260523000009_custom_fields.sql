-- Custom Field Definitions (Salesforce Custom Objects equivalent)
-- Allows orgs to define extra fields on customers and products.
-- Field values are stored in the JSONB column `custom_fields` on each entity.

-- ─── Field definitions table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS custom_field_defs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type  text        NOT NULL CHECK (entity_type IN ('customer', 'product')),
  field_key    text        NOT NULL,
  field_label  text        NOT NULL,
  field_type   text        NOT NULL DEFAULT 'text'
                           CHECK (field_type IN ('text', 'number', 'date', 'boolean', 'select')),
  required     boolean     NOT NULL DEFAULT false,
  options      text[],               -- only for field_type = 'select'
  sort_order   int         NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, entity_type, field_key)
);

-- ─── Add custom_fields JSONB column to customers and products ─────────────────

ALTER TABLE customers ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}';
ALTER TABLE products  ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}';

-- GIN index for fast JSONB queries on custom fields
CREATE INDEX IF NOT EXISTS idx_customers_custom_fields ON customers USING GIN (custom_fields);
CREATE INDEX IF NOT EXISTS idx_products_custom_fields  ON products  USING GIN (custom_fields);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_custom_field_defs_org    ON custom_field_defs(org_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_defs_entity ON custom_field_defs(org_id, entity_type, sort_order);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE custom_field_defs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_custom_field_defs" ON custom_field_defs;
CREATE POLICY "org_custom_field_defs" ON custom_field_defs
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
