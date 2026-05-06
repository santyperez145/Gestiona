-- Lot and expiry tracking for products (vapers, fragrances, cosmetics)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS lot_number text,
  ADD COLUMN IF NOT EXISTS expiry_date date;

-- Index for quickly finding soon-to-expire products by org
CREATE INDEX IF NOT EXISTS products_expiry_idx ON public.products (org_id, expiry_date)
  WHERE expiry_date IS NOT NULL;
