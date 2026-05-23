-- Product Bundles (Kits) — sell multiple products as a single SKU
-- Examples: "Set regalo 3 perfumes", "Kit vapeo completo", "Combo navideño"

CREATE TABLE IF NOT EXISTS public.product_bundles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  image_url     text,
  price_ars     numeric(12,2) NOT NULL DEFAULT 0,  -- Bundle price (usually < sum of parts)
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Components of each bundle
CREATE TABLE IF NOT EXISTS public.bundle_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id     uuid NOT NULL REFERENCES public.product_bundles(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity      int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  UNIQUE (bundle_id, product_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS bundle_org_idx ON public.product_bundles(org_id);
CREATE INDEX IF NOT EXISTS bundle_items_bundle_idx ON public.bundle_items(bundle_id);
CREATE INDEX IF NOT EXISTS bundle_items_product_idx ON public.bundle_items(product_id);

-- RLS
ALTER TABLE public.product_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bundle_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read bundles"
  ON public.product_bundles FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE POLICY "Admins can manage bundles"
  ON public.product_bundles FOR ALL
  USING (org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Org members can read bundle items"
  ON public.bundle_items FOR SELECT
  USING (bundle_id IN (
    SELECT pb.id FROM public.product_bundles pb
    JOIN public.org_members om ON om.org_id = pb.org_id AND om.user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage bundle items"
  ON public.bundle_items FOR ALL
  USING (bundle_id IN (
    SELECT pb.id FROM public.product_bundles pb
    JOIN public.org_members om ON om.org_id = pb.org_id AND om.user_id = auth.uid() AND om.role = 'admin'
  ));

-- Add expiry_date to products (for products with shelf life: perfumes, vapors, food, cosmetics)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS lot_number text;

CREATE INDEX IF NOT EXISTS products_expiry_idx ON public.products(org_id, expiry_date)
  WHERE expiry_date IS NOT NULL;
