-- Monthly Budget Planner

CREATE TABLE IF NOT EXISTS budget_categories (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  color           text        NOT NULL DEFAULT '#6366f1',
  icon            text        NOT NULL DEFAULT '💰',
  type            text        NOT NULL DEFAULT 'expense' CHECK (type IN ('expense','income')),
  sort_order      int         NOT NULL DEFAULT 0,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS budgets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id     uuid        NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
  year            int         NOT NULL,
  month           int         NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount          numeric(14,2) NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, category_id, year, month)
);

CREATE TABLE IF NOT EXISTS budget_transactions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id     uuid        NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
  amount          numeric(14,2) NOT NULL,
  description     text        NOT NULL,
  date            date        NOT NULL DEFAULT CURRENT_DATE,
  reference_type  text,        -- 'expense', 'sale', 'purchase', etc.
  reference_id    uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- updated_at
CREATE OR REPLACE FUNCTION update_budget_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_budget_updated ON budgets;
CREATE TRIGGER trg_budget_updated BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION update_budget_ts();

-- Seed default categories for org
CREATE OR REPLACE FUNCTION seed_budget_categories(p_org_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO budget_categories(org_id, name, color, icon, type, sort_order) VALUES
    (p_org_id, 'Alquiler',        '#ef4444', '🏢', 'expense', 1),
    (p_org_id, 'Sueldos',         '#f97316', '👥', 'expense', 2),
    (p_org_id, 'Mercadería',      '#eab308', '📦', 'expense', 3),
    (p_org_id, 'Marketing',       '#22c55e', '📣', 'expense', 4),
    (p_org_id, 'Servicios',       '#0ea5e9', '💡', 'expense', 5),
    (p_org_id, 'Impuestos',       '#8b5cf6', '📋', 'expense', 6),
    (p_org_id, 'Imprevistos',     '#ec4899', '⚡', 'expense', 7),
    (p_org_id, 'Ventas',          '#10b981', '💵', 'income',  10),
    (p_org_id, 'Otros ingresos',  '#06b6d4', '💰', 'income',  11)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_budgets_org      ON budgets(org_id, year, month);
CREATE INDEX IF NOT EXISTS idx_budget_cats_org  ON budget_categories(org_id, type, sort_order);
CREATE INDEX IF NOT EXISTS idx_budget_txns_org  ON budget_transactions(org_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_budget_txns_cat  ON budget_transactions(category_id, date DESC);

-- RLS
ALTER TABLE budget_categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets               ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_transactions   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_budget_cats"  ON budget_categories;
DROP POLICY IF EXISTS "org_budgets"      ON budgets;
DROP POLICY IF EXISTS "org_budget_txns"  ON budget_transactions;

CREATE POLICY "org_budget_cats" ON budget_categories
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_budgets" ON budgets
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_budget_txns" ON budget_transactions
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
