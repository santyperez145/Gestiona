-- Price Lists (Listas de Precios) — tiered pricing for B2B/B2C/wholesale
-- Allows different price lists per customer segment: minorista, mayorista, VIP, etc.

CREATE TABLE IF NOT EXISTS public.price_lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name          text NOT NULL,                   -- "Minorista", "Mayorista", "VIP"
  description   text,
  discount_pct  numeric(5,2) NOT NULL DEFAULT 0, -- Global % applied on top of base price
  currency      text NOT NULL DEFAULT 'ARS',
  is_default    boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Per-product price overrides (optional — overrides the global pct for specific products)
CREATE TABLE IF NOT EXISTS public.price_list_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id uuid NOT NULL REFERENCES public.price_lists(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price_ars     numeric(12,2),     -- Fixed ARS price (overrides global pct if set)
  discount_pct  numeric(5,2),      -- Product-specific override pct
  min_qty       int NOT NULL DEFAULT 1, -- Minimum quantity to get this price
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (price_list_id, product_id)
);

-- Link customers to a default price list
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS price_list_id uuid REFERENCES public.price_lists(id) ON DELETE SET NULL;

-- Seed: every org gets a default "Minorista" price list
CREATE OR REPLACE FUNCTION public.seed_default_price_list(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.price_lists (org_id, name, description, discount_pct, is_default)
  VALUES (p_org_id, 'Minorista', 'Lista de precios regular', 0, true)
  ON CONFLICT DO NOTHING;
END;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS price_lists_org_idx ON public.price_lists(org_id);
CREATE INDEX IF NOT EXISTS price_list_items_list_idx ON public.price_list_items(price_list_id);
CREATE INDEX IF NOT EXISTS price_list_items_product_idx ON public.price_list_items(product_id);
CREATE INDEX IF NOT EXISTS customers_price_list_idx ON public.customers(price_list_id);

-- RLS
ALTER TABLE public.price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read their price lists"
  ON public.price_lists FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid()));

CREATE POLICY "Admins can manage price lists"
  ON public.price_lists FOR ALL
  USING (org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY "Org members can read price list items"
  ON public.price_list_items FOR SELECT
  USING (price_list_id IN (
    SELECT pl.id FROM public.price_lists pl
    JOIN public.org_members om ON om.org_id = pl.org_id AND om.user_id = auth.uid()
  ));

CREATE POLICY "Admins can manage price list items"
  ON public.price_list_items FOR ALL
  USING (price_list_id IN (
    SELECT pl.id FROM public.price_lists pl
    JOIN public.org_members om ON om.org_id = pl.org_id AND om.user_id = auth.uid() AND om.role = 'admin'
  ));
