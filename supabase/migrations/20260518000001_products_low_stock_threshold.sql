-- Add low_stock_threshold to products table (per-product override of global setting)
-- and seller_name to sales (which seller completed the POS sale)

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer DEFAULT NULL;

-- Index for stock alert queries
CREATE INDEX IF NOT EXISTS products_low_stock_idx
  ON public.products(user_id, stock)
  WHERE stock IS NOT NULL;

-- Add seller_name to sales (POS: who was on shift when the sale happened)
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS seller_name text DEFAULT NULL;

CREATE INDEX IF NOT EXISTS sales_seller_name_idx
  ON public.sales(org_id, seller_name)
  WHERE seller_name IS NOT NULL;
