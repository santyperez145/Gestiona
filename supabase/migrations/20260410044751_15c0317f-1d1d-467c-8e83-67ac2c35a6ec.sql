-- Add featured and offer expiration columns to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;

-- Drop and recreate the products_public view with new fields
DROP VIEW IF EXISTS public.products_public;
CREATE VIEW public.products_public AS
SELECT id, user_id, name, brand, category, gender, sale_price_ars, discount_price_ars, stock, image_url, description, featured, offer_expires_at
FROM public.products;