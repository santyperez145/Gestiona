-- Commerce Kernel K1: product types and typed attributes.
-- Existing products remain valid: product_type_id is nullable and custom_fields
-- stays available as a compatibility layer until each catalog is migrated.

CREATE TABLE IF NOT EXISTS public.product_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL,
  description text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_types_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT product_types_slug_valid CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT product_types_org_slug_unique UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS public.attribute_definitions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_type_id    uuid NOT NULL REFERENCES public.product_types(id) ON DELETE CASCADE,
  name               text NOT NULL,
  slug               text NOT NULL,
  data_type          text NOT NULL DEFAULT 'text'
                     CHECK (data_type IN ('text', 'number', 'boolean', 'date', 'select', 'multiselect')),
  unit               text,
  options            jsonb NOT NULL DEFAULT '[]'::jsonb,
  required           boolean NOT NULL DEFAULT false,
  filterable         boolean NOT NULL DEFAULT true,
  sort_order         integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attribute_definitions_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT attribute_definitions_slug_valid CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT attribute_definitions_options_array CHECK (jsonb_typeof(options) = 'array'),
  CONSTRAINT attribute_definitions_type_unique UNIQUE (product_type_id, slug)
);

CREATE TABLE IF NOT EXISTS public.product_attribute_values (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id             uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  attribute_definition_id uuid NOT NULL REFERENCES public.attribute_definitions(id) ON DELETE CASCADE,
  value_text             text,
  value_number           numeric,
  value_boolean          boolean,
  value_date             date,
  value_json             jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_attribute_values_one_value CHECK (
    num_nonnulls(value_text, value_number, value_boolean, value_date, value_json) = 1
  ),
  CONSTRAINT product_attribute_values_unique UNIQUE (product_id, attribute_definition_id)
);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_type_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_product_type_id_fkey'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_product_type_id_fkey
      FOREIGN KEY (product_type_id) REFERENCES public.product_types(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_types_org ON public.product_types(org_id);
CREATE INDEX IF NOT EXISTS idx_attribute_definitions_org_type
  ON public.attribute_definitions(org_id, product_type_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_product_attribute_values_org_product
  ON public.product_attribute_values(org_id, product_id);
CREATE INDEX IF NOT EXISTS idx_products_product_type ON public.products(product_type_id);

CREATE OR REPLACE FUNCTION public.validate_product_type_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  type_org uuid;
BEGIN
  IF NEW.product_type_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT org_id INTO type_org
  FROM public.product_types
  WHERE id = NEW.product_type_id;

  IF type_org IS NULL OR type_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'El tipo de producto no pertenece a la organización';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_product_type_assignment ON public.products;
CREATE TRIGGER trg_validate_product_type_assignment
  BEFORE INSERT OR UPDATE OF product_type_id, org_id ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.validate_product_type_assignment();

CREATE OR REPLACE FUNCTION public.validate_product_attribute_value()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  product_org uuid;
  definition_org uuid;
  definition_type text;
  definition_product_type uuid;
  product_type uuid;
BEGIN
  SELECT org_id, product_type_id
    INTO product_org, product_type
  FROM public.products
  WHERE id = NEW.product_id;

  SELECT org_id, data_type, product_type_id
    INTO definition_org, definition_type, definition_product_type
  FROM public.attribute_definitions
  WHERE id = NEW.attribute_definition_id;

  IF product_org IS NULL OR definition_org IS NULL
     OR product_org IS DISTINCT FROM NEW.org_id
     OR definition_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'El valor y su definición deben pertenecer a la organización';
  END IF;

  IF product_type IS NULL OR product_type IS DISTINCT FROM definition_product_type THEN
    RAISE EXCEPTION 'El producto debe tener asignado el tipo de la definición';
  END IF;

  IF (definition_type IN ('text', 'select') AND NEW.value_text IS NULL)
     OR (definition_type = 'number' AND NEW.value_number IS NULL)
     OR (definition_type = 'boolean' AND NEW.value_boolean IS NULL)
     OR (definition_type = 'date' AND NEW.value_date IS NULL)
     OR (definition_type = 'multiselect' AND NEW.value_json IS NULL) THEN
    RAISE EXCEPTION 'El valor no coincide con el tipo del atributo';
  END IF;

  IF (definition_type NOT IN ('text', 'select') AND NEW.value_text IS NOT NULL)
     OR (definition_type <> 'number' AND NEW.value_number IS NOT NULL)
     OR (definition_type <> 'boolean' AND NEW.value_boolean IS NOT NULL)
     OR (definition_type <> 'date' AND NEW.value_date IS NOT NULL)
     OR (definition_type <> 'multiselect' AND NEW.value_json IS NOT NULL) THEN
    RAISE EXCEPTION 'El valor contiene una columna incompatible con el tipo del atributo';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_product_attribute_value ON public.product_attribute_values;
CREATE TRIGGER trg_validate_product_attribute_value
  BEFORE INSERT OR UPDATE ON public.product_attribute_values
  FOR EACH ROW EXECUTE FUNCTION public.validate_product_attribute_value();

DROP TRIGGER IF EXISTS update_product_types_updated_at ON public.product_types;
CREATE TRIGGER update_product_types_updated_at
  BEFORE UPDATE ON public.product_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_attribute_definitions_updated_at ON public.attribute_definitions;
CREATE TRIGGER update_attribute_definitions_updated_at
  BEFORE UPDATE ON public.attribute_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_product_attribute_values_updated_at ON public.product_attribute_values;
CREATE TRIGGER update_product_attribute_values_updated_at
  BEFORE UPDATE ON public.product_attribute_values
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.product_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attribute_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_attribute_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_types_org_access ON public.product_types;
CREATE POLICY product_types_org_access ON public.product_types
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS attribute_definitions_org_access ON public.attribute_definitions;
CREATE POLICY attribute_definitions_org_access ON public.attribute_definitions
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS product_attribute_values_org_access ON public.product_attribute_values;
CREATE POLICY product_attribute_values_org_access ON public.product_attribute_values
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

-- Fail early if an existing object was only partially created by another PC.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'product_types'
      AND column_name = 'org_id'
  ) THEN
    RAISE EXCEPTION 'product_types existe con una forma incompatible';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attribute_definitions'
      AND column_name = 'data_type'
  ) THEN
    RAISE EXCEPTION 'attribute_definitions existe con una forma incompatible';
  END IF;
END $$;
