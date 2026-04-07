
-- Fix security definer views by recreating with security_invoker
DROP VIEW IF EXISTS public.products_public;
CREATE VIEW public.products_public
WITH (security_invoker = on) AS
SELECT id, user_id, name, brand, category, gender,
       sale_price_ars, discount_price_ars, stock,
       description, image_url
FROM public.products;

DROP VIEW IF EXISTS public.settings_public;
CREATE VIEW public.settings_public
WITH (security_invoker = on) AS
SELECT id, user_id, business_name, logo_url, primary_color, secondary_color
FROM public.settings;
