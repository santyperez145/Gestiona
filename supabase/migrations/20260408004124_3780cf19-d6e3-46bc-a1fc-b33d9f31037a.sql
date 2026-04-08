
-- 1. Fix settings: remove anon policy on base table
DROP POLICY IF EXISTS "Public read settings for catalog" ON public.settings;

-- 2. Fix profiles: restrict to own profile + admin
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'));

-- 3. Fix storage product-images: add owner check
DROP POLICY IF EXISTS "Authenticated users can update product images" ON storage.objects;
CREATE POLICY "Authenticated users can update product images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND owner_id::uuid = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can delete product images" ON storage.objects;
CREATE POLICY "Authenticated users can delete product images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND owner_id::uuid = auth.uid());

-- 4. Fix storage marketing-images: add owner check to delete
DROP POLICY IF EXISTS "Users can delete own marketing images" ON storage.objects;
CREATE POLICY "Users can delete own marketing images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'marketing-images' AND owner_id::uuid = auth.uid());

-- 5. Fix security definer views: recreate as security invoker
DROP VIEW IF EXISTS public.products_public;
CREATE VIEW public.products_public
WITH (security_invoker = true)
AS SELECT id, user_id, name, brand, category, gender, description, image_url, sale_price_ars, discount_price_ars, stock
FROM public.products;

DROP VIEW IF EXISTS public.settings_public;
CREATE VIEW public.settings_public
WITH (security_invoker = true)
AS SELECT id, user_id, business_name, logo_url, primary_color, secondary_color, whatsapp_number
FROM public.settings;

-- Grant anon access to the public views
GRANT SELECT ON public.products_public TO anon;
GRANT SELECT ON public.settings_public TO anon;
GRANT SELECT ON public.products_public TO authenticated;
GRANT SELECT ON public.settings_public TO authenticated;
