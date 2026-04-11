
-- Add volume discount and decant margin settings
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS volume_discount_threshold integer DEFAULT 3;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS volume_discount_percent numeric DEFAULT 10;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS decant_margin_10ml numeric DEFAULT 250;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS decant_margin_5ml numeric DEFAULT 350;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS decant_margin_2_5ml numeric DEFAULT 500;

-- Add content_ml and total_sold to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS content_ml integer DEFAULT 100;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS total_sold integer DEFAULT 0;

-- Recreate products_public view with new fields
DROP VIEW IF EXISTS public.products_public;
CREATE VIEW public.products_public AS
SELECT id, user_id, name, brand, category, gender, sale_price_ars, discount_price_ars, stock, image_url, description, featured, offer_expires_at, content_ml, total_sold
FROM public.products;
