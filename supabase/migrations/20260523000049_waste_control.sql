-- Waste & Loss Control (Merma)

CREATE TABLE IF NOT EXISTS waste_categories (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  waste_type    text        NOT NULL DEFAULT 'spoilage'
                            CHECK (waste_type IN ('spoilage','damage','theft','expiry','production','administrative','other')),
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS waste_records (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id     uuid        REFERENCES waste_categories(id) ON DELETE SET NULL,
  product_id      uuid        REFERENCES products(id) ON DELETE SET NULL,
  product_name    text        NOT NULL,
  quantity        numeric(14,4) NOT NULL DEFAULT 0,
  unit_cost       numeric(14,2) NOT NULL DEFAULT 0,
  total_cost      numeric(14,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  date            date        NOT NULL DEFAULT CURRENT_DATE,
  reason          text,
  reported_by     text,
  location        text,
  batch_id        uuid        REFERENCES product_batches(id) ON DELETE SET NULL,
  approved        boolean     NOT NULL DEFAULT false,
  approved_by     text,
  approved_at     timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Waste summary view
CREATE OR REPLACE FUNCTION get_waste_summary(p_org_id uuid, p_from date, p_to date)
RETURNS TABLE(
  category_name text,
  waste_type    text,
  record_count  bigint,
  total_qty     numeric,
  total_cost    numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(wc.name, 'Sin categoría') AS category_name,
    COALESCE(wc.waste_type, 'other')   AS waste_type,
    COUNT(wr.id),
    SUM(wr.quantity),
    SUM(wr.total_cost)
  FROM waste_records wr
  LEFT JOIN waste_categories wc ON wc.id = wr.category_id
  WHERE wr.org_id = p_org_id
    AND wr.date BETWEEN p_from AND p_to
  GROUP BY 1, 2
  ORDER BY SUM(wr.total_cost) DESC NULLS LAST;
$$;

-- Seed default waste categories
CREATE OR REPLACE FUNCTION seed_waste_categories(p_org_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO waste_categories(org_id, name, waste_type) VALUES
    (p_org_id, 'Vencimiento',        'expiry'),
    (p_org_id, 'Daño / Rotura',      'damage'),
    (p_org_id, 'Hurto / Robo',       'theft'),
    (p_org_id, 'Merma producción',   'production'),
    (p_org_id, 'Deterioro',          'spoilage'),
    (p_org_id, 'Error administrativo','administrative'),
    (p_org_id, 'Otro',               'other')
  ON CONFLICT DO NOTHING;
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_waste_records_org  ON waste_records(org_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_waste_cats_org     ON waste_categories(org_id, active);

-- RLS
ALTER TABLE waste_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_records     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_waste_cats"    ON waste_categories;
DROP POLICY IF EXISTS "org_waste_records" ON waste_records;

CREATE POLICY "org_waste_cats" ON waste_categories
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_waste_records" ON waste_records
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
