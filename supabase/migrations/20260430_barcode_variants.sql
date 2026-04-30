-- ============================================================
-- BARCODE + VARIANT IMPROVEMENTS
-- ============================================================

-- Add barcode & SKU to products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS sku text;

CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_sku ON public.products(sku) WHERE sku IS NOT NULL;

-- Add variant_type so variants work for all categories (not just vapers)
-- Values: 'sabor' | 'talle' | 'color' | 'medida' | 'otro'
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS variant_type text NOT NULL DEFAULT 'sabor',
  ADD COLUMN IF NOT EXISTS price_override numeric;

-- Add price_override index for quick lookups in POS
CREATE INDEX IF NOT EXISTS idx_product_variants_org ON public.product_variants(org_id) WHERE org_id IS NOT NULL;
