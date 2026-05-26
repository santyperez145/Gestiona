-- Recipes / Bill of Materials (Fichas Técnicas)

CREATE TABLE IF NOT EXISTS recipes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  output_product_id uuid      REFERENCES products(id) ON DELETE SET NULL,
  yield_qty       numeric(14,4) NOT NULL DEFAULT 1,
  yield_unit      text        NOT NULL DEFAULT 'unidad',
  prep_time_min   int         NOT NULL DEFAULT 0,
  cook_time_min   int         NOT NULL DEFAULT 0,
  difficulty      text        NOT NULL DEFAULT 'medium'
                              CHECK (difficulty IN ('easy','medium','hard')),
  category        text        NOT NULL DEFAULT 'produccion',
  instructions    text,
  notes           text,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id       uuid        NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_product_id uuid  REFERENCES products(id) ON DELETE SET NULL,
  ingredient_name text        NOT NULL,   -- fallback if no product_id
  quantity        numeric(14,4) NOT NULL DEFAULT 1,
  unit            text        NOT NULL DEFAULT 'unidad',
  unit_cost       numeric(14,2),          -- manual override; else taken from product
  is_optional     boolean     NOT NULL DEFAULT false,
  notes           text,
  sort_order      int         NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recipe_productions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipe_id       uuid        NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  batches         numeric(8,2) NOT NULL DEFAULT 1,
  yield_qty       numeric(14,4) NOT NULL,
  total_cost      numeric(14,2),
  notes           text,
  produced_at     timestamptz NOT NULL DEFAULT now(),
  produced_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

-- updated_at
CREATE OR REPLACE FUNCTION update_recipe_ts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_recipe_updated ON recipes;
CREATE TRIGGER trg_recipe_updated BEFORE UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION update_recipe_ts();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_recipes_org         ON recipes(org_id, active, category);
CREATE INDEX IF NOT EXISTS idx_recipe_ingr_recipe  ON recipe_ingredients(recipe_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_recipe_prod_org     ON recipe_productions(org_id, produced_at DESC);

-- RLS
ALTER TABLE recipes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients   ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_productions   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_recipes"       ON recipes;
DROP POLICY IF EXISTS "org_recipe_ingr"   ON recipe_ingredients;
DROP POLICY IF EXISTS "org_recipe_prod"   ON recipe_productions;

CREATE POLICY "org_recipes" ON recipes
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_recipe_ingr" ON recipe_ingredients
  USING (recipe_id IN (SELECT id FROM recipes WHERE org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())));
CREATE POLICY "org_recipe_prod" ON recipe_productions
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
