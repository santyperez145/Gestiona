
-- 1. Add 'viewer' to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'viewer';

-- 2. Create get_user_role function
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role::text FROM public.user_roles WHERE user_id = _user_id LIMIT 1),
    'viewer'
  )
$$;

-- 3. Create products_public view (no sensitive data)
CREATE OR REPLACE VIEW public.products_public AS
SELECT id, user_id, name, brand, category, gender,
       sale_price_ars, discount_price_ars, stock,
       description, image_url
FROM public.products;

-- 4. Create settings_public view (no sensitive data)
CREATE OR REPLACE VIEW public.settings_public AS
SELECT id, user_id, business_name, logo_url, primary_color, secondary_color
FROM public.settings;

-- 5. Drop old public policies on products and settings
DROP POLICY IF EXISTS "Public can read products" ON public.products;
DROP POLICY IF EXISTS "Public can read settings" ON public.settings;

-- 6. Update products RLS: only admin can manage
DROP POLICY IF EXISTS "Users manage own products" ON public.products;
CREATE POLICY "Admin manages products" ON public.products
FOR ALL TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

-- Allow public SELECT on products_public view (needs base table read for security_invoker)
CREATE POLICY "Public read products for catalog" ON public.products
FOR SELECT TO anon
USING (true);

-- 7. Update purchases RLS: only admin
DROP POLICY IF EXISTS "Users manage own purchases" ON public.purchases;
CREATE POLICY "Admin manages purchases" ON public.purchases
FOR ALL TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

-- 8. Update marketing_posts RLS: only admin
DROP POLICY IF EXISTS "Users manage own posts" ON public.marketing_posts;
CREATE POLICY "Admin manages marketing" ON public.marketing_posts
FOR ALL TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

-- 9. Update influencer_exchanges RLS: only admin
DROP POLICY IF EXISTS "Users manage own exchanges" ON public.influencer_exchanges;
CREATE POLICY "Admin manages exchanges" ON public.influencer_exchanges
FOR ALL TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

-- 10. Update settings RLS: only admin manages, public read via view
DROP POLICY IF EXISTS "Users manage own settings" ON public.settings;
CREATE POLICY "Admin manages settings" ON public.settings
FOR ALL TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Public read settings for catalog" ON public.settings
FOR SELECT TO anon
USING (true);

-- 11. Update sales RLS: admin = all, vendedor = insert + select own
DROP POLICY IF EXISTS "Users manage own sales" ON public.sales;
CREATE POLICY "Admin manages all sales" ON public.sales
FOR ALL TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Vendedor can insert own sales" ON public.sales
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'vendedor');

CREATE POLICY "Vendedor can select own sales" ON public.sales
FOR SELECT TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'vendedor');

-- 12. Update debts RLS: admin = all, vendedor = select own
DROP POLICY IF EXISTS "Users manage own debts" ON public.debts;
CREATE POLICY "Admin manages all debts" ON public.debts
FOR ALL TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Vendedor can select own debts" ON public.debts
FOR SELECT TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'vendedor');

-- 13. Allow authenticated users to read products (for vendedor dashboard)
CREATE POLICY "Authenticated read products" ON public.products
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- 14. Allow authenticated users to read settings (for app config)
CREATE POLICY "Authenticated read settings" ON public.settings
FOR SELECT TO authenticated
USING (auth.uid() = user_id);
