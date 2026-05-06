-- ============================================================
-- GESTIONA -- MIGRATION BUNDLE COMPLETO
-- Generado: 2026-05-06
-- Proyecto destino: hummeopatkniwkyrrhwc
-- INSTRUCCIONES: Pegar completo en Supabase SQL Editor y ejecutar
-- ============================================================

-- == MIGRATION: 20260405225853_bd342e54-5ea6-4ecc-b4b8-2fed42309a84.sql ==

-- Create role enum
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'vendedor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Timestamp update function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- User roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Auto-assign admin to first user
CREATE OR REPLACE FUNCTION public.auto_assign_admin()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.user_id, 'admin');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS auto_admin_on_first_profile ON public.profiles;
CREATE TRIGGER auto_admin_on_first_profile
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.auto_assign_admin();

-- Products
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'perfume_arabe',
  gender TEXT NOT NULL DEFAULT 'unisex',
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  customs_fee NUMERIC NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC NOT NULL DEFAULT 0,
  sale_price_ars NUMERIC NOT NULL DEFAULT 0,
  discount_price_ars NUMERIC,
  profit_per_unit_ars NUMERIC NOT NULL DEFAULT 0,
  profit_per_unit_usd NUMERIC NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own products" ON public.products;
CREATE POLICY "Users manage own products" ON public.products FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_products_updated_at ON public.products;
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Purchases
CREATE TABLE IF NOT EXISTS public.purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_cost_usd NUMERIC NOT NULL DEFAULT 0,
  customs_fee NUMERIC NOT NULL DEFAULT 0,
  total_usd NUMERIC NOT NULL DEFAULT 0,
  exchange_rate NUMERIC NOT NULL DEFAULT 0,
  total_ars NUMERIC NOT NULL DEFAULT 0,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  supplier TEXT,
  batch_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own purchases" ON public.purchases;
CREATE POLICY "Users manage own purchases" ON public.purchases FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Sales
CREATE TABLE IF NOT EXISTS public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  unit_price_ars NUMERIC NOT NULL DEFAULT 0,
  discount_applied BOOLEAN NOT NULL DEFAULT false,
  total_ars NUMERIC NOT NULL DEFAULT 0,
  cost_per_unit_usd NUMERIC NOT NULL DEFAULT 0,
  profit_ars NUMERIC NOT NULL DEFAULT 0,
  profit_usd NUMERIC NOT NULL DEFAULT 0,
  customer_name TEXT,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own sales" ON public.sales;
CREATE POLICY "Users manage own sales" ON public.sales FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Debts
CREATE TABLE IF NOT EXISTS public.debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  amount_ars NUMERIC NOT NULL DEFAULT 0,
  paid_ars NUMERIC NOT NULL DEFAULT 0,
  remaining_ars NUMERIC NOT NULL DEFAULT 0,
  description TEXT,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own debts" ON public.debts;
CREATE POLICY "Users manage own debts" ON public.debts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_debts_updated_at ON public.debts;
CREATE TRIGGER update_debts_updated_at BEFORE UPDATE ON public.debts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Marketing posts
CREATE TABLE IF NOT EXISTS public.marketing_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  post_type TEXT NOT NULL DEFAULT 'post' CHECK (post_type IN ('post', 'story', 'reel')),
  platform TEXT NOT NULL DEFAULT 'instagram',
  hashtags TEXT[],
  image_url TEXT,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published')),
  ai_generated BOOLEAN NOT NULL DEFAULT false,
  product_ids UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.marketing_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own posts" ON public.marketing_posts;
CREATE POLICY "Users manage own posts" ON public.marketing_posts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_marketing_posts_updated_at ON public.marketing_posts;
CREATE TRIGGER update_marketing_posts_updated_at BEFORE UPDATE ON public.marketing_posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Settings
CREATE TABLE IF NOT EXISTS public.settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  exchange_rate NUMERIC NOT NULL DEFAULT 1695,
  customs_percent NUMERIC NOT NULL DEFAULT 15,
  default_discount_percent NUMERIC NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own settings" ON public.settings;
CREATE POLICY "Users manage own settings" ON public.settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_settings_updated_at ON public.settings;
CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for marketing images
INSERT INTO storage.buckets (id, name, public) VALUES ('marketing-images', 'marketing-images', true) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "Authenticated users can upload marketing images" ON storage.objects;
CREATE POLICY "Authenticated users can upload marketing images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'marketing-images');
DROP POLICY IF EXISTS "Anyone can view marketing images" ON storage.objects;
CREATE POLICY "Anyone can view marketing images" ON storage.objects FOR SELECT USING (bucket_id = 'marketing-images');
DROP POLICY IF EXISTS "Users can delete own marketing images" ON storage.objects;
CREATE POLICY "Users can delete own marketing images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'marketing-images');

-- == MIGRATION: 20260406054307_c81dc09b-fa16-421f-9ce6-20ac29cafc14.sql ==

ALTER TABLE public.settings 
  ADD COLUMN IF NOT EXISTS tax_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_iva_percent numeric NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS tax_iibb_percent numeric NOT NULL DEFAULT 3.5,
  ADD COLUMN IF NOT EXISTS tax_monotributo_monthly numeric NOT NULL DEFAULT 0;

-- == MIGRATION: 20260406223605_87e8224f-a5e6-479c-8f41-f79f6dcca7b6.sql ==

ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS business_name text DEFAULT 'Exentry Imports',
ADD COLUMN IF NOT EXISTS logo_url text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS primary_color text DEFAULT '#D4A843',
ADD COLUMN IF NOT EXISTS secondary_color text DEFAULT '#1A1A2E';

-- == MIGRATION: 20260407041127_d9933db9-50d8-4252-b729-4371e8841f61.sql ==

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their own logs
DROP POLICY IF EXISTS "Users can view own audit logs" ON public.audit_logs;
CREATE POLICY "Users can view own audit logs"
ON public.audit_logs FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can insert their own logs
DROP POLICY IF EXISTS "Users can insert own audit logs" ON public.audit_logs;
CREATE POLICY "Users can insert own audit logs"
ON public.audit_logs FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Admins can view all logs
DROP POLICY IF EXISTS "Admins can view all audit logs" ON public.audit_logs;
CREATE POLICY "Admins can view all audit logs"
ON public.audit_logs FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_logs;

-- CREATE INDEX IF NOT EXISTS for faster queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- == MIGRATION: 20260407050324_47008d56-d272-40f2-8d12-54e51de6380f.sql ==

CREATE TABLE IF NOT EXISTS public.influencer_exchanges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  influencer_name TEXT NOT NULL,
  influencer_instagram TEXT,
  influencer_followers INTEGER DEFAULT 0,
  product_id UUID,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  product_value_ars NUMERIC NOT NULL DEFAULT 0,
  exchange_type TEXT NOT NULL DEFAULT 'canje',
  status TEXT NOT NULL DEFAULT 'pendiente',
  expected_posts INTEGER DEFAULT 1,
  actual_posts INTEGER DEFAULT 0,
  notes TEXT,
  delivery_date TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.influencer_exchanges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own exchanges" ON public.influencer_exchanges;
CREATE POLICY "Users manage own exchanges"
  ON public.influencer_exchanges FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_influencer_exchanges_updated_at ON public.influencer_exchanges;
CREATE TRIGGER update_influencer_exchanges_updated_at
  BEFORE UPDATE ON public.influencer_exchanges
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- == MIGRATION: 20260407211631_e6570046-328a-49d6-928a-660b4f632a20.sql ==

-- Add payment_method to sales
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'efectivo';

-- Add image_url to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add discount percentages by payment method to settings
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS discount_cash_percent NUMERIC NOT NULL DEFAULT 10;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS discount_transfer_percent NUMERIC NOT NULL DEFAULT 5;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS discount_debit_percent NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS discount_credit_percent NUMERIC NOT NULL DEFAULT 0;

-- == MIGRATION: 20260407213544_d0a15beb-bd1e-489c-8fa9-d86d2a77521b.sql ==

DROP POLICY IF EXISTS "Public can read products" ON public.products;
CREATE POLICY "Public can read products" ON public.products FOR SELECT USING (true);
DROP POLICY IF EXISTS "Public can read settings" ON public.settings;
CREATE POLICY "Public can read settings" ON public.settings FOR SELECT USING (true);

-- == MIGRATION: 20260407215031_6308848b-4a1a-41d0-8a38-f405924e904d.sql ==

ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
ALTER PUBLICATION supabase_realtime ADD TABLE public.settings;

-- == MIGRATION: 20260407234552_dad31cb4-567e-4f55-8011-bc3eb8f8fbec.sql ==

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
DROP POLICY IF EXISTS "Admin manages products" ON public.products;
CREATE POLICY "Admin manages products" ON public.products
FOR ALL TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

-- Allow public SELECT on products_public view (needs base table read for security_invoker)
DROP POLICY IF EXISTS "Public read products for catalog" ON public.products;
CREATE POLICY "Public read products for catalog" ON public.products
FOR SELECT TO anon
USING (true);

-- 7. Update purchases RLS: only admin
DROP POLICY IF EXISTS "Users manage own purchases" ON public.purchases;
DROP POLICY IF EXISTS "Admin manages purchases" ON public.purchases;
CREATE POLICY "Admin manages purchases" ON public.purchases
FOR ALL TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

-- 8. Update marketing_posts RLS: only admin
DROP POLICY IF EXISTS "Users manage own posts" ON public.marketing_posts;
DROP POLICY IF EXISTS "Admin manages marketing" ON public.marketing_posts;
CREATE POLICY "Admin manages marketing" ON public.marketing_posts
FOR ALL TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

-- 9. Update influencer_exchanges RLS: only admin
DROP POLICY IF EXISTS "Users manage own exchanges" ON public.influencer_exchanges;
DROP POLICY IF EXISTS "Admin manages exchanges" ON public.influencer_exchanges;
CREATE POLICY "Admin manages exchanges" ON public.influencer_exchanges
FOR ALL TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

-- 10. Update settings RLS: only admin manages, public read via view
DROP POLICY IF EXISTS "Users manage own settings" ON public.settings;
DROP POLICY IF EXISTS "Admin manages settings" ON public.settings;
CREATE POLICY "Admin manages settings" ON public.settings
FOR ALL TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Public read settings for catalog" ON public.settings;
CREATE POLICY "Public read settings for catalog" ON public.settings
FOR SELECT TO anon
USING (true);

-- 11. Update sales RLS: admin = all, vendedor = insert + select own
DROP POLICY IF EXISTS "Users manage own sales" ON public.sales;
DROP POLICY IF EXISTS "Admin manages all sales" ON public.sales;
CREATE POLICY "Admin manages all sales" ON public.sales
FOR ALL TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Vendedor can insert own sales" ON public.sales;
CREATE POLICY "Vendedor can insert own sales" ON public.sales
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'vendedor');

DROP POLICY IF EXISTS "Vendedor can select own sales" ON public.sales;
CREATE POLICY "Vendedor can select own sales" ON public.sales
FOR SELECT TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'vendedor');

-- 12. Update debts RLS: admin = all, vendedor = select own
DROP POLICY IF EXISTS "Users manage own debts" ON public.debts;
DROP POLICY IF EXISTS "Admin manages all debts" ON public.debts;
CREATE POLICY "Admin manages all debts" ON public.debts
FOR ALL TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Vendedor can select own debts" ON public.debts;
CREATE POLICY "Vendedor can select own debts" ON public.debts
FOR SELECT TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'vendedor');

-- 13. Allow authenticated users to read products (for vendedor dashboard)
DROP POLICY IF EXISTS "Authenticated read products" ON public.products;
CREATE POLICY "Authenticated read products" ON public.products
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- 14. Allow authenticated users to read settings (for app config)
DROP POLICY IF EXISTS "Authenticated read settings" ON public.settings;
CREATE POLICY "Authenticated read settings" ON public.settings
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- == MIGRATION: 20260407234611_598da6bd-edd5-4c70-86d4-2daf59625686.sql ==

-- Fix security definer views by recreating with security_invoker
DROP VIEW IF EXISTS public.products_public;
CREATE OR REPLACE VIEW public.products_public
WITH (security_invoker = on) AS
SELECT id, user_id, name, brand, category, gender,
       sale_price_ars, discount_price_ars, stock,
       description, image_url
FROM public.products;

DROP VIEW IF EXISTS public.settings_public;
CREATE OR REPLACE VIEW public.settings_public
WITH (security_invoker = on) AS
SELECT id, user_id, business_name, logo_url, primary_color, secondary_color
FROM public.settings;

-- == MIGRATION: 20260407235045_88a0c20f-6adc-45a7-aff0-be798ebbf7fb.sql ==

-- Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'sistema',
  read boolean NOT NULL DEFAULT false,
  entity_type text,
  entity_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own notifications" ON public.notifications;
CREATE POLICY "Users manage own notifications" ON public.notifications
FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Index for fast queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id, read, created_at DESC);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Function: auto-create low stock notification when product stock changes
CREATE OR REPLACE FUNCTION public.notify_low_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock <= 3 AND (OLD.stock IS NULL OR OLD.stock > 3) THEN
    INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
    VALUES (
      NEW.user_id,
      'Stock bajo: ' || NEW.name,
      CASE WHEN NEW.stock = 0 THEN 'Sin stock disponible'
           ELSE 'Solo quedan ' || NEW.stock || ' unidades'
      END,
      'stock_bajo',
      'product',
      NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_low_stock ON public.products;
CREATE TRIGGER trg_notify_low_stock
AFTER UPDATE OF stock ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.notify_low_stock();

-- Function: notify on large sale (> $50,000 ARS)
CREATE OR REPLACE FUNCTION public.notify_large_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.total_ars >= 50000 THEN
    INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
    VALUES (
      NEW.user_id,
      'Venta grande registrada',
      NEW.product_name || ' x' || NEW.quantity || ' — $' || ROUND(NEW.total_ars) || ' ARS',
      'venta_grande',
      'sale',
      NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_large_sale ON public.sales;
CREATE TRIGGER trg_notify_large_sale
AFTER INSERT ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.notify_large_sale();

-- Function: notify overdue debts (triggered manually or via cron)
CREATE OR REPLACE FUNCTION public.check_overdue_debts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d RECORD;
BEGIN
  FOR d IN 
    SELECT id, user_id, customer_name, amount_ars, due_date
    FROM public.debts
    WHERE status = 'pending' AND due_date < now() AND due_date > now() - interval '1 day'
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
    VALUES (
      d.user_id,
      'Deuda vencida: ' || d.customer_name,
      'Monto: $' || ROUND(d.amount_ars) || ' ARS — Venció ' || to_char(d.due_date, 'DD/MM/YYYY'),
      'deuda_vencida',
      'debt',
      d.id::text
    );
  END LOOP;
END;
$$;

-- == MIGRATION: 20260408000812_12688b66-f72f-4e41-8844-1ee581917555.sql ==

-- Create storage bucket for product images
INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true) ON CONFLICT (id) DO NOTHING;

-- Public read access
DROP POLICY IF EXISTS "Product images are publicly accessible" ON storage.objects;
CREATE POLICY "Product images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'product-images');

-- Authenticated users can upload
DROP POLICY IF EXISTS "Authenticated users can upload product images" ON storage.objects;
CREATE POLICY "Authenticated users can upload product images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'product-images');

-- Authenticated users can update their uploads
DROP POLICY IF EXISTS "Authenticated users can update product images" ON storage.objects;
CREATE POLICY "Authenticated users can update product images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'product-images');

-- Authenticated users can delete their uploads
DROP POLICY IF EXISTS "Authenticated users can delete product images" ON storage.objects;
CREATE POLICY "Authenticated users can delete product images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'product-images');

-- == MIGRATION: 20260408002327_cb9c022d-6f9f-4464-8d08-d2bf51c52feb.sql ==

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS whatsapp_number text DEFAULT NULL;

CREATE OR REPLACE VIEW public.settings_public AS
SELECT id, user_id, business_name, logo_url, primary_color, secondary_color, whatsapp_number
FROM public.settings;

-- == MIGRATION: 20260408004124_3780cf19-d6e3-46bc-a1fc-b33d9f31037a.sql ==

-- 1. Fix settings: remove anon policy on base table
DROP POLICY IF EXISTS "Public read settings for catalog" ON public.settings;

-- 2. Fix profiles: restrict to own profile + admin
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'));

-- 3. Fix storage product-images: add owner check
DROP POLICY IF EXISTS "Authenticated users can update product images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update product images" ON storage.objects;
CREATE POLICY "Authenticated users can update product images" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND owner_id::uuid = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can delete product images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete product images" ON storage.objects;
CREATE POLICY "Authenticated users can delete product images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND owner_id::uuid = auth.uid());

-- 4. Fix storage marketing-images: add owner check to delete
DROP POLICY IF EXISTS "Users can delete own marketing images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own marketing images" ON storage.objects;
CREATE POLICY "Users can delete own marketing images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'marketing-images' AND owner_id::uuid = auth.uid());

-- 5. Fix security definer views: recreate as security invoker
DROP VIEW IF EXISTS public.products_public;
CREATE OR REPLACE VIEW public.products_public
WITH (security_invoker = true)
AS SELECT id, user_id, name, brand, category, gender, description, image_url, sale_price_ars, discount_price_ars, stock
FROM public.products;

DROP VIEW IF EXISTS public.settings_public;
CREATE OR REPLACE VIEW public.settings_public
WITH (security_invoker = true)
AS SELECT id, user_id, business_name, logo_url, primary_color, secondary_color, whatsapp_number
FROM public.settings;

-- Grant anon access to the public views
GRANT SELECT ON public.products_public TO anon;
GRANT SELECT ON public.settings_public TO anon;
GRANT SELECT ON public.products_public TO authenticated;
GRANT SELECT ON public.settings_public TO authenticated;

-- == MIGRATION: 20260408005627_0e2d09ad-8ebd-48ce-95b7-8d14b581fa83.sql ==

-- 1. Allow anonymous users to read settings (needed for public catalog)
DROP POLICY IF EXISTS "Public read settings for catalog" ON public.settings;
CREATE POLICY "Public read settings for catalog"
ON public.settings FOR SELECT TO anon
USING (true);

-- 2. Clean up duplicate roles: keep only the latest one per user
DELETE FROM public.user_roles a
USING public.user_roles b
WHERE a.user_id = b.user_id
  AND a.id < b.id;

-- 3. Drop existing unique constraint if any, then add one to prevent future duplicates
DO $$
BEGIN
  -- Drop the old unique constraint on (user_id, role) if it exists
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_id_role_key') THEN
    ALTER TABLE public.user_roles DROP CONSTRAINT user_roles_user_id_role_key;
  END IF;
END $$;

-- Add unique constraint on user_id only (one role per user)
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_unique UNIQUE (user_id);

-- == MIGRATION: 20260410044751_15c0317f-1d1d-467c-8e83-67ac2c35a6ec.sql ==

-- Add featured and offer expiration columns to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;

-- Drop and recreate the products_public view with new fields
DROP VIEW IF EXISTS public.products_public;
CREATE OR REPLACE VIEW public.products_public AS
SELECT id, user_id, name, brand, category, gender, sale_price_ars, discount_price_ars, stock, image_url, description, featured, offer_expires_at
FROM public.products;

-- == MIGRATION: 20260411031049_4adab9e3-89e4-44d8-b819-abf120eda36a.sql ==

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
CREATE OR REPLACE VIEW public.products_public AS
SELECT id, user_id, name, brand, category, gender, sale_price_ars, discount_price_ars, stock, image_url, description, featured, offer_expires_at, content_ml, total_sold
FROM public.products;

-- == MIGRATION: 20260414024010_0946838b-b591-498d-a2fb-84bbb2ed4740.sql ==

-- ========= COUPONS TABLE =========
CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  code TEXT NOT NULL,
  discount_percent NUMERIC DEFAULT 0,
  discount_fixed_ars NUMERIC DEFAULT 0,
  max_uses INTEGER DEFAULT NULL,
  current_uses INTEGER NOT NULL DEFAULT 0,
  valid_from TIMESTAMP WITH TIME ZONE DEFAULT now(),
  valid_until TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT coupons_code_user_unique UNIQUE (user_id, code)
);

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manages coupons" ON public.coupons;
CREATE POLICY "Admin manages coupons"
  ON public.coupons FOR ALL
  TO authenticated
  USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
  WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Anon can read active coupons" ON public.coupons;
CREATE POLICY "Anon can read active coupons"
  ON public.coupons FOR SELECT
  TO anon
  USING (active = true);

DROP POLICY IF EXISTS "Authenticated can read own coupons" ON public.coupons;
CREATE POLICY "Authenticated can read own coupons"
  ON public.coupons FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ========= SELLER GOALS TABLE =========
CREATE TABLE IF NOT EXISTS public.seller_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  month DATE NOT NULL,
  target_ars NUMERIC NOT NULL DEFAULT 0,
  commission_percent NUMERIC NOT NULL DEFAULT 0,
  total_sales_ars NUMERIC NOT NULL DEFAULT 0,
  total_commission_ars NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT seller_goals_user_month_unique UNIQUE (user_id, month)
);

ALTER TABLE public.seller_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manages all seller goals" ON public.seller_goals;
CREATE POLICY "Admin manages all seller goals"
  ON public.seller_goals FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) = 'admin' AND auth.uid() = owner_id)
  WITH CHECK (get_user_role(auth.uid()) = 'admin' AND auth.uid() = owner_id);

DROP POLICY IF EXISTS "Sellers can view own goals" ON public.seller_goals;
CREATE POLICY "Sellers can view own goals"
  ON public.seller_goals FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ========= ADD coupon_id TO SALES =========
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS coupon_id UUID DEFAULT NULL;

-- == MIGRATION: 20260415133436_345cf1c2-29ea-4a04-98cc-f53a01f78f28.sql ==

-- Create product_variants table
CREATE TABLE IF NOT EXISTS public.product_variants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  variant_name TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  sku TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_product_variant UNIQUE (product_id, variant_name)
);

-- Enable RLS
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS "Admin manages variants" ON public.product_variants;
CREATE POLICY "Admin manages variants"
ON public.product_variants FOR ALL
TO authenticated
USING (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin')
WITH CHECK (auth.uid() = user_id AND get_user_role(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Authenticated read own variants" ON public.product_variants;
CREATE POLICY "Authenticated read own variants"
ON public.product_variants FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public read active variants" ON public.product_variants;
CREATE POLICY "Public read active variants"
ON public.product_variants FOR SELECT
TO anon
USING (active = true);

-- Add variant_id to sales
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON public.product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_variant_id ON public.sales(variant_id);

-- == MIGRATION: 20260417014428_05d475d6-e8f0-41f8-b421-e5fbc0e6c31f.sql ==

-- Tabla de gastos operativos
CREATE TABLE IF NOT EXISTS public.expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  amount_ars NUMERIC NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'otros',
  description TEXT,
  date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  recurring BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manages expenses" ON public.expenses;
CREATE POLICY "Admin manages expenses"
ON public.expenses
FOR ALL
TO authenticated
USING ((auth.uid() = user_id) AND (get_user_role(auth.uid()) = 'admin'::text))
WITH CHECK ((auth.uid() = user_id) AND (get_user_role(auth.uid()) = 'admin'::text));

DROP TRIGGER IF EXISTS update_expenses_updated_at ON public.expenses;
CREATE TRIGGER update_expenses_updated_at
BEFORE UPDATE ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON public.expenses(user_id, date DESC);

-- Tabla de notas por cliente
CREATE TABLE IF NOT EXISTS public.customer_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  customer_name TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, customer_name)
);

ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manages customer notes" ON public.customer_notes;
CREATE POLICY "Admin manages customer notes"
ON public.customer_notes
FOR ALL
TO authenticated
USING ((auth.uid() = user_id) AND (get_user_role(auth.uid()) = 'admin'::text))
WITH CHECK ((auth.uid() = user_id) AND (get_user_role(auth.uid()) = 'admin'::text));

DROP TRIGGER IF EXISTS update_customer_notes_updated_at ON public.customer_notes;
CREATE TRIGGER update_customer_notes_updated_at
BEFORE UPDATE ON public.customer_notes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- == MIGRATION: 20260418230434_65d425f2-875c-4b55-9410-11bf23b90ee0.sql ==

-- 1. Ampliar tabla settings con columnas de configuración
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS initial_cash_ars numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS large_sale_threshold_ars numeric NOT NULL DEFAULT 50000,
  ADD COLUMN IF NOT EXISTS margin_alert_percent numeric NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS expense_ratio_alert_percent numeric NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS overdue_check_window_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS cash_flow_warning_threshold_ars numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_categories jsonb NOT NULL DEFAULT '["alquiler","servicios","marketing","sueldos","logistica","impuestos","otros"]'::jsonb,
  ADD COLUMN IF NOT EXISTS pasero_commission_percent numeric NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS usd_rate_oficial numeric,
  ADD COLUMN IF NOT EXISTS usd_rate_blue numeric,
  ADD COLUMN IF NOT EXISTS usd_rate_mep numeric,
  ADD COLUMN IF NOT EXISTS usd_rate_updated_at timestamp with time zone;

-- 2. Compras programadas
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS scheduled_date timestamp with time zone,
  ADD COLUMN IF NOT EXISTS is_scheduled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_purchases_scheduled ON public.purchases(user_id, scheduled_date) WHERE is_scheduled = true;

-- 3. Refactor: notify_low_stock lee threshold desde settings
CREATE OR REPLACE FUNCTION public.notify_low_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  threshold integer;
BEGIN
  SELECT COALESCE(low_stock_threshold, 3) INTO threshold
  FROM public.settings WHERE user_id = NEW.user_id LIMIT 1;
  IF threshold IS NULL THEN threshold := 3; END IF;

  IF NEW.stock <= threshold AND (OLD.stock IS NULL OR OLD.stock > threshold) THEN
    INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
    VALUES (
      NEW.user_id,
      'Stock bajo: ' || NEW.name,
      CASE WHEN NEW.stock = 0 THEN 'Sin stock disponible'
           ELSE 'Solo quedan ' || NEW.stock || ' unidades'
      END,
      'stock_bajo',
      'product',
      NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- 4. Refactor: notify_large_sale lee threshold desde settings
CREATE OR REPLACE FUNCTION public.notify_large_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  threshold numeric;
BEGIN
  SELECT COALESCE(large_sale_threshold_ars, 50000) INTO threshold
  FROM public.settings WHERE user_id = NEW.user_id LIMIT 1;
  IF threshold IS NULL THEN threshold := 50000; END IF;

  IF NEW.total_ars >= threshold THEN
    INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
    VALUES (
      NEW.user_id,
      'Venta grande registrada',
      NEW.product_name || ' x' || NEW.quantity || ' — $' || ROUND(NEW.total_ars) || ' ARS',
      'venta_grande',
      'sale',
      NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- 5. Refactor: check_overdue_debts usa ventana configurable por usuario
CREATE OR REPLACE FUNCTION public.check_overdue_debts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d RECORD;
  window_hours integer;
BEGIN
  FOR d IN 
    SELECT dt.id, dt.user_id, dt.customer_name, dt.amount_ars, dt.due_date,
           COALESCE(s.overdue_check_window_hours, 24) AS uw
    FROM public.debts dt
    LEFT JOIN public.settings s ON s.user_id = dt.user_id
    WHERE dt.status IN ('pending','partial')
      AND dt.due_date IS NOT NULL
      AND dt.due_date < now()
  LOOP
    window_hours := d.uw;
    IF d.due_date > now() - make_interval(hours => window_hours) THEN
      INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
      VALUES (
        d.user_id,
        'Deuda vencida: ' || d.customer_name,
        'Monto: $' || ROUND(d.amount_ars) || ' ARS — Venció ' || to_char(d.due_date, 'DD/MM/YYYY'),
        'deuda_vencida',
        'debt',
        d.id::text
      );
    END IF;
  END LOOP;
END;
$function$;

-- 6. Asegurar triggers existentes
DROP TRIGGER IF EXISTS trg_notify_low_stock ON public.products;
DROP TRIGGER IF EXISTS trg_notify_low_stock ON public.products;
CREATE TRIGGER trg_notify_low_stock
AFTER UPDATE OF stock ON public.products
FOR EACH ROW EXECUTE FUNCTION public.notify_low_stock();

DROP TRIGGER IF EXISTS trg_notify_large_sale ON public.sales;
DROP TRIGGER IF EXISTS trg_notify_large_sale ON public.sales;
CREATE TRIGGER trg_notify_large_sale
AFTER INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.notify_large_sale();

-- 7. Reparación legacy: marcar como pagadas todas las ventas cuyas deudas están en status='paid'
UPDATE public.sales s
SET paid = true
FROM public.debts d
WHERE d.sale_id = s.id
  AND d.status = 'paid'
  AND s.paid = false;

-- 8. Bucket de backups
INSERT INTO storage.buckets (id, name, public)
VALUES ('backups', 'backups', false)
ON CONFLICT (id) DO NOTHING;

-- Políticas: solo admins pueden ver/descargar/borrar backups dentro de su carpeta user_id
DROP POLICY IF EXISTS "Admin read own backups" ON storage.objects;
DROP POLICY IF EXISTS "Admin read own backups" ON storage.objects;
CREATE POLICY "Admin read own backups" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'backups'
  AND (auth.uid()::text = (storage.foldername(name))[1])
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

DROP POLICY IF EXISTS "Admin write own backups" ON storage.objects;
DROP POLICY IF EXISTS "Admin write own backups" ON storage.objects;
CREATE POLICY "Admin write own backups" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'backups'
  AND (auth.uid()::text = (storage.foldername(name))[1])
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

DROP POLICY IF EXISTS "Admin delete own backups" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete own backups" ON storage.objects;
CREATE POLICY "Admin delete own backups" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'backups'
  AND (auth.uid()::text = (storage.foldername(name))[1])
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- Permitir que el service role (edge functions) pueda escribir backups (bypassa RLS naturalmente)
-- 9. Habilitar pg_cron y pg_net para jobs programados
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- == MIGRATION: 20260421111259_3716c58c-698d-4721-a584-6a9febe970e4.sql ==

-- ============================================================================
-- GESTIONA SAAS — MIGRACIÓN MULTI-TENANT
-- ============================================================================

-- 1. ENUMS NUEVOS
DO $$ BEGIN
  CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'vendedor', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'paused');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 2. TABLAS NUEVAS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  price_usd_monthly numeric NOT NULL DEFAULT 0,
  price_usd_yearly numeric NOT NULL DEFAULT 0,
  stripe_price_id_monthly text,
  stripe_price_id_yearly text,
  max_products integer,
  max_sales_per_month integer,
  max_users integer,
  ai_enabled boolean NOT NULL DEFAULT false,
  backups_enabled boolean NOT NULL DEFAULT false,
  custom_branding boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plans (code, name, description, price_usd_monthly, price_usd_yearly, max_products, max_sales_per_month, max_users, ai_enabled, backups_enabled, custom_branding, sort_order)
VALUES
  ('trial', 'Trial', '14 días gratis con todo incluido', 0, 0, NULL, NULL, 3, true, true, true, 0),
  ('starter', 'Starter', 'Para empezar tu negocio', 29, 290, 100, 500, 2, false, false, false, 1),
  ('pro', 'Pro', 'Para negocios en crecimiento', 79, 790, 1000, 5000, 5, true, true, true, 2),
  ('business', 'Business', 'Sin límites para empresas', 199, 1990, NULL, NULL, NULL, true, true, true, 3)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  primary_color text DEFAULT '#D4A843',
  secondary_color text DEFAULT '#1A1A2E',
  owner_user_id uuid NOT NULL,
  plan_id uuid REFERENCES public.plans(id),
  trial_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON public.organizations(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON public.organizations(slug);

CREATE TABLE IF NOT EXISTS public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.org_role NOT NULL DEFAULT 'viewer',
  invited_by uuid,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON public.memberships(org_id);

CREATE TABLE IF NOT EXISTS public.org_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.org_role NOT NULL DEFAULT 'viewer',
  token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invited_by uuid NOT NULL,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.org_invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.org_invitations(token);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  status public.subscription_status NOT NULL DEFAULT 'trialing',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid
);

-- ============================================================================
-- 3. FUNCIONES HELPER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_org_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.memberships WHERE org_id = _org_id AND user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.get_org_role(_org_id uuid, _user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role::text FROM public.memberships WHERE org_id = _org_id AND user_id = _user_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(_org_id uuid, _user_id uuid, _roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.memberships
    WHERE org_id = _org_id AND user_id = _user_id AND role::text = ANY(_roles)
  )
$$;

CREATE OR REPLACE FUNCTION public.user_org_ids(_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.memberships WHERE user_id = _user_id
$$;

-- Trigger: actualizar updated_at en organizations
DROP TRIGGER IF EXISTS trg_organizations_updated_at ON public.organizations;
DROP TRIGGER IF EXISTS trg_organizations_updated_at ON public.organizations;
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-generación de slug
CREATE OR REPLACE FUNCTION public.generate_org_slug(_name text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  base_slug text;
  candidate text;
  counter int := 0;
BEGIN
  base_slug := lower(regexp_replace(unaccent(_name), '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);
  IF base_slug = '' OR base_slug IS NULL THEN base_slug := 'org'; END IF;
  candidate := base_slug;
  WHILE EXISTS(SELECT 1 FROM public.organizations WHERE slug = candidate) LOOP
    counter := counter + 1;
    candidate := base_slug || '-' || counter;
  END LOOP;
  RETURN candidate;
END;
$$;

-- Habilitar extensión unaccent si no existe (para slugs limpios)
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ============================================================================
-- 4. AGREGAR org_id A TABLAS EXISTENTES
-- ============================================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.customer_notes ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.marketing_posts ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.influencer_exchanges ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.seller_goals ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS org_id uuid;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS org_id uuid;

-- ============================================================================
-- 5. BACKFILL: una organización por cada usuario existente
-- ============================================================================

DO $$
DECLARE
  u RECORD;
  new_org_id uuid;
  display_name text;
  trial_plan_id uuid;
BEGIN
  SELECT id INTO trial_plan_id FROM public.plans WHERE code = 'trial' LIMIT 1;

  FOR u IN
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM public.products
      UNION SELECT user_id FROM public.sales
      UNION SELECT user_id FROM public.settings
      UNION SELECT user_id FROM public.profiles
    ) AS all_users WHERE user_id IS NOT NULL
  LOOP
    -- skip if user already has an org via membership
    IF EXISTS(SELECT 1 FROM public.memberships WHERE user_id = u.user_id) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(p.display_name, s.business_name, 'Mi Negocio')
      INTO display_name
      FROM public.profiles p
      LEFT JOIN public.settings s ON s.user_id = u.user_id
      WHERE p.user_id = u.user_id LIMIT 1;
    IF display_name IS NULL THEN display_name := 'Mi Negocio'; END IF;

    INSERT INTO public.organizations (name, slug, owner_user_id, plan_id, trial_ends_at)
    VALUES (display_name, public.generate_org_slug(display_name), u.user_id, trial_plan_id, now() + interval '14 days')
    RETURNING id INTO new_org_id;

    INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (new_org_id, u.user_id, 'owner');

    INSERT INTO public.subscriptions (org_id, plan_id, status, current_period_end)
    VALUES (new_org_id, trial_plan_id, 'trialing', now() + interval '14 days');

    -- backfill org_id en todas las tablas
    UPDATE public.products SET org_id = new_org_id WHERE user_id = u.user_id AND org_id IS NULL;
    UPDATE public.sales SET org_id = new_org_id WHERE user_id = u.user_id AND org_id IS NULL;
    UPDATE public.purchases SET org_id = new_org_id WHERE user_id = u.user_id AND org_id IS NULL;
    UPDATE public.debts SET org_id = new_org_id WHERE user_id = u.user_id AND org_id IS NULL;
    UPDATE public.expenses SET org_id = new_org_id WHERE user_id = u.user_id AND org_id IS NULL;
    UPDATE public.settings SET org_id = new_org_id WHERE user_id = u.user_id AND org_id IS NULL;
    UPDATE public.customer_notes SET org_id = new_org_id WHERE user_id = u.user_id AND org_id IS NULL;
    UPDATE public.marketing_posts SET org_id = new_org_id WHERE user_id = u.user_id AND org_id IS NULL;
    UPDATE public.influencer_exchanges SET org_id = new_org_id WHERE user_id = u.user_id AND org_id IS NULL;
    UPDATE public.coupons SET org_id = new_org_id WHERE user_id = u.user_id AND org_id IS NULL;
    UPDATE public.product_variants SET org_id = new_org_id WHERE user_id = u.user_id AND org_id IS NULL;
    UPDATE public.seller_goals SET org_id = new_org_id WHERE owner_id = u.user_id AND org_id IS NULL;
    UPDATE public.audit_logs SET org_id = new_org_id WHERE user_id = u.user_id AND org_id IS NULL;
    UPDATE public.notifications SET org_id = new_org_id WHERE user_id = u.user_id AND org_id IS NULL;

    -- Si el usuario era admin en user_roles legacy, dejarlo como owner (ya creado).
    -- Si era vendedor, agregarlo también como vendedor del owner anterior (no aplica acá: cada user es su propia org).
  END LOOP;

  -- Promover el primer usuario a platform_admin si no hay ninguno
  IF NOT EXISTS(SELECT 1 FROM public.platform_admins) THEN
    INSERT INTO public.platform_admins (user_id)
    SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- 6. CONSTRAINTS NOT NULL en org_id (después del backfill)
-- ============================================================================

ALTER TABLE public.products ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.sales ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.purchases ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.debts ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.expenses ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.settings ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.customer_notes ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.marketing_posts ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.influencer_exchanges ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.coupons ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.product_variants ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.seller_goals ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.notifications ALTER COLUMN org_id SET NOT NULL;
-- audit_logs no se fuerza NOT NULL (logs antiguos)

-- Foreign keys
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_org_id_fkey;
ALTER TABLE public.products ADD CONSTRAINT products_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_org_id_fkey;
ALTER TABLE public.sales ADD CONSTRAINT sales_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS purchases_org_id_fkey;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.debts DROP CONSTRAINT IF EXISTS debts_org_id_fkey;
ALTER TABLE public.debts ADD CONSTRAINT debts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_org_id_fkey;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_org_id_fkey;
ALTER TABLE public.settings ADD CONSTRAINT settings_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.customer_notes DROP CONSTRAINT IF EXISTS customer_notes_org_id_fkey;
ALTER TABLE public.customer_notes ADD CONSTRAINT customer_notes_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.marketing_posts DROP CONSTRAINT IF EXISTS marketing_posts_org_id_fkey;
ALTER TABLE public.marketing_posts ADD CONSTRAINT marketing_posts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.influencer_exchanges DROP CONSTRAINT IF EXISTS influencer_exchanges_org_id_fkey;
ALTER TABLE public.influencer_exchanges ADD CONSTRAINT influencer_exchanges_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_org_id_fkey;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.product_variants DROP CONSTRAINT IF EXISTS product_variants_org_id_fkey;
ALTER TABLE public.product_variants ADD CONSTRAINT product_variants_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.seller_goals DROP CONSTRAINT IF EXISTS seller_goals_org_id_fkey;
ALTER TABLE public.seller_goals ADD CONSTRAINT seller_goals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_org_id_fkey;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Settings: ahora una por org (no por user)
ALTER TABLE public.settings DROP CONSTRAINT IF EXISTS settings_org_id_unique;
ALTER TABLE public.settings ADD CONSTRAINT settings_org_id_unique UNIQUE (org_id);

-- Indexes para performance
CREATE INDEX IF NOT EXISTS idx_products_org ON public.products(org_id);
CREATE INDEX IF NOT EXISTS idx_sales_org ON public.sales(org_id);
CREATE INDEX IF NOT EXISTS idx_sales_org_date ON public.sales(org_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_org ON public.purchases(org_id);
CREATE INDEX IF NOT EXISTS idx_debts_org ON public.debts(org_id);
CREATE INDEX IF NOT EXISTS idx_expenses_org ON public.expenses(org_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org ON public.notifications(org_id);

-- ============================================================================
-- 7. RLS EN TABLAS NUEVAS
-- ============================================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- organizations
DROP POLICY IF EXISTS "Members can view their orgs" ON public.organizations;
DROP POLICY IF EXISTS "Members can view their orgs" ON public.organizations;
CREATE POLICY "Members can view their orgs" ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id, auth.uid()) OR public.is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Anyone can view org by slug for public catalog" ON public.organizations;
DROP POLICY IF EXISTS "Anyone can view org by slug for public catalog" ON public.organizations;
CREATE POLICY "Anyone can view org by slug for public catalog" ON public.organizations FOR SELECT TO anon
  USING (true);
DROP POLICY IF EXISTS "Owners and admins can update org" ON public.organizations;
DROP POLICY IF EXISTS "Owners and admins can update org" ON public.organizations;
CREATE POLICY "Owners and admins can update org" ON public.organizations FOR UPDATE TO authenticated
  USING (public.has_org_role(id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Authenticated can create org" ON public.organizations;
DROP POLICY IF EXISTS "Authenticated can create org" ON public.organizations;
CREATE POLICY "Authenticated can create org" ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_user_id);
DROP POLICY IF EXISTS "Only owner can delete org" ON public.organizations;
DROP POLICY IF EXISTS "Only owner can delete org" ON public.organizations;
CREATE POLICY "Only owner can delete org" ON public.organizations FOR DELETE TO authenticated
  USING (auth.uid() = owner_user_id);

-- memberships
DROP POLICY IF EXISTS "Users see memberships of their orgs" ON public.memberships;
DROP POLICY IF EXISTS "Users see memberships of their orgs" ON public.memberships;
CREATE POLICY "Users see memberships of their orgs" ON public.memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "Owners and admins manage memberships" ON public.memberships;
DROP POLICY IF EXISTS "Owners and admins manage memberships" ON public.memberships;
CREATE POLICY "Owners and admins manage memberships" ON public.memberships FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Self insert as owner on org create" ON public.memberships;
DROP POLICY IF EXISTS "Self insert as owner on org create" ON public.memberships;
CREATE POLICY "Self insert as owner on org create" ON public.memberships FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND role = 'owner' AND EXISTS(SELECT 1 FROM public.organizations o WHERE o.id = org_id AND o.owner_user_id = auth.uid()));

-- org_invitations
DROP POLICY IF EXISTS "Owners admins manage invitations" ON public.org_invitations;
DROP POLICY IF EXISTS "Owners admins manage invitations" ON public.org_invitations;
CREATE POLICY "Owners admins manage invitations" ON public.org_invitations FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- plans (públicos en lectura)
DROP POLICY IF EXISTS "Plans are public" ON public.plans;
DROP POLICY IF EXISTS "Plans are public" ON public.plans;
CREATE POLICY "Plans are public" ON public.plans FOR SELECT USING (true);

-- subscriptions
DROP POLICY IF EXISTS "Members view subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Members view subscription" ON public.subscriptions;
CREATE POLICY "Members view subscription" ON public.subscriptions FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "Owners manage subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Owners manage subscription" ON public.subscriptions;
CREATE POLICY "Owners manage subscription" ON public.subscriptions FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner']));

-- platform_admins
DROP POLICY IF EXISTS "Platform admins view all" ON public.platform_admins;
DROP POLICY IF EXISTS "Platform admins view all" ON public.platform_admins;
CREATE POLICY "Platform admins view all" ON public.platform_admins FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR user_id = auth.uid());

-- ============================================================================
-- 8. REESCRITURA DE RLS EN TABLAS EXISTENTES (ahora basado en org_id)
-- ============================================================================

-- products
DROP POLICY IF EXISTS "Admin manages products" ON public.products;
DROP POLICY IF EXISTS "Authenticated read products" ON public.products;
DROP POLICY IF EXISTS "Org members read products" ON public.products;
CREATE POLICY "Org members read products" ON public.products FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "Org admins manage products" ON public.products;
CREATE POLICY "Org admins manage products" ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']) AND user_id = auth.uid());
DROP POLICY IF EXISTS "Org admins update products" ON public.products;
CREATE POLICY "Org admins update products" ON public.products FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Org admins delete products" ON public.products;
CREATE POLICY "Org admins delete products" ON public.products FOR DELETE TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- sales
DROP POLICY IF EXISTS "Admin manages all sales" ON public.sales;
DROP POLICY IF EXISTS "Vendedor can insert own sales" ON public.sales;
DROP POLICY IF EXISTS "Vendedor can select own sales" ON public.sales;
DROP POLICY IF EXISTS "Org members read sales" ON public.sales;
CREATE POLICY "Org members read sales" ON public.sales FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "Org members create sales" ON public.sales;
CREATE POLICY "Org members create sales" ON public.sales FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin','vendedor']) AND user_id = auth.uid());
DROP POLICY IF EXISTS "Org admins update sales" ON public.sales;
CREATE POLICY "Org admins update sales" ON public.sales FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Org admins delete sales" ON public.sales;
CREATE POLICY "Org admins delete sales" ON public.sales FOR DELETE TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- purchases
DROP POLICY IF EXISTS "Admin manages purchases" ON public.purchases;
DROP POLICY IF EXISTS "Org admins manage purchases" ON public.purchases;
CREATE POLICY "Org admins manage purchases" ON public.purchases FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Org members read purchases" ON public.purchases;
CREATE POLICY "Org members read purchases" ON public.purchases FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

-- debts
DROP POLICY IF EXISTS "Admin manages all debts" ON public.debts;
DROP POLICY IF EXISTS "Vendedor can select own debts" ON public.debts;
DROP POLICY IF EXISTS "Org members read debts" ON public.debts;
CREATE POLICY "Org members read debts" ON public.debts FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "Org admins manage debts" ON public.debts;
CREATE POLICY "Org admins manage debts" ON public.debts FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- expenses
DROP POLICY IF EXISTS "Admin manages expenses" ON public.expenses;
DROP POLICY IF EXISTS "Org admins manage expenses" ON public.expenses;
CREATE POLICY "Org admins manage expenses" ON public.expenses FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- settings
DROP POLICY IF EXISTS "Admin manages settings" ON public.settings;
DROP POLICY IF EXISTS "Authenticated read settings" ON public.settings;
DROP POLICY IF EXISTS "Public read settings for catalog" ON public.settings;
DROP POLICY IF EXISTS "Org members read settings" ON public.settings;
CREATE POLICY "Org members read settings" ON public.settings FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "Public read settings for catalog" ON public.settings;
CREATE POLICY "Public read settings for catalog" ON public.settings FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Org admins manage settings" ON public.settings;
CREATE POLICY "Org admins manage settings" ON public.settings FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- customer_notes
DROP POLICY IF EXISTS "Admin manages customer notes" ON public.customer_notes;
DROP POLICY IF EXISTS "Org members manage customer notes" ON public.customer_notes;
CREATE POLICY "Org members manage customer notes" ON public.customer_notes FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin','vendedor']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin','vendedor']));

-- marketing_posts
DROP POLICY IF EXISTS "Admin manages marketing" ON public.marketing_posts;
DROP POLICY IF EXISTS "Org admins manage marketing" ON public.marketing_posts;
CREATE POLICY "Org admins manage marketing" ON public.marketing_posts FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- influencer_exchanges
DROP POLICY IF EXISTS "Admin manages exchanges" ON public.influencer_exchanges;
DROP POLICY IF EXISTS "Org admins manage exchanges" ON public.influencer_exchanges;
CREATE POLICY "Org admins manage exchanges" ON public.influencer_exchanges FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- coupons
DROP POLICY IF EXISTS "Authenticated can read own coupons" ON public.coupons;
DROP POLICY IF EXISTS "Admin manages coupons" ON public.coupons;
DROP POLICY IF EXISTS "Anon can read active coupons" ON public.coupons;
DROP POLICY IF EXISTS "Org members read coupons" ON public.coupons;
CREATE POLICY "Org members read coupons" ON public.coupons FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "Anon read active coupons" ON public.coupons;
CREATE POLICY "Anon read active coupons" ON public.coupons FOR SELECT TO anon USING (active = true);
DROP POLICY IF EXISTS "Org admins manage coupons" ON public.coupons;
CREATE POLICY "Org admins manage coupons" ON public.coupons FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- product_variants
DROP POLICY IF EXISTS "Admin manages variants" ON public.product_variants;
DROP POLICY IF EXISTS "Authenticated read own variants" ON public.product_variants;
DROP POLICY IF EXISTS "Public read active variants" ON public.product_variants;
DROP POLICY IF EXISTS "Org members read variants" ON public.product_variants;
CREATE POLICY "Org members read variants" ON public.product_variants FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "Public read active variants" ON public.product_variants;
CREATE POLICY "Public read active variants" ON public.product_variants FOR SELECT TO anon USING (active = true);
DROP POLICY IF EXISTS "Org admins manage variants" ON public.product_variants;
CREATE POLICY "Org admins manage variants" ON public.product_variants FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- seller_goals
DROP POLICY IF EXISTS "Admin manages all seller goals" ON public.seller_goals;
DROP POLICY IF EXISTS "Sellers can view own goals" ON public.seller_goals;
DROP POLICY IF EXISTS "Sellers view own goals" ON public.seller_goals;
CREATE POLICY "Sellers view own goals" ON public.seller_goals FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Org admins manage seller goals" ON public.seller_goals;
CREATE POLICY "Org admins manage seller goals" ON public.seller_goals FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- audit_logs
DROP POLICY IF EXISTS "Users can view own audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Users can insert own audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can view all audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Org members view audit logs" ON public.audit_logs;
CREATE POLICY "Org members view audit logs" ON public.audit_logs FOR SELECT TO authenticated
  USING (org_id IS NULL AND auth.uid() = user_id OR (org_id IS NOT NULL AND public.is_org_member(org_id, auth.uid())));
DROP POLICY IF EXISTS "Users insert own audit logs" ON public.audit_logs;
CREATE POLICY "Users insert own audit logs" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- notifications
DROP POLICY IF EXISTS "Users manage own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Org members manage notifications" ON public.notifications;
CREATE POLICY "Org members manage notifications" ON public.notifications FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (auth.uid() = user_id);

-- profiles: agregar visibilidad a co-miembros de la org
DROP POLICY IF EXISTS "Org coworkers view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Org coworkers view profiles" ON public.profiles;
CREATE POLICY "Org coworkers view profiles" ON public.profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS(
      SELECT 1 FROM public.memberships m1
      JOIN public.memberships m2 ON m1.org_id = m2.org_id
      WHERE m1.user_id = auth.uid() AND m2.user_id = profiles.user_id
    )
  );

-- ============================================================================
-- 9. TRIGGERS ACTUALIZADOS para usar settings de la ORG
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_low_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE threshold integer;
BEGIN
  SELECT COALESCE(low_stock_threshold, 3) INTO threshold
  FROM public.settings WHERE org_id = NEW.org_id LIMIT 1;
  IF threshold IS NULL THEN threshold := 3; END IF;

  IF NEW.stock <= threshold AND (OLD.stock IS NULL OR OLD.stock > threshold) THEN
    INSERT INTO public.notifications (user_id, org_id, title, message, type, entity_type, entity_id)
    VALUES (
      NEW.user_id, NEW.org_id,
      'Stock bajo: ' || NEW.name,
      CASE WHEN NEW.stock = 0 THEN 'Sin stock disponible' ELSE 'Solo quedan ' || NEW.stock || ' unidades' END,
      'stock_bajo', 'product', NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_large_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE threshold numeric;
BEGIN
  SELECT COALESCE(large_sale_threshold_ars, 50000) INTO threshold
  FROM public.settings WHERE org_id = NEW.org_id LIMIT 1;
  IF threshold IS NULL THEN threshold := 50000; END IF;

  IF NEW.total_ars >= threshold THEN
    INSERT INTO public.notifications (user_id, org_id, title, message, type, entity_type, entity_id)
    VALUES (
      NEW.user_id, NEW.org_id,
      'Venta grande registrada',
      NEW.product_name || ' x' || NEW.quantity || ' — $' || ROUND(NEW.total_ars) || ' ARS',
      'venta_grande', 'sale', NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_overdue_debts()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d RECORD; window_hours integer;
BEGIN
  FOR d IN
    SELECT dt.id, dt.user_id, dt.org_id, dt.customer_name, dt.amount_ars, dt.due_date,
           COALESCE(s.overdue_check_window_hours, 24) AS uw
    FROM public.debts dt
    LEFT JOIN public.settings s ON s.org_id = dt.org_id
    WHERE dt.status IN ('pending','partial')
      AND dt.due_date IS NOT NULL AND dt.due_date < now()
  LOOP
    window_hours := d.uw;
    IF d.due_date > now() - make_interval(hours => window_hours) THEN
      INSERT INTO public.notifications (user_id, org_id, title, message, type, entity_type, entity_id)
      VALUES (
        d.user_id, d.org_id,
        'Deuda vencida: ' || d.customer_name,
        'Monto: $' || ROUND(d.amount_ars) || ' ARS — Venció ' || to_char(d.due_date, 'DD/MM/YYYY'),
        'deuda_vencida', 'debt', d.id::text
      );
    END IF;
  END LOOP;
END;
$$;

-- ============================================================================
-- 10. TRIGGER: al crear un nuevo usuario, crear automáticamente su org
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user_create_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_org_id uuid;
  display_name text;
  trial_plan_id uuid;
BEGIN
  display_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1), 'Mi Negocio');

  SELECT id INTO trial_plan_id FROM public.plans WHERE code = 'trial' LIMIT 1;

  INSERT INTO public.organizations (name, slug, owner_user_id, plan_id, trial_ends_at)
  VALUES (display_name || ' Workspace', public.generate_org_slug(display_name), NEW.id, trial_plan_id, now() + interval '14 days')
  RETURNING id INTO new_org_id;

  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  INSERT INTO public.subscriptions (org_id, plan_id, status, current_period_end)
  VALUES (new_org_id, trial_plan_id, 'trialing', now() + interval '14 days');

  -- Crear settings por defecto para la nueva org
  INSERT INTO public.settings (org_id, user_id, business_name)
  VALUES (new_org_id, NEW.id, display_name)
  ON CONFLICT (org_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Reemplazar trigger handle_new_user para que también cree org
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  -- Crear org automáticamente para el nuevo usuario
  PERFORM public.handle_new_user_create_org() FROM (SELECT NEW.*) AS t;
  RETURN NEW;
END;
$$;

-- Mejor: trigger separado que se dispare después
DROP TRIGGER IF EXISTS on_auth_user_created_create_org ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created_create_org ON auth.users;
CREATE TRIGGER on_auth_user_created_create_org
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_create_org();

-- == MIGRATION: 20260428021128_3f83c1f4-9822-4744-b6f9-67dd01a63c3f.sql ==

-- ============= INFLUENCERS =============
CREATE TABLE IF NOT EXISTS public.influencers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  instagram text,
  tiktok text,
  phone text,
  email text,
  followers_ig integer DEFAULT 0,
  followers_tiktok integer DEFAULT 0,
  engagement_rate numeric DEFAULT 0,
  tier text DEFAULT 'nano',
  commission_percent numeric DEFAULT 10,
  commission_type text DEFAULT 'porcentaje',
  commission_fixed_ars numeric DEFAULT 0,
  referral_code text NOT NULL,
  status text DEFAULT 'activo',
  total_generated_ars numeric DEFAULT 0,
  total_commissions_ars numeric DEFAULT 0,
  total_sales_count integer DEFAULT 0,
  notes text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, referral_code)
);
ALTER TABLE public.influencers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org admins manage influencers" ON public.influencers;
CREATE POLICY "Org admins manage influencers" ON public.influencers FOR ALL TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Org members read influencers" ON public.influencers;
CREATE POLICY "Org members read influencers" ON public.influencers FOR SELECT TO authenticated
  USING (is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "Public read active influencers" ON public.influencers;
CREATE POLICY "Public read active influencers" ON public.influencers FOR SELECT TO anon
  USING (status = 'activo');
DROP TRIGGER IF EXISTS trg_influencers_updated ON public.influencers;
CREATE TRIGGER trg_influencers_updated BEFORE UPDATE ON public.influencers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tier automático
CREATE OR REPLACE FUNCTION public.calculate_influencer_tier()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.followers_ig < 10000 THEN NEW.tier := 'nano';
  ELSIF NEW.followers_ig < 100000 THEN NEW.tier := 'micro';
  ELSIF NEW.followers_ig < 1000000 THEN NEW.tier := 'medio';
  ELSE NEW.tier := 'macro';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_influencer_tier ON public.influencers;
CREATE TRIGGER trg_influencer_tier BEFORE INSERT OR UPDATE OF followers_ig ON public.influencers
  FOR EACH ROW EXECUTE FUNCTION public.calculate_influencer_tier();

-- ============= INFLUENCER SALES =============
CREATE TABLE IF NOT EXISTS public.influencer_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  influencer_id uuid NOT NULL,
  referral_code text NOT NULL,
  sale_total_ars numeric NOT NULL DEFAULT 0,
  commission_ars numeric NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  payout_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.influencer_sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org admins manage influencer_sales" ON public.influencer_sales;
CREATE POLICY "Org admins manage influencer_sales" ON public.influencer_sales FOR ALL TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Org members read influencer_sales" ON public.influencer_sales;
CREATE POLICY "Org members read influencer_sales" ON public.influencer_sales FOR SELECT TO authenticated
  USING (is_org_member(org_id, auth.uid()));

-- ============= PAYOUTS =============
CREATE TABLE IF NOT EXISTS public.influencer_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  influencer_id uuid NOT NULL,
  amount_ars numeric NOT NULL DEFAULT 0,
  period_start timestamptz,
  period_end timestamptz,
  sales_count integer DEFAULT 0,
  payment_method text,
  notes text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.influencer_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org admins manage payouts" ON public.influencer_payouts;
CREATE POLICY "Org admins manage payouts" ON public.influencer_payouts FOR ALL TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Org members read payouts" ON public.influencer_payouts;
CREATE POLICY "Org members read payouts" ON public.influencer_payouts FOR SELECT TO authenticated
  USING (is_org_member(org_id, auth.uid()));

-- ============= SALES referral_code =============
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS referral_code text;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS influencer_id uuid;
ALTER TABLE public.influencer_exchanges ADD COLUMN IF NOT EXISTS influencer_id uuid;

-- Trigger: al crear venta con código, registrar comisión
CREATE OR REPLACE FUNCTION public.process_referral_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  inf RECORD;
  comm numeric;
BEGIN
  IF NEW.referral_code IS NULL OR NEW.referral_code = '' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO inf FROM public.influencers
    WHERE org_id = NEW.org_id AND lower(referral_code) = lower(NEW.referral_code) AND status = 'activo'
    LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF inf.commission_type = 'monto_fijo' THEN
    comm := inf.commission_fixed_ars;
  ELSIF inf.commission_type = 'por_venta' THEN
    comm := inf.commission_fixed_ars;
  ELSE
    comm := ROUND(NEW.total_ars * inf.commission_percent / 100.0, 2);
  END IF;

  INSERT INTO public.influencer_sales (org_id, sale_id, influencer_id, referral_code, sale_total_ars, commission_ars)
    VALUES (NEW.org_id, NEW.id, inf.id, NEW.referral_code, NEW.total_ars, comm);

  UPDATE public.influencers
    SET total_generated_ars = total_generated_ars + NEW.total_ars,
        total_commissions_ars = total_commissions_ars + comm,
        total_sales_count = total_sales_count + 1,
        updated_at = now()
    WHERE id = inf.id;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_process_referral_sale ON public.sales;
CREATE TRIGGER trg_process_referral_sale AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.process_referral_sale();

-- ============= PRODUCT COMBOS =============
CREATE TABLE IF NOT EXISTS public.product_combos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  product_ids uuid[] NOT NULL DEFAULT '{}',
  combo_price_ars numeric NOT NULL DEFAULT 0,
  original_price_ars numeric NOT NULL DEFAULT 0,
  savings_ars numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_combos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org admins manage combos" ON public.product_combos;
CREATE POLICY "Org admins manage combos" ON public.product_combos FOR ALL TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Org members read combos" ON public.product_combos;
CREATE POLICY "Org members read combos" ON public.product_combos FOR SELECT TO authenticated
  USING (is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "Public read active combos" ON public.product_combos;
CREATE POLICY "Public read active combos" ON public.product_combos FOR SELECT TO anon USING (active = true);
DROP TRIGGER IF EXISTS trg_combos_updated ON public.product_combos;
CREATE TRIGGER trg_combos_updated BEFORE UPDATE ON public.product_combos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= STORY TEMPLATES =============
CREATE TABLE IF NOT EXISTS public.story_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  name text NOT NULL,
  code text NOT NULL,
  badge_text text,
  badge_color text DEFAULT '#D4A843',
  emoji text,
  layout text DEFAULT 'classic',
  is_default boolean DEFAULT false,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.story_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org admins manage templates" ON public.story_templates;
CREATE POLICY "Org admins manage templates" ON public.story_templates FOR ALL TO authenticated
  USING (org_id IS NULL OR has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (org_id IS NOT NULL AND has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Read templates" ON public.story_templates;
CREATE POLICY "Read templates" ON public.story_templates FOR SELECT TO authenticated, anon
  USING (active = true);

-- ============= INDUSTRY PRESETS =============
CREATE TABLE IF NOT EXISTS public.industry_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  default_color text DEFAULT '#D4A843',
  default_secondary_color text DEFAULT '#1A1A2E',
  default_settings jsonb DEFAULT '{}'::jsonb,
  ai_tone text DEFAULT 'profesional rioplatense',
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0
);
ALTER TABLE public.industry_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read industries" ON public.industry_presets;
CREATE POLICY "Read industries" ON public.industry_presets FOR SELECT TO authenticated, anon USING (active = true);

-- ============= BRAND KNOWLEDGE =============
CREATE TABLE IF NOT EXISTS public.brand_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  brand text NOT NULL,
  category text NOT NULL DEFAULT 'perfume_arabe',
  notes_typical text,
  clone_of text,
  description text,
  active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brand_knowledge ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org admins manage brand knowledge" ON public.brand_knowledge;
CREATE POLICY "Org admins manage brand knowledge" ON public.brand_knowledge FOR ALL TO authenticated
  USING (org_id IS NULL OR has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (org_id IS NOT NULL AND has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Read brand knowledge" ON public.brand_knowledge;
CREATE POLICY "Read brand knowledge" ON public.brand_knowledge FOR SELECT TO authenticated USING (active = true);

-- ============= CATALOG BANNERS =============
CREATE TABLE IF NOT EXISTS public.catalog_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  subtitle text,
  image_url text,
  link_url text,
  background_color text DEFAULT '#D4A843',
  text_color text DEFAULT '#FFFFFF',
  active boolean DEFAULT true,
  starts_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.catalog_banners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org admins manage banners" ON public.catalog_banners;
CREATE POLICY "Org admins manage banners" ON public.catalog_banners FOR ALL TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Public read active banners" ON public.catalog_banners;
CREATE POLICY "Public read active banners" ON public.catalog_banners FOR SELECT TO anon, authenticated
  USING (active = true AND (expires_at IS NULL OR expires_at > now()));
DROP TRIGGER IF EXISTS trg_banners_updated ON public.catalog_banners;
CREATE TRIGGER trg_banners_updated BEFORE UPDATE ON public.catalog_banners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= AI OFFER RECOMMENDATIONS =============
CREATE TABLE IF NOT EXISTS public.ai_offer_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  user_id uuid NOT NULL,
  product_id uuid,
  offer_type text NOT NULL,
  reason text NOT NULL,
  suggested_discount_percent numeric,
  suggested_price_ars numeric,
  duration_hours integer,
  resulting_margin_percent numeric,
  probability text,
  recommended_channel text,
  payload jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'pending',
  applied_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_offer_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org admins manage AI recs" ON public.ai_offer_recommendations;
CREATE POLICY "Org admins manage AI recs" ON public.ai_offer_recommendations FOR ALL TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Org members read AI recs" ON public.ai_offer_recommendations;
CREATE POLICY "Org members read AI recs" ON public.ai_offer_recommendations FOR SELECT TO authenticated
  USING (is_org_member(org_id, auth.uid()));

-- ============= SETTINGS nuevos campos =============
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS default_cta_text text DEFAULT 'ESCRIBINOS YA 📲';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS stock_dormido_days integer DEFAULT 30;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS max_overstock_units integer DEFAULT 10;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS max_ai_discount_percent numeric DEFAULT 35;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS ai_tone text DEFAULT 'profesional rioplatense argentino';
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS industry_code text DEFAULT 'perfumes';

-- Seed industries
INSERT INTO public.industry_presets (code, name, default_color, ai_tone, default_settings, sort_order) VALUES
  ('perfumes', 'Perfumes', '#D4A843', 'experto en perfumería árabe y de diseñador, rioplatense', '{"low_stock_threshold":3}', 1),
  ('vapers', 'Vapers', '#3B82F6', 'experto en vapers y e-liquids, claro y técnico', '{"low_stock_threshold":5}', 2),
  ('indumentaria', 'Indumentaria', '#EC4899', 'fashion-forward, cercano', '{}', 3),
  ('tecnologia', 'Tecnología', '#10B981', 'técnico y preciso', '{}', 4),
  ('cosmetica', 'Cosmética', '#8B5CF6', 'beauty experto, cálido', '{}', 5),
  ('alimentos', 'Alimentos', '#F59E0B', 'apetitoso y fresco', '{}', 6),
  ('otro', 'Otro', '#D4A843', 'profesional y cercano', '{}', 99)
ON CONFLICT (code) DO NOTHING;

-- Seed default story templates (org_id NULL = globales)
INSERT INTO public.story_templates (org_id, code, name, badge_text, badge_color, emoji, sort_order, is_default) VALUES
  (NULL, 'promo', 'Promoción', 'OFERTA', '#EF4444', '🔥', 1, true),
  (NULL, 'flash', 'Flash Sale', 'FLASH ⚡', '#F59E0B', '⚡', 2, false),
  (NULL, 'nuevo', 'Nuevo Ingreso', 'NUEVO', '#10B981', '✨', 3, false),
  (NULL, 'recomendado', 'Recomendado', 'TOP', '#8B5CF6', '⭐', 4, false),
  (NULL, 'limpio', 'Minimalista', '', '#D4A843', '', 5, false)
ON CONFLICT DO NOTHING;

-- Seed brand knowledge base perfumes árabes (globales)
INSERT INTO public.brand_knowledge (org_id, brand, category, notes_typical, clone_of) VALUES
  (NULL, 'Lattafa', 'perfume_arabe', 'Maison árabe con clones premium y creaciones propias', NULL),
  (NULL, 'Armaf', 'perfume_arabe', 'Casa árabe especializada en clones de fragancias de nicho', NULL),
  (NULL, 'Asad', 'perfume_arabe', 'Notas: piña, abedul, ámbar gris, almizcle, vainilla', 'Creed Aventus'),
  (NULL, 'Khamrah', 'perfume_arabe', 'Notas: canela, dátil, mirra, vainilla, tonka', NULL),
  (NULL, 'Yara', 'perfume_arabe', 'Notas: orquídea, vainilla, almendra, gourmand femenino', NULL),
  (NULL, 'Club de Nuit Intense Man', 'perfume_arabe', 'Clon icónico de Aventus, sillage potente', 'Creed Aventus'),
  (NULL, 'Bade''e Al Oud', 'perfume_arabe', 'Oud + ámbar, oriental masculino', NULL),
  (NULL, 'Eclaire', 'perfume_arabe', 'Frutal floral, gourmand femenino moderno', NULL)
ON CONFLICT DO NOTHING;

-- == MIGRATION: 20260429000002_stripe_price_ids.sql ==

-- ============================================================================
-- STRIPE PRICE IDs
-- Ejecutar DESPUÉS de crear los productos y precios en el dashboard de Stripe.
-- Reemplazá cada price_xxxx con el ID real de tu cuenta Stripe.
-- ============================================================================

-- Paso 1: En Stripe Dashboard (dashboard.stripe.com) creá los productos:
--   - Gestiona Starter  → Precio mensual $29/mes USD  → copiá el price ID
--   - Gestiona Starter  → Precio anual  $290/año USD  → copiá el price ID
--   - Gestiona Pro      → Precio mensual $79/mes USD  → copiá el price ID
--   - Gestiona Pro      → Precio anual  $790/año USD  → copiá el price ID
--   - Gestiona Business → Precio mensual $199/mes USD → copiá el price ID
--   - Gestiona Business → Precio anual  $1990/año USD → copiá el price ID

-- Paso 2: Reemplazá los valores de abajo y ejecutá este SQL en el SQL Editor de Supabase.

UPDATE public.plans SET
  stripe_price_id_monthly = 'price_STARTER_MONTHLY',   -- reemplazar
  stripe_price_id_yearly  = 'price_STARTER_YEARLY'     -- reemplazar
WHERE code = 'starter';

UPDATE public.plans SET
  stripe_price_id_monthly = 'price_PRO_MONTHLY',        -- reemplazar
  stripe_price_id_yearly  = 'price_PRO_YEARLY'          -- reemplazar
WHERE code = 'pro';

UPDATE public.plans SET
  stripe_price_id_monthly = 'price_BUSINESS_MONTHLY',   -- reemplazar
  stripe_price_id_yearly  = 'price_BUSINESS_YEARLY'     -- reemplazar
WHERE code = 'business';

-- El plan 'trial' no necesita price IDs (es gratis).

-- Paso 3: Deployar las Edge Functions:
--   supabase functions deploy create-checkout
--   supabase functions deploy stripe-webhook
--   supabase functions deploy cancel-subscription

-- Paso 4: Agregar secrets en Supabase:
--   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
--   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...

-- Paso 5: Registrar el webhook en Stripe Dashboard:
--   URL: https://wkpzfriwtelbtvadloap.supabase.co/functions/v1/stripe-webhook
--   Eventos a escuchar:
--     checkout.session.completed
--     customer.subscription.created
--     customer.subscription.updated
--     customer.subscription.deleted
--     invoice.payment_failed

-- == MIGRATION: 20260429131218_43be1c0f-4951-4b95-bbbe-6d85b60a8dc2.sql ==

-- Exchange configs (status y type)
CREATE TABLE IF NOT EXISTS public.exchange_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NULL,
  kind text NOT NULL CHECK (kind IN ('status','type')),
  code text NOT NULL,
  label text NOT NULL,
  color_class text DEFAULT 'bg-muted text-muted-foreground',
  sort_order integer DEFAULT 0,
  active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, kind, code)
);
ALTER TABLE public.exchange_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read exchange configs" ON public.exchange_configs;
CREATE POLICY "Read exchange configs" ON public.exchange_configs FOR SELECT TO authenticated USING (active = true);
DROP POLICY IF EXISTS "Org admins manage exchange configs" ON public.exchange_configs;
CREATE POLICY "Org admins manage exchange configs" ON public.exchange_configs FOR ALL TO authenticated
  USING (org_id IS NULL OR has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (org_id IS NOT NULL AND has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

INSERT INTO public.exchange_configs (org_id, kind, code, label, color_class, sort_order) VALUES
  (NULL, 'status', 'pendiente',  'Pendiente',   'bg-warning/20 text-warning', 1),
  (NULL, 'status', 'entregado',  'Entregado',   'bg-blue-500/20 text-blue-400', 2),
  (NULL, 'status', 'publicado',  'Publicado',   'bg-success/20 text-success', 3),
  (NULL, 'status', 'completado', 'Completado',  'bg-primary/20 text-primary', 4),
  (NULL, 'type',   'canje',         'Canje',         'bg-muted text-muted-foreground', 1),
  (NULL, 'type',   'regalo',        'Regalo',        'bg-muted text-muted-foreground', 2),
  (NULL, 'type',   'colaboracion',  'Colaboración',  'bg-muted text-muted-foreground', 3)
ON CONFLICT DO NOTHING;

-- Marketing post types
CREATE TABLE IF NOT EXISTS public.marketing_post_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NULL,
  code text NOT NULL,
  label text NOT NULL,
  emoji text DEFAULT '📸',
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);
ALTER TABLE public.marketing_post_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read post types" ON public.marketing_post_types;
CREATE POLICY "Read post types" ON public.marketing_post_types FOR SELECT TO authenticated USING (active = true);
DROP POLICY IF EXISTS "Org admins manage post types" ON public.marketing_post_types;
CREATE POLICY "Org admins manage post types" ON public.marketing_post_types FOR ALL TO authenticated
  USING (org_id IS NULL OR has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (org_id IS NOT NULL AND has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

INSERT INTO public.marketing_post_types (org_id, code, label, emoji, sort_order) VALUES
  (NULL, 'post',     'Post de Feed', '📸', 1),
  (NULL, 'story',    'Historia',     '📱', 2),
  (NULL, 'reel',     'Reel',         '🎬', 3),
  (NULL, 'carousel', 'Carrusel',     '🖼️', 4)
ON CONFLICT DO NOTHING;

-- Marketing themes
CREATE TABLE IF NOT EXISTS public.marketing_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NULL,
  industry_code text NULL,
  label text NOT NULL,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.marketing_themes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read themes" ON public.marketing_themes;
CREATE POLICY "Read themes" ON public.marketing_themes FOR SELECT TO authenticated USING (active = true);
DROP POLICY IF EXISTS "Org admins manage themes" ON public.marketing_themes;
CREATE POLICY "Org admins manage themes" ON public.marketing_themes FOR ALL TO authenticated
  USING (org_id IS NULL OR has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (org_id IS NOT NULL AND has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

INSERT INTO public.marketing_themes (org_id, industry_code, label, sort_order) VALUES
  (NULL, 'perfumes', 'Promoción de perfumes árabes', 1),
  (NULL, 'perfumes', 'Fragancias para regalar', 2),
  (NULL, 'perfumes', 'Comparativa de perfumes', 3),
  (NULL, 'perfumes', 'Tips de fragancias', 4),
  (NULL, 'perfumes', 'Perfume del día', 5),
  (NULL, 'vapers',   'Nuevos ingresos de vapers', 6),
  (NULL, 'vapers',   'Combo vaper + líquido', 7),
  (NULL, NULL,       'Descuentos especiales', 8),
  (NULL, NULL,       'Lanzamiento de producto', 9),
  (NULL, NULL,       'Cliente del mes / testimonio', 10)
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_exchange_configs_org_kind ON public.exchange_configs(org_id, kind);
CREATE INDEX IF NOT EXISTS idx_marketing_themes_org_industry ON public.marketing_themes(org_id, industry_code);

-- == MIGRATION: 20260429224013_0d3d6044-b04b-4feb-bf7b-6afaa3b46721.sql ==

CREATE TABLE IF NOT EXISTS public.tiendanube_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
  store_id text NOT NULL,
  access_token text NOT NULL,
  store_name text,
  store_url text,
  default_category_id text,
  price_mode text NOT NULL DEFAULT 'sale_price_ars',
  markup_percent numeric NOT NULL DEFAULT 0,
  sync_stock boolean NOT NULL DEFAULT true,
  sync_images boolean NOT NULL DEFAULT true,
  publish_status text NOT NULL DEFAULT 'visible',
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tiendanube_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org admins read integration" ON public.tiendanube_integrations;
CREATE POLICY "Org admins read integration" ON public.tiendanube_integrations
  FOR SELECT TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Org admins insert integration" ON public.tiendanube_integrations;
CREATE POLICY "Org admins insert integration" ON public.tiendanube_integrations
  FOR INSERT TO authenticated
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Org admins update integration" ON public.tiendanube_integrations;
CREATE POLICY "Org admins update integration" ON public.tiendanube_integrations
  FOR UPDATE TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Org admins delete integration" ON public.tiendanube_integrations;
CREATE POLICY "Org admins delete integration" ON public.tiendanube_integrations
  FOR DELETE TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

DROP TRIGGER IF EXISTS trg_tiendanube_integrations_updated ON public.tiendanube_integrations;
CREATE TRIGGER trg_tiendanube_integrations_updated
  BEFORE UPDATE ON public.tiendanube_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tiendanube_product_id text;
CREATE INDEX IF NOT EXISTS idx_products_tn ON public.products(tiendanube_product_id);

CREATE TABLE IF NOT EXISTS public.tiendanube_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text,
  action text NOT NULL,
  status text NOT NULL,
  tiendanube_product_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tiendanube_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members read sync log" ON public.tiendanube_sync_log;
CREATE POLICY "Org members read sync log" ON public.tiendanube_sync_log
  FOR SELECT TO authenticated
  USING (is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "Org admins insert sync log" ON public.tiendanube_sync_log;
CREATE POLICY "Org admins insert sync log" ON public.tiendanube_sync_log
  FOR INSERT TO authenticated
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

CREATE INDEX IF NOT EXISTS idx_tn_log_org_date ON public.tiendanube_sync_log(org_id, created_at DESC);

-- == MIGRATION: 20260429_invoices.sql ==

-- ============================================================
-- INVOICES / FACTURAS
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.invoices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number      text NOT NULL,           -- e.g. "FAC-0001"
  customer_name text NOT NULL,
  customer_email text,
  customer_address text,
  customer_tax_id text,               -- CUIT / DNI
  issue_date  date NOT NULL DEFAULT CURRENT_DATE,
  due_date    date,
  status      public.invoice_status NOT NULL DEFAULT 'draft',
  notes       text,
  currency    text NOT NULL DEFAULT 'ARS',
  subtotal    numeric NOT NULL DEFAULT 0,
  tax_pct     numeric NOT NULL DEFAULT 0,
  tax_amount  numeric NOT NULL DEFAULT 0,
  total       numeric NOT NULL DEFAULT 0,
  paid_at     timestamptz,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity    numeric NOT NULL DEFAULT 1,
  unit_price  numeric NOT NULL DEFAULT 0,
  total       numeric NOT NULL DEFAULT 0
);

-- Sequence for invoice numbers per org
CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  org_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0
);

-- RLS
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

-- Policies: members can read; admins/owners can write
DROP POLICY IF EXISTS "invoice_select" ON public.invoices;
CREATE POLICY "invoice_select" ON public.invoices
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "invoice_insert" ON public.invoices;
CREATE POLICY "invoice_insert" ON public.invoices
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );
DROP POLICY IF EXISTS "invoice_update" ON public.invoices;
CREATE POLICY "invoice_update" ON public.invoices
  FOR UPDATE USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );
DROP POLICY IF EXISTS "invoice_delete" ON public.invoices;
CREATE POLICY "invoice_delete" ON public.invoices
  FOR DELETE USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS "invoice_items_select" ON public.invoice_items;
CREATE POLICY "invoice_items_select" ON public.invoice_items
  FOR SELECT USING (
    invoice_id IN (
      SELECT id FROM public.invoices
      WHERE org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS "invoice_items_all" ON public.invoice_items;
CREATE POLICY "invoice_items_all" ON public.invoice_items
  FOR ALL USING (
    invoice_id IN (
      SELECT id FROM public.invoices
      WHERE org_id IN (
        SELECT org_id FROM public.memberships
        WHERE user_id = auth.uid() AND role IN ('owner','admin')
      )
    )
  );

DROP POLICY IF EXISTS "invoice_seq_all" ON public.invoice_sequences;
CREATE POLICY "invoice_seq_all" ON public.invoice_sequences
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invoices_org ON public.invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(invoice_id);

-- == MIGRATION: 20260430000001_barcode_variants.sql ==

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

-- == MIGRATION: 20260430000002_cash_sessions.sql ==

-- ============================================================
-- CASH REGISTER SESSIONS (Apertura/Cierre de Caja)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opened_by     uuid REFERENCES auth.users(id),
  closed_by     uuid REFERENCES auth.users(id),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  opening_amount numeric NOT NULL DEFAULT 0,   -- monto declarado al abrir
  closing_amount numeric,                       -- monto contado al cerrar
  expected_cash  numeric,                       -- calculado: opening + ventas en efectivo
  difference     numeric,                       -- closing - expected (positivo=sobrante, negativo=faltante)
  notes          text,
  status         text NOT NULL DEFAULT 'open'   -- 'open' | 'closed'
);

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cash_sessions_org" ON public.cash_sessions;
CREATE POLICY "cash_sessions_org" ON public.cash_sessions
  FOR ALL USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_cash_sessions_org ON public.cash_sessions(org_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON public.cash_sessions(org_id, status);

-- == MIGRATION: 20260430000003_presupuestos.sql ==

-- ============================================================
-- PRESUPUESTOS (Quotes / Estimates)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quote_number    text NOT NULL,
  customer_name   text NOT NULL,
  customer_email  text,
  customer_phone  text,
  items           jsonb NOT NULL DEFAULT '[]',
  subtotal        numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  total           numeric NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'draft',  -- draft | sent | accepted | rejected | expired
  valid_until     date,
  notes           text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-increment quote numbers per org
CREATE TABLE IF NOT EXISTS public.quote_sequences (
  org_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0
);

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quotes_org" ON public.quotes;
CREATE POLICY "quotes_org" ON public.quotes
  FOR ALL USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "quote_sequences_org" ON public.quote_sequences;
CREATE POLICY "quote_sequences_org" ON public.quote_sequences
  FOR ALL USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_quotes_org ON public.quotes(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON public.quotes(org_id, status);

-- Function to get next quote number for an org
CREATE OR REPLACE FUNCTION public.next_quote_number(p_org_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO public.quote_sequences (org_id, last_number) VALUES (p_org_id, 1)
  ON CONFLICT (org_id) DO UPDATE SET last_number = quote_sequences.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'PRE-' || LPAD(v_next::text, 4, '0');
END;
$$;

-- == MIGRATION: 20260430000004_proveedores.sql ==

-- ============================================================
-- PROVEEDORES (Suppliers)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.suppliers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  contact     text,
  phone       text,
  email       text,
  address     text,
  notes       text,
  tags        text[],
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers_org" ON public.suppliers;
CREATE POLICY "suppliers_org" ON public.suppliers
  FOR ALL USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

-- Link purchases to suppliers
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_org ON public.suppliers(org_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON public.purchases(supplier_id) WHERE supplier_id IS NOT NULL;

-- == MIGRATION: 20260430000005_sprint3.sql ==

-- ============================================================
-- SPRINT 3: Devoluciones + Mercado Pago + misc
-- ============================================================

-- Devoluciones (Returns)
CREATE TABLE IF NOT EXISTS public.returns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES auth.users(id),
  sale_id         uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  product_id      uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name    text NOT NULL,
  quantity        integer NOT NULL DEFAULT 1,
  amount_ars      numeric NOT NULL DEFAULT 0,
  reason          text,
  refund_method   text NOT NULL DEFAULT 'efectivo',  -- efectivo|transferencia|credito_tienda
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "returns_org" ON public.returns;
CREATE POLICY "returns_org" ON public.returns
  FOR ALL USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_returns_org ON public.returns(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_sale ON public.returns(sale_id) WHERE sale_id IS NOT NULL;

-- Mark sales as returned
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS returned boolean NOT NULL DEFAULT false;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS return_id uuid REFERENCES public.returns(id) ON DELETE SET NULL;

-- Mercado Pago token per org (stored in settings)
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS mp_access_token text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS mp_enabled boolean NOT NULL DEFAULT false;

-- Tiendanube webhook secret per connection (for HMAC verification)
ALTER TABLE public.tiendanube_connections ADD COLUMN IF NOT EXISTS webhook_id text;

-- == MIGRATION: 20260430000006_tiendanube.sql ==

-- ============================================================
-- TIENDANUBE INTEGRATION
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tiendanube_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id        text NOT NULL,
  access_token    text NOT NULL,
  store_name      text,
  store_url       text,
  connected_at    timestamptz NOT NULL DEFAULT now(),
  last_sync_products_at  timestamptz,
  last_sync_orders_at    timestamptz,
  sync_products   boolean NOT NULL DEFAULT true,
  sync_orders     boolean NOT NULL DEFAULT true,
  UNIQUE(org_id, store_id)
);

ALTER TABLE public.tiendanube_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tiendanube_connections_org" ON public.tiendanube_connections;
CREATE POLICY "tiendanube_connections_org" ON public.tiendanube_connections
  FOR ALL USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

-- Track external IDs to avoid duplicate imports
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tiendanube_id text;
ALTER TABLE public.sales    ADD COLUMN IF NOT EXISTS tiendanube_order_id text;

-- Unique constraint needed for upsert onConflict support
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tiendanube_unique ON public.products(org_id, tiendanube_id) WHERE tiendanube_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_tiendanube ON public.sales(org_id, tiendanube_order_id) WHERE tiendanube_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tiendanube_conn_org ON public.tiendanube_connections(org_id);

-- == MIGRATION: 20260430003519_609ef7d3-1921-4c2f-b258-a209051c5e05.sql ==

-- Agregar soporte de múltiples imágenes por producto
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] DEFAULT '{}'::text[];

-- Backfill: copiar image_url existente al array si está vacío
UPDATE public.products
SET image_urls = ARRAY[image_url]
WHERE image_url IS NOT NULL
  AND image_url <> ''
  AND (image_urls IS NULL OR array_length(image_urls, 1) IS NULL);

-- == MIGRATION: 20260430005028_76ed6fe9-c716-4eef-96bf-f43e4051527b.sql ==

ALTER TABLE public.tiendanube_integrations
  ADD COLUMN IF NOT EXISTS platform_fee_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_fee_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS round_to integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.tiendanube_integrations.platform_fee_percent IS 'Comisión % que cobra Tiendanube por venta (plan Inicial 9%, Avanzado 4.5%, etc.)';
COMMENT ON COLUMN public.tiendanube_integrations.payment_fee_percent IS 'Comisión % de la pasarela de pago (Mercado Pago ~6%)';
COMMENT ON COLUMN public.tiendanube_integrations.round_to IS 'Redondear precio final a múltiplo (0 = sin redondeo, 100 = a centenas, 1000 = a miles)';

-- == MIGRATION: 20260502_sprint4_features.sql ==

-- Sprint 4: Split de pago, descuento global, tabla de clientes

-- 1. Split de pago y descuento global en ventas
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS split_payments jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS global_discount_ars numeric DEFAULT 0;

-- 2. Tabla de clientes con perfil completo
CREATE TABLE IF NOT EXISTS public.customers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users(id),
  name        text        NOT NULL,
  email       text,
  phone       text,
  address     text,
  birthday    date,
  tags        text[]      DEFAULT '{}',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_customers" ON public.customers;
CREATE POLICY "org_members_manage_customers" ON public.customers
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS customers_org_id_idx ON public.customers(org_id);
CREATE INDEX IF NOT EXISTS customers_name_idx    ON public.customers(org_id, name);

-- == MIGRATION: 20260503000001_bank_transactions.sql ==

-- Conciliación bancaria
CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date        date        NOT NULL,
  description text        NOT NULL,
  amount_ars  numeric     NOT NULL,
  type        text        NOT NULL CHECK (type IN ('credit', 'debit')),
  matched     boolean     NOT NULL DEFAULT false,
  match_ref   text,
  account     text        NOT NULL DEFAULT 'Cuenta Principal',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_bank_transactions" ON public.bank_transactions;
CREATE POLICY "org_members_manage_bank_transactions" ON public.bank_transactions
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS bank_transactions_org_date_idx ON public.bank_transactions(org_id, date DESC);
CREATE INDEX IF NOT EXISTS bank_transactions_matched_idx  ON public.bank_transactions(org_id, matched);

-- == MIGRATION: 20260503000002_cron_customer_alerts.sql ==

-- Schedule daily customer reactivation alerts via pg_cron
-- Runs every day at 9am UTC (6am ARG / -3)
SELECT cron.schedule(
  'customer-reactivation-alerts',
  '0 9 * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_functions_url') || '/customer-reactivation-alerts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body := '{}'::jsonb
    )
  $$
);

-- == MIGRATION: 20260503000003_email_campaigns.sql ==

-- Email marketing campaigns
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subject      text        NOT NULL,
  body_html    text        NOT NULL,
  segment      text        NOT NULL DEFAULT 'all',
  status       text        NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  sent_count   integer     NOT NULL DEFAULT 0,
  failed_count integer     NOT NULL DEFAULT 0,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_email_campaigns" ON public.email_campaigns;
CREATE POLICY "org_members_manage_email_campaigns" ON public.email_campaigns
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS email_campaigns_org_id_idx ON public.email_campaigns(org_id);
CREATE INDEX IF NOT EXISTS email_campaigns_status_idx ON public.email_campaigns(org_id, status);

-- == MIGRATION: 20260503000004_settings_api_key.sql ==

-- API key for public REST API
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS api_key text UNIQUE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS settings_api_key_idx ON public.settings(api_key) WHERE api_key IS NOT NULL;

-- == MIGRATION: 20260503000005_settings_monthly_targets.sql ==

-- Agregar campo monthly_targets a settings para presupuesto anual vs real
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS monthly_targets jsonb DEFAULT NULL;

-- Estructura esperada:
-- { "sales_ars": 500000, "profit_ars": 150000, "expenses_ars": 80000 }

-- == MIGRATION: 20260503000006_supplier_debts.sql ==

-- Cuentas a Pagar: deudas con proveedores

CREATE TABLE IF NOT EXISTS public.supplier_debts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id   uuid        REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name text        NOT NULL,
  description   text        NOT NULL,
  amount_ars    numeric     NOT NULL DEFAULT 0,
  paid_ars      numeric     NOT NULL DEFAULT 0,
  remaining_ars numeric     GENERATED ALWAYS AS (amount_ars - paid_ars) STORED,
  due_date      date,
  status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_debts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_supplier_debts" ON public.supplier_debts;
CREATE POLICY "org_members_manage_supplier_debts" ON public.supplier_debts
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS supplier_debts_org_id_idx    ON public.supplier_debts(org_id);
CREATE INDEX IF NOT EXISTS supplier_debts_status_idx    ON public.supplier_debts(org_id, status);
CREATE INDEX IF NOT EXISTS supplier_debts_due_date_idx  ON public.supplier_debts(org_id, due_date);

-- Tabla de pagos parciales a proveedores
CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_debt_id uuid       NOT NULL REFERENCES public.supplier_debts(id) ON DELETE CASCADE,
  amount_ars      numeric     NOT NULL,
  method          text        NOT NULL DEFAULT 'transferencia',
  note            text,
  paid_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_supplier_payments" ON public.supplier_payments;
CREATE POLICY "org_members_manage_supplier_payments" ON public.supplier_payments
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

-- == MIGRATION: 20260504000001_afip_fields.sql ==

-- AFIP Facturación Electrónica
-- Adds credential fields to settings and authorization fields to invoices.

-- ── Settings: AFIP credentials per org ────────────────────────────────────────
alter table public.settings
  add column if not exists afip_cuit            text,
  add column if not exists afip_razon_social     text,
  add column if not exists afip_domicilio        text,
  add column if not exists afip_punto_venta      integer default 1,
  add column if not exists afip_environment      text    default 'homologacion',
  add column if not exists afip_tipo_emisor      text    default 'monotributo',
  add column if not exists afip_certificate      text,   -- PEM X.509 cert
  add column if not exists afip_private_key      text,   -- PEM RSA private key
  add column if not exists afip_ta_token         text,   -- cached TA token
  add column if not exists afip_ta_sign          text,   -- cached TA sign
  add column if not exists afip_ta_expires_at    timestamptz;

-- ── Invoices: CAE / AFIP authorization data ──────────────────────────────────
alter table public.invoices
  add column if not exists tipo_comprobante  integer,
  add column if not exists cae               text,
  add column if not exists cae_vencimiento   date,
  add column if not exists afip_status       text default 'not_applicable',
  add column if not exists afip_error        text,
  add column if not exists numero_afip       integer;

-- Valid values for reference:
-- tipo_comprobante: 1=Factura A, 6=Factura B, 11=Factura C
-- afip_status: 'not_applicable' | 'pending' | 'authorized' | 'rejected'

-- == MIGRATION: 20260504000002_automation_flows.sql ==

-- Marketing automation flows table
create table if not exists public.automation_flows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  trigger_type text not null check (trigger_type in ('customer_inactive', 'debt_overdue', 'low_stock', 'birthday')),
  trigger_config jsonb not null default '{}',
  action_type text not null check (action_type in ('whatsapp_message', 'notification', 'email')),
  action_config jsonb not null default '{}',
  active boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.automation_flows enable row level security;

DROP POLICY IF EXISTS "automation_flows_org_access" ON public.automation_flows;
create policy "automation_flows_org_access" on public.automation_flows
  for all using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

create index if not exists automation_flows_org_active_idx on public.automation_flows (org_id, active);

-- == MIGRATION: 20260504000003_automation_flows_v2.sql ==

-- Expand automation_flows to support more trigger and action types
-- Drops the old CHECK constraints and replaces with wider ones.

alter table public.automation_flows
  drop constraint if exists automation_flows_trigger_type_check;

alter table public.automation_flows
  drop constraint if exists automation_flows_action_type_check;

alter table public.automation_flows
  add constraint automation_flows_trigger_type_check
    check (trigger_type in (
      'customer_inactive',
      'debt_overdue',
      'low_stock',
      'birthday',
      'stock_out',
      'new_customer',
      'big_sale'
    ));

alter table public.automation_flows
  add constraint automation_flows_action_type_check
    check (action_type in (
      'notification',
      'email',
      'whatsapp_message',
      'create_task',
      'create_purchase_order',
      'webhook'
    ));

-- == MIGRATION: 20260504000004_cheques.sql ==

-- Post-dated checks (cheques diferidos) tracking
create table if not exists public.cheques (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type text not null default 'received' check (type in ('received', 'issued')),
  customer_name text,
  bank_name text,
  check_number text,
  amount_ars numeric not null,
  issue_date date,
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'deposited', 'cleared', 'bounced', 'cancelled')),
  deposited_at date,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.cheques enable row level security;

DROP POLICY IF EXISTS "cheques_org_access" ON public.cheques;
create policy "cheques_org_access" on public.cheques
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists cheques_org_due_idx on public.cheques (org_id, due_date, status);

-- == MIGRATION: 20260504000005_cron_automation_flows.sql ==

-- Daily automation flows runner via pg_cron (runs at 11:00 AM UTC)
select cron.schedule(
  'run-automation-flows-daily',
  '0 11 * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/run-automation-flows',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- == MIGRATION: 20260504000006_cron_customer_reactivation.sql ==

-- Daily customer reactivation alerts via pg_cron (runs at 10:00 AM UTC)
select cron.schedule(
  'customer-reactivation-daily',
  '0 10 * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/customer-reactivation-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- == MIGRATION: 20260504000007_cron_overdue_debts.sql ==

-- Daily overdue debts check via pg_cron (runs at 8:00 AM UTC)
select cron.schedule(
  'overdue-debts-daily',
  '0 8 * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/check-overdue-debts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- == MIGRATION: 20260504000008_cron_stock_alerts.sql ==

-- Daily stock alert check via pg_cron (runs at 9:00 AM UTC)
select cron.schedule(
  'stock-alerts-daily',
  '0 9 * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/check-stock-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_anon_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- == MIGRATION: 20260504000009_cuotas.sql ==

-- Installment payments (cuotas) tracking on sales
alter table public.sales
  add column if not exists installments integer default 1 check (installments >= 1),
  add column if not exists installment_amount_ars numeric,
  add column if not exists first_installment_date date;

-- Cuotas proyectadas (for cash flow projection)
create table if not exists public.installment_schedule (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  installment_number integer not null,
  amount_ars numeric not null,
  due_date date not null,
  paid boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.installment_schedule enable row level security;

DROP POLICY IF EXISTS "installment_schedule_org_access" ON public.installment_schedule;
create policy "installment_schedule_org_access" on public.installment_schedule
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists installment_schedule_org_due_idx on public.installment_schedule (org_id, due_date, paid);
create index if not exists installment_schedule_sale_idx on public.installment_schedule (sale_id);

-- == MIGRATION: 20260504000010_customer_comms.sql ==

-- Customer communications / interaction log
create table if not exists public.customer_communications (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  customer_name text not null,
  type          text not null default 'note'
                check (type in ('note','call','whatsapp','email','visit','other')),
  summary       text not null,
  created_at    timestamptz default now()
);

alter table public.customer_communications enable row level security;

DROP POLICY IF EXISTS "comm_org_access" ON public.customer_communications;
create policy "comm_org_access" on public.customer_communications
  for all using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

create index if not exists customer_comms_org_name_idx
  on public.customer_communications (org_id, customer_name, created_at desc);

-- == MIGRATION: 20260504000011_daily_kpi_alert.sql ==

-- Add daily KPI alert thresholds to settings
alter table public.settings
  add column if not exists daily_sales_alert_threshold numeric default 0,
  add column if not exists daily_margin_alert_threshold numeric default 0;

-- Schedule daily KPI alert at 9 AM UTC (6 AM Argentina)
select cron.schedule(
  'daily-kpi-alert',
  '0 9 * * *',
  $$
  select net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/daily-kpi-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- == MIGRATION: 20260504000012_deals.sql ==

-- Sales pipeline deals table
create table if not exists public.deals (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  customer_name text,
  value_ars   numeric default 0,
  stage       text not null default 'lead'
              check (stage in ('lead','contactado','propuesta','negociacion','cerrado','perdido')),
  notes       text,
  expected_close date,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- RLS
alter table public.deals enable row level security;

DROP POLICY IF EXISTS "deals_org_access" ON public.deals;
create policy "deals_org_access" on public.deals
  for all using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

-- Index for performance
create index if not exists deals_org_stage_idx on public.deals (org_id, stage);

-- == MIGRATION: 20260504000013_email_campaigns_scheduled.sql ==

-- Allow scheduling email campaigns for future delivery
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

-- Cron: check every hour for campaigns scheduled to send
SELECT cron.schedule(
  'send-scheduled-campaigns',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/send-scheduled-campaigns',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- == MIGRATION: 20260504000014_locations.sql ==

-- Multi-location / branch support
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  phone text,
  is_main boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.locations enable row level security;

DROP POLICY IF EXISTS "locations_org_access" ON public.locations;
create policy "locations_org_access" on public.locations
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists locations_org_idx on public.locations (org_id, active);

-- Location-level stock tracking (separate from global product stock)
create table if not exists public.location_stock (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  stock integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(location_id, product_id)
);

alter table public.location_stock enable row level security;

DROP POLICY IF EXISTS "location_stock_org_access" ON public.location_stock;
create policy "location_stock_org_access" on public.location_stock
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

-- Inter-location stock transfers
create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  from_location_id uuid references public.locations(id) on delete set null,
  to_location_id uuid references public.locations(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  notes text,
  transferred_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.stock_transfers enable row level security;

DROP POLICY IF EXISTS "stock_transfers_org_access" ON public.stock_transfers;
create policy "stock_transfers_org_access" on public.stock_transfers
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists stock_transfers_org_idx on public.stock_transfers (org_id, created_at desc);

-- == MIGRATION: 20260504000015_loyalty.sql ==

-- Loyalty points ledger
create table if not exists public.loyalty_points (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  customer_name text not null,
  delta         integer not null,          -- positive = earn, negative = redeem
  reason        text,                      -- 'sale', 'manual', 'redeem', etc.
  reference_id  uuid,                      -- sale id or null
  created_at    timestamptz default now()
);

alter table public.loyalty_points enable row level security;

DROP POLICY IF EXISTS "loyalty_org_access" ON public.loyalty_points;
create policy "loyalty_org_access" on public.loyalty_points
  for all using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

create index if not exists loyalty_org_customer_idx on public.loyalty_points (org_id, customer_name);

-- Settings: points_per_1000_ars (how many points per $1000 spent)
-- We'll store this in the existing settings.monthly_targets jsonb or as a separate column.
-- Add a dedicated column to settings for loyalty config.
alter table public.settings add column if not exists loyalty_enabled boolean default false;
alter table public.settings add column if not exists loyalty_points_per_1000 integer default 1;
alter table public.settings add column if not exists loyalty_points_value_ars integer default 100; -- 1 point = $100 ARS discount

-- == MIGRATION: 20260504000016_marketing_templates.sql ==

-- Public marketing template marketplace
-- Templates are shared across all orgs (public) or private to one org
create table if not exists public.marketing_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  content text not null,
  post_type text not null default 'post',
  industry text,
  tags text[] default '{}',
  is_public boolean not null default false,
  likes integer not null default 0,
  uses_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.marketing_templates enable row level security;

-- Public templates: anyone can read
DROP POLICY IF EXISTS "marketing_templates_read_public" ON public.marketing_templates;
create policy "marketing_templates_read_public" on public.marketing_templates
  for select using (is_public = true or org_id in (
    select org_id from public.memberships where user_id = auth.uid()
  ));

-- Org members can insert/update/delete their own org's templates
DROP POLICY IF EXISTS "marketing_templates_manage_own" ON public.marketing_templates;
create policy "marketing_templates_manage_own" on public.marketing_templates
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists marketing_templates_public_idx on public.marketing_templates (is_public, likes desc);
create index if not exists marketing_templates_org_idx on public.marketing_templates (org_id, created_at desc);

-- == MIGRATION: 20260504000017_payment_links.sql ==

-- Payment links: shareable URLs per presupuesto for customer self-payment
create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid references public.presupuestos(id) on delete set null,
  quote_number text,
  customer_name text not null,
  customer_phone text,
  items jsonb not null default '[]',
  total_ars numeric not null,
  mp_link text,
  status text not null default 'pending' check (status in ('pending', 'pending_confirmation', 'paid', 'cancelled')),
  paid_at timestamptz,
  notes text,
  expires_at date,
  created_at timestamptz not null default now()
);

alter table public.payment_links enable row level security;

-- Org members can manage their payment links
DROP POLICY IF EXISTS "payment_links_org_access" ON public.payment_links;
create policy "payment_links_org_access" on public.payment_links
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

-- Anonymous users can read a specific payment link by ID (UUID = safe secret)
DROP POLICY IF EXISTS "payment_links_public_read" ON public.payment_links;
create policy "payment_links_public_read" on public.payment_links
  for select using (true);

-- Anonymous users can update status to 'pending_confirmation' only
DROP POLICY IF EXISTS "payment_links_customer_update" ON public.payment_links;
create policy "payment_links_customer_update" on public.payment_links
  for update using (true)
  with check (status in ('pending_confirmation'));

create index if not exists payment_links_org_idx on public.payment_links (org_id, created_at desc);
create index if not exists payment_links_quote_idx on public.payment_links (quote_id);

-- Add bank account fields to settings for payment links
alter table public.settings
  add column if not exists bank_cbu text,
  add column if not exists bank_alias text,
  add column if not exists bank_name text,
  add column if not exists bank_holder text;

-- == MIGRATION: 20260504000018_price_history.sql ==

-- Price history: automatically tracks changes to product sale_price_ars
create table if not exists public.price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  old_price_ars numeric,
  new_price_ars numeric not null,
  old_cost_usd numeric,
  new_cost_usd numeric,
  change_pct numeric,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.price_history enable row level security;

DROP POLICY IF EXISTS "price_history_org_access" ON public.price_history;
create policy "price_history_org_access" on public.price_history
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists price_history_product_idx on public.price_history (product_id, created_at desc);
create index if not exists price_history_org_idx on public.price_history (org_id, created_at desc);

-- Trigger: auto-record price changes when products.sale_price_ars changes
create or replace function public.record_price_change()
returns trigger language plpgsql security definer as $$
begin
  if (TG_OP = 'UPDATE') and (
    OLD.sale_price_ars is distinct from NEW.sale_price_ars or
    OLD.total_cost_usd is distinct from NEW.total_cost_usd
  ) then
    insert into public.price_history (
      product_id, org_id,
      old_price_ars, new_price_ars,
      old_cost_usd, new_cost_usd,
      change_pct,
      changed_by
    ) values (
      NEW.id, NEW.org_id,
      OLD.sale_price_ars, NEW.sale_price_ars,
      OLD.total_cost_usd, NEW.total_cost_usd,
      case when OLD.sale_price_ars > 0
        then round(((NEW.sale_price_ars - OLD.sale_price_ars) / OLD.sale_price_ars) * 100, 1)
        else null
      end,
      auth.uid()
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_record_price_change on public.products;
DROP TRIGGER IF EXISTS trg_record_price_change ON public.products;
create trigger trg_record_price_change
  after update on public.products
  for each row execute function public.record_price_change();

-- == MIGRATION: 20260504000019_product_lots.sql ==

-- Lot and expiry tracking for products (vapers, fragrances, cosmetics)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS lot_number text,
  ADD COLUMN IF NOT EXISTS expiry_date date;

-- Index for quickly finding soon-to-expire products by org
CREATE INDEX IF NOT EXISTS products_expiry_idx ON public.products (org_id, expiry_date)
  WHERE expiry_date IS NOT NULL;

-- == MIGRATION: 20260504000020_product_tags.sql ==

-- Product tags for flexible labeling (e.g. "nuevo", "importado", "oferta", "temporada")
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

-- GIN index for fast array containment queries
CREATE INDEX IF NOT EXISTS products_tags_idx ON public.products USING gin (tags)
  WHERE tags IS NOT NULL AND array_length(tags, 1) > 0;

-- == MIGRATION: 20260504000021_referrals.sql ==

-- Customer referral program
create table if not exists public.customer_referrals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  referrer_name text not null,
  referred_name text not null,
  referral_code text not null,
  bonus_ars numeric default 0,
  bonus_points integer default 0,
  status text not null default 'pending' check (status in ('pending', 'credited', 'cancelled')),
  sale_id uuid references public.sales(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.customer_referrals enable row level security;

DROP POLICY IF EXISTS "referrals_org_access" ON public.customer_referrals;
create policy "referrals_org_access" on public.customer_referrals
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists referrals_org_code_idx on public.customer_referrals (org_id, referral_code);
create index if not exists referrals_org_referrer_idx on public.customer_referrals (org_id, referrer_name);

-- Add referral settings columns to settings table
alter table public.settings
  add column if not exists referral_enabled boolean default false,
  add column if not exists referral_bonus_ars integer default 500,
  add column if not exists referral_bonus_points integer default 5;

-- == MIGRATION: 20260504000022_seller_commissions.sql ==

-- Seller commission configuration per membership
alter table public.memberships
  add column if not exists commission_percent numeric default 0,
  add column if not exists commission_enabled boolean default false;

-- Seller commission payouts
create table if not exists public.seller_payouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seller_name text not null,
  period_start date not null,
  period_end date not null,
  sales_total_ars numeric not null default 0,
  commission_percent numeric not null default 0,
  commission_ars numeric not null default 0,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.seller_payouts enable row level security;

DROP POLICY IF EXISTS "seller_payouts_org_access" ON public.seller_payouts;
create policy "seller_payouts_org_access" on public.seller_payouts
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists seller_payouts_org_idx on public.seller_payouts (org_id, created_at desc);
create index if not exists seller_payouts_user_idx on public.seller_payouts (user_id);

-- == MIGRATION: 20260504000023_tasks.sql ==

-- Business task management
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'cancelled')),
  due_date date,
  completed_at timestamptz,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks enable row level security;

DROP POLICY IF EXISTS "tasks_org_access" ON public.tasks;
create policy "tasks_org_access" on public.tasks
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists tasks_org_status_idx on public.tasks (org_id, status, due_date);
create index if not exists tasks_assigned_idx on public.tasks (assigned_to, status);

-- == MIGRATION: 20260504000024_webhook_settings.sql ==

-- Outbound webhook configuration for Zapier/N8N/Make.com integrations
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS webhook_url text,
  ADD COLUMN IF NOT EXISTS webhook_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS webhook_events text[] DEFAULT ARRAY['sale.created', 'stock.low', 'debt.overdue'];

-- == MIGRATION: 20260504000025_weekly_digest.sql ==

-- Weekly performance digest cron — every Monday at 9 AM UTC
SELECT cron.schedule(
  'weekly-performance-digest',
  '0 9 * * 1',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/weekly-performance-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- == MIGRATION: 20260505000001_cash_entries.sql ==

-- ============================================================================
-- CASH ENTRIES — Movimientos individuales dentro de una sesión de caja
-- Permite auditar cada ingreso/egreso vinculado a ventas, cobros de deuda,
-- gastos y pagos de proveedores dentro de una caja abierta.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cash_entries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id      UUID        REFERENCES public.cash_sessions(id) ON DELETE SET NULL,

  -- Tipo de movimiento
  entry_type      TEXT        NOT NULL,
  -- 'sale_in'        ingreso de venta pagada
  -- 'debt_payment'   cobro de deuda/fiado
  -- 'expense_out'    egreso por gasto
  -- 'supplier_out'   pago a proveedor
  -- 'manual_in'      ingreso manual
  -- 'manual_out'     egreso manual
  -- 'opening'        monto de apertura
  -- 'closing'        monto de cierre

  -- Método de pago
  payment_method  TEXT,       -- efectivo | transferencia | debito | credito | ...

  -- Monto (siempre positivo; la dirección la da entry_type)
  amount_ars      NUMERIC     NOT NULL DEFAULT 0,

  -- Referencia al documento origen
  reference_type  TEXT,       -- 'sale' | 'debt' | 'expense' | 'purchase'
  reference_id    UUID,

  -- Descripción
  description     TEXT,

  -- Meta
  created_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_cash_entries_org     ON public.cash_entries(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_entries_session ON public.cash_entries(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_entries_ref     ON public.cash_entries(reference_type, reference_id);

-- RLS
ALTER TABLE public.cash_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members manage cash entries" ON public.cash_entries;
CREATE POLICY "org members manage cash entries"
  ON public.cash_entries FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

-- ============================================================================
-- Trigger: cuando se inserta una venta pagada, registrar en caja activa
-- (solo si hay una sesión abierta en esa org)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_sale_cash_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id    UUID;
  v_session   UUID;
BEGIN
  -- Solo ventas pagadas con efectivo o transferencia afectan la caja en efectivo
  IF NOT NEW.paid THEN RETURN NEW; END IF;
  IF NEW.payment_method NOT IN ('efectivo', 'transferencia', 'debito', 'credito', 'mayorista') THEN
    RETURN NEW;
  END IF;

  -- Obtener org_id del vendedor
  SELECT m.org_id INTO v_org_id
  FROM public.memberships m
  WHERE m.user_id = NEW.user_id
  ORDER BY m.joined_at LIMIT 1;

  IF v_org_id IS NULL THEN RETURN NEW; END IF;

  -- Buscar sesión de caja abierta
  SELECT id INTO v_session
  FROM public.cash_sessions
  WHERE org_id = v_org_id AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_session IS NULL THEN RETURN NEW; END IF;

  -- Registrar el ingreso
  INSERT INTO public.cash_entries (
    org_id, session_id, entry_type, payment_method,
    amount_ars, reference_type, reference_id,
    description, created_by
  ) VALUES (
    v_org_id, v_session, 'sale_in', COALESCE(NEW.payment_method, 'efectivo'),
    NEW.total_ars, 'sale', NEW.id,
    'Venta ' || COALESCE(NEW.payment_method, '') || ': ' || NEW.product_name,
    NEW.user_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_cash_entry ON public.sales;
DROP TRIGGER IF EXISTS trg_sale_cash_entry ON public.sales;
CREATE TRIGGER trg_sale_cash_entry
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_cash_entry();

-- ============================================================================
-- Vista: resumen de una sesión de caja (efectivo neto, transferencias, etc.)
-- ============================================================================
CREATE OR REPLACE VIEW public.cash_session_summary AS
SELECT
  cs.id            AS session_id,
  cs.org_id,
  cs.opened_at,
  cs.closed_at,
  cs.status,
  cs.opening_amount,
  COALESCE(SUM(CASE WHEN ce.payment_method = 'efectivo' AND ce.entry_type IN ('sale_in','debt_payment','manual_in') THEN ce.amount_ars
                    WHEN ce.entry_type IN ('expense_out','supplier_out','manual_out') AND ce.payment_method = 'efectivo' THEN -ce.amount_ars
                    ELSE 0 END), 0)  AS efectivo_neto,
  COALESCE(SUM(CASE WHEN ce.payment_method = 'transferencia' AND ce.entry_type IN ('sale_in','debt_payment') THEN ce.amount_ars ELSE 0 END), 0) AS transferencia_total,
  COALESCE(SUM(CASE WHEN ce.payment_method IN ('debito','credito') AND ce.entry_type IN ('sale_in','debt_payment') THEN ce.amount_ars ELSE 0 END), 0) AS tarjeta_total,
  COALESCE(SUM(CASE WHEN ce.entry_type = 'sale_in' THEN ce.amount_ars ELSE 0 END), 0) AS total_ventas,
  COALESCE(SUM(CASE WHEN ce.entry_type = 'debt_payment' THEN ce.amount_ars ELSE 0 END), 0) AS total_cobros,
  COALESCE(SUM(CASE WHEN ce.entry_type IN ('expense_out','supplier_out','manual_out') THEN ce.amount_ars ELSE 0 END), 0) AS total_egresos,
  COUNT(ce.id)     AS total_movements
FROM public.cash_sessions cs
LEFT JOIN public.cash_entries ce ON ce.session_id = cs.id
GROUP BY cs.id, cs.org_id, cs.opened_at, cs.closed_at, cs.status, cs.opening_amount;

-- ============================================================================
-- Función: registrar pago de deuda en caja
-- (llamada desde DebtsPage cuando se registra un cobro)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_debt_payment_cash_entry(
  p_org_id        UUID,
  p_debt_id       UUID,
  p_amount_ars    NUMERIC,
  p_payment_method TEXT,
  p_description   TEXT,
  p_created_by    UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session   UUID;
  v_entry_id  UUID;
BEGIN
  -- Verificar membresía
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE org_id = p_org_id AND user_id = p_created_by
  ) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  -- Buscar sesión abierta
  SELECT id INTO v_session
  FROM public.cash_sessions
  WHERE org_id = p_org_id AND status = 'open'
  ORDER BY opened_at DESC LIMIT 1;

  INSERT INTO public.cash_entries (
    org_id, session_id, entry_type, payment_method,
    amount_ars, reference_type, reference_id,
    description, created_by
  ) VALUES (
    p_org_id, v_session, 'debt_payment', p_payment_method,
    p_amount_ars, 'debt', p_debt_id,
    COALESCE(p_description, 'Cobro de deuda'),
    p_created_by
  )
  RETURNING id INTO v_entry_id;

  RETURN v_entry_id;
END;
$$;

-- == MIGRATION: 20260505000002_demo_data_function.sql ==

-- Demo seed function: inserts sample products, sales and a customer for a new org
-- Called from the seed-demo Edge Function or manually via platform admin action.
-- Safe to call multiple times (uses IF NOT EXISTS style inserts).

CREATE OR REPLACE FUNCTION public.seed_demo_data(p_org_id uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prod1 uuid := gen_random_uuid();
  v_prod2 uuid := gen_random_uuid();
  v_prod3 uuid := gen_random_uuid();
  v_sale1 uuid := gen_random_uuid();
  v_sale2 uuid := gen_random_uuid();
  v_sale3 uuid := gen_random_uuid();
  v_today date := current_date;
BEGIN
  -- Guard: skip if org already has products (avoid double-seeding)
  IF EXISTS (SELECT 1 FROM public.products WHERE org_id = p_org_id LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'org already has products');
  END IF;

  -- ── Products ──────────────────────────────────────────────────────────────────
  INSERT INTO public.products (
    id, org_id, user_id, name, brand, category, gender,
    cost_usd, customs_fee, total_cost_usd,
    sale_price_ars, profit_per_unit_ars, profit_per_unit_usd,
    stock, featured
  ) VALUES
    (v_prod1, p_org_id, p_user_id,
     'BACCARAT ROUGE 540', 'MAISON FRANCIS KURKDJIAN', 'perfume_arabe', 'unisex',
     8.50, 1.50, 10.00, 15000, 5000, 3.33, 12, true),
    (v_prod2, p_org_id, p_user_id,
     'GOOD GIRL', 'CAROLINA HERRERA', 'perfume_mujer', 'mujer',
     6.00, 1.00, 7.00, 10500, 3500, 2.33, 8, false),
    (v_prod3, p_org_id, p_user_id,
     'SAUVAGE EDP', 'DIOR', 'perfume_hombre', 'hombre',
     7.50, 1.50, 9.00, 13500, 4500, 3.00, 5, false);

  -- ── Settings (initialize if missing) ─────────────────────────────────────────
  INSERT INTO public.settings (
    org_id, user_id, business_name, usd_rate_blue, low_stock_threshold
  ) VALUES (
    p_org_id, p_user_id, 'Mi Perfumería', 1200, 3
  ) ON CONFLICT (org_id) DO NOTHING;

  -- ── Sales (last 3 days) ───────────────────────────────────────────────────────
  INSERT INTO public.sales (
    id, org_id, user_id, product_id, product_name,
    quantity, unit_price_ars, total_ars,
    cost_per_unit_usd, profit_ars, profit_usd,
    customer_name, date, paid, payment_method
  ) VALUES
    (v_sale1, p_org_id, p_user_id, v_prod1, 'BACCARAT ROUGE 540',
     1, 15000, 15000, 10.00, 5000, 4.17,
     'María González', (v_today - 2)::timestamptz, true, 'transferencia'),
    (v_sale2, p_org_id, p_user_id, v_prod2, 'GOOD GIRL',
     2, 10500, 21000, 7.00, 7000, 5.83,
     'Laura Martínez', (v_today - 1)::timestamptz, true, 'efectivo'),
    (v_sale3, p_org_id, p_user_id, v_prod3, 'SAUVAGE EDP',
     1, 13500, 13500, 9.00, 4500, 3.75,
     'Carlos Pérez', v_today::timestamptz, false, 'transferencia');

  -- ── Debt for unpaid sale ──────────────────────────────────────────────────────
  INSERT INTO public.debts (
    org_id, user_id, sale_id, customer_name,
    amount_ars, paid_ars, remaining_ars, status, description
  ) VALUES (
    p_org_id, p_user_id, v_sale3, 'Carlos Pérez',
    13500, 0, 13500, 'pending', 'SAUVAGE EDP — pago pendiente'
  );

  -- ── Customer profile ──────────────────────────────────────────────────────────
  INSERT INTO public.customers (
    org_id, user_id, name, phone, tags, notes
  ) VALUES (
    p_org_id, p_user_id, 'María González',
    '+54 9 11 1234-5678', ARRAY['VIP', 'Baccarat'], 'Cliente frecuente, regalo habitual'
  ) ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'products', 3, 'sales', 3);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_demo_data(uuid, uuid) TO authenticated;

-- == MIGRATION: 20260505000003_kardex.sql ==

-- ============================================================================
-- KARDEX — Movimientos de Stock
-- Tabla de trazabilidad completa de entradas/salidas/ajustes de inventario
-- ============================================================================

-- 1. Tabla principal de movimientos
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id      UUID        REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id      UUID        REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_name    TEXT        NOT NULL,
  variant_name    TEXT,

  -- Tipo de movimiento
  movement_type   TEXT        NOT NULL,
  -- Valores: 'purchase' | 'sale' | 'return_in' | 'return_out' |
  --          'adjustment_in' | 'adjustment_out' | 'transfer_in' | 'transfer_out' |
  --          'physical_count' | 'initial'

  -- Cantidades (positivo = entrada, negativo = salida)
  quantity        INTEGER     NOT NULL,  -- delta aplicado al stock
  stock_before    INTEGER     NOT NULL DEFAULT 0,
  stock_after     INTEGER     NOT NULL DEFAULT 0,

  -- Referencia al documento origen
  reference_type  TEXT,   -- 'sale' | 'purchase' | 'invoice' | 'stock_count' | 'manual'
  reference_id    UUID,   -- id del registro origen

  -- Información de costo/precio para análisis
  unit_cost_usd   NUMERIC,
  unit_price_ars  NUMERIC,

  -- Meta
  notes           TEXT,
  created_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_stock_movements_org        ON public.stock_movements(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product    ON public.stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant    ON public.stock_movements(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type       ON public.stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref        ON public.stock_movements(reference_type, reference_id);

-- RLS
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members read stock movements" ON public.stock_movements;
CREATE POLICY "org members read stock movements"
  ON public.stock_movements FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "org members insert stock movements" ON public.stock_movements;
CREATE POLICY "org members insert stock movements"
  ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

-- ============================================================================
-- 2. Función genérica para registrar movimiento
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_org_id        UUID,
  p_product_id    UUID,
  p_variant_id    UUID,
  p_product_name  TEXT,
  p_variant_name  TEXT,
  p_movement_type TEXT,
  p_quantity      INTEGER,   -- positivo=entrada, negativo=salida
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id  UUID DEFAULT NULL,
  p_unit_cost_usd NUMERIC DEFAULT NULL,
  p_unit_price_ars NUMERIC DEFAULT NULL,
  p_notes         TEXT DEFAULT NULL,
  p_created_by    UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stock_before  INTEGER;
  v_stock_after   INTEGER;
  v_mov_id        UUID;
BEGIN
  -- Obtener stock actual (de variante si existe, si no del producto)
  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_stock_before
    FROM public.product_variants
    WHERE id = p_variant_id;
  ELSE
    SELECT stock INTO v_stock_before
    FROM public.products
    WHERE id = p_product_id;
  END IF;

  v_stock_before := COALESCE(v_stock_before, 0);
  v_stock_after  := v_stock_before + p_quantity;

  -- Actualizar stock en tabla origen
  IF p_variant_id IS NOT NULL THEN
    UPDATE public.product_variants
    SET stock = v_stock_after
    WHERE id = p_variant_id;

    -- Sincronizar stock del producto padre como suma de variantes
    UPDATE public.products p
    SET stock = (
      SELECT COALESCE(SUM(pv.stock), 0)
      FROM public.product_variants pv
      WHERE pv.product_id = p.id
    )
    WHERE id = p_product_id;
  ELSE
    UPDATE public.products
    SET stock = v_stock_after
    WHERE id = p_product_id;
  END IF;

  -- Insertar movimiento
  INSERT INTO public.stock_movements (
    org_id, product_id, variant_id, product_name, variant_name,
    movement_type, quantity, stock_before, stock_after,
    reference_type, reference_id,
    unit_cost_usd, unit_price_ars,
    notes, created_by
  ) VALUES (
    p_org_id, p_product_id, p_variant_id, p_product_name, p_variant_name,
    p_movement_type, p_quantity, v_stock_before, v_stock_after,
    p_reference_type, p_reference_id,
    p_unit_cost_usd, p_unit_price_ars,
    p_notes, p_created_by
  )
  RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;

-- ============================================================================
-- 3. Trigger: registrar movimiento al completar una venta (sales)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_sale_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id       UUID;
  v_variant_name TEXT;
BEGIN
  -- Obtener org_id desde el user_id de la venta (via memberships)
  SELECT m.org_id INTO v_org_id
  FROM public.memberships m
  WHERE m.user_id = NEW.user_id
  ORDER BY m.joined_at
  LIMIT 1;

  IF v_org_id IS NULL THEN RETURN NEW; END IF;

  -- Nombre de variante (si aplica)
  IF NEW.variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name
    FROM public.product_variants WHERE id = NEW.variant_id;
  END IF;

  PERFORM public.record_stock_movement(
    p_org_id         => v_org_id,
    p_product_id     => NEW.product_id,
    p_variant_id     => NEW.variant_id,
    p_product_name   => NEW.product_name,
    p_variant_name   => v_variant_name,
    p_movement_type  => 'sale',
    p_quantity       => -NEW.quantity,   -- salida
    p_reference_type => 'sale',
    p_reference_id   => NEW.id,
    p_unit_cost_usd  => NEW.cost_per_unit_usd,
    p_unit_price_ars => NEW.unit_price_ars,
    p_created_by     => NEW.user_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_stock_movement ON public.sales;
DROP TRIGGER IF EXISTS trg_sale_stock_movement ON public.sales;
CREATE TRIGGER trg_sale_stock_movement
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_stock_movement();

-- ============================================================================
-- 4. Trigger: registrar movimiento al registrar una compra (purchases)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_purchase_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT m.org_id INTO v_org_id
  FROM public.memberships m
  WHERE m.user_id = NEW.user_id
  ORDER BY m.joined_at
  LIMIT 1;

  IF v_org_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public.record_stock_movement(
    p_org_id         => v_org_id,
    p_product_id     => NEW.product_id,
    p_variant_id     => NULL,
    p_product_name   => NEW.product_name,
    p_variant_name   => NULL,
    p_movement_type  => 'purchase',
    p_quantity       => NEW.quantity,   -- entrada
    p_reference_type => 'purchase',
    p_reference_id   => NEW.id,
    p_unit_cost_usd  => NEW.unit_cost_usd,
    p_created_by     => NEW.user_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_stock_movement ON public.purchases;
DROP TRIGGER IF EXISTS trg_purchase_stock_movement ON public.purchases;
CREATE TRIGGER trg_purchase_stock_movement
  AFTER INSERT ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.trg_purchase_stock_movement();

-- ============================================================================
-- 5. Vista agregada por producto (kardex resumido)
-- ============================================================================
CREATE OR REPLACE VIEW public.kardex_summary AS
SELECT
  sm.org_id,
  sm.product_id,
  sm.product_name,
  p.stock AS current_stock,
  COUNT(*)                                              AS total_movements,
  SUM(CASE WHEN sm.quantity > 0 THEN sm.quantity ELSE 0 END) AS total_in,
  SUM(CASE WHEN sm.quantity < 0 THEN ABS(sm.quantity) ELSE 0 END) AS total_out,
  MAX(sm.created_at)                                    AS last_movement_at
FROM public.stock_movements sm
LEFT JOIN public.products p ON p.id = sm.product_id
GROUP BY sm.org_id, sm.product_id, sm.product_name, p.stock;

-- ============================================================================
-- 6. Función de ajuste manual de stock (llamada desde UI)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_org_id        UUID,
  p_product_id    UUID,
  p_variant_id    UUID,
  p_new_stock     INTEGER,   -- stock objetivo después del ajuste
  p_notes         TEXT,
  p_created_by    UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_stock INTEGER;
  v_delta         INTEGER;
  v_product_name  TEXT;
  v_variant_name  TEXT;
  v_movement_type TEXT;
BEGIN
  -- Verificar membresía
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE org_id = p_org_id AND user_id = p_created_by
  ) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT name INTO v_product_name FROM public.products WHERE id = p_product_id;

  IF p_variant_id IS NOT NULL THEN
    SELECT variant_name, stock INTO v_variant_name, v_current_stock
    FROM public.product_variants WHERE id = p_variant_id;
  ELSE
    SELECT stock INTO v_current_stock FROM public.products WHERE id = p_product_id;
  END IF;

  v_current_stock := COALESCE(v_current_stock, 0);
  v_delta         := p_new_stock - v_current_stock;

  IF v_delta = 0 THEN RETURN NULL; END IF;

  v_movement_type := CASE WHEN v_delta > 0 THEN 'adjustment_in' ELSE 'adjustment_out' END;

  RETURN public.record_stock_movement(
    p_org_id         => p_org_id,
    p_product_id     => p_product_id,
    p_variant_id     => p_variant_id,
    p_product_name   => v_product_name,
    p_variant_name   => v_variant_name,
    p_movement_type  => v_movement_type,
    p_quantity       => v_delta,
    p_reference_type => 'manual',
    p_reference_id   => NULL,
    p_notes          => p_notes,
    p_created_by     => p_created_by
  );
END;
$$;

-- == MIGRATION: 20260505000004_onboarding_flag.sql ==

-- Persistir estado de onboarding por organizacion
-- Evita que el usuario vea el wizard al iniciar sesion desde otro dispositivo

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

-- Marcar como completadas las orgs que ya tienen settings con business_name configurado
-- (indica que pasaron por el wizard)
UPDATE public.organizations o
SET onboarding_completed = true
WHERE EXISTS (
  SELECT 1 FROM public.settings s
  WHERE s.org_id = o.id
    AND s.business_name IS NOT NULL
    AND s.business_name != ''
    AND s.business_name != 'Mi Negocio'
);

-- == MIGRATION: 20260505000005_operational_ledgers.sql ==

-- Operational ledgers: stock, treasury and customer payments

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  source_type text not null check (source_type in ('sale', 'purchase', 'return', 'exchange', 'adjustment', 'stock_count', 'transfer')),
  source_id uuid,
  movement_type text not null check (movement_type in ('in', 'out', 'adjustment')),
  quantity integer not null,
  previous_stock integer,
  new_stock integer,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.stock_movements enable row level security;

DROP POLICY IF EXISTS "org_members_manage_stock_movements" ON public.stock_movements;
create policy "org_members_manage_stock_movements" on public.stock_movements
  for all using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

create index if not exists stock_movements_org_created_idx on public.stock_movements (org_id, created_at desc);
create index if not exists stock_movements_product_idx on public.stock_movements (product_id, created_at desc);
create index if not exists stock_movements_variant_idx on public.stock_movements (variant_id, created_at desc);
create index if not exists stock_movements_source_idx on public.stock_movements (source_type, source_id);

create table if not exists public.financial_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  cash_session_id uuid references public.cash_sessions(id) on delete set null,
  source_type text not null check (source_type in ('sale', 'debt_payment', 'supplier_payment', 'return', 'expense', 'manual', 'cash_open', 'cash_close')),
  source_id uuid,
  direction text not null check (direction in ('in', 'out')),
  payment_method text not null,
  channel text not null check (channel in ('cash', 'bank', 'card', 'store_credit', 'other')),
  affects_cash boolean not null default false,
  affects_bank boolean not null default false,
  amount_ars numeric not null default 0,
  counterparty text,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  happened_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.financial_movements enable row level security;

DROP POLICY IF EXISTS "org_members_manage_financial_movements" ON public.financial_movements;
create policy "org_members_manage_financial_movements" on public.financial_movements
  for all using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

create index if not exists financial_movements_org_happened_idx on public.financial_movements (org_id, happened_at desc);
create index if not exists financial_movements_session_idx on public.financial_movements (cash_session_id, happened_at desc);
create index if not exists financial_movements_source_idx on public.financial_movements (source_type, source_id);

create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  customer_name text not null,
  amount_ars numeric not null default 0,
  payment_method text not null default 'efectivo',
  note text,
  paid_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

alter table public.customer_payments enable row level security;

DROP POLICY IF EXISTS "org_members_manage_customer_payments" ON public.customer_payments;
create policy "org_members_manage_customer_payments" on public.customer_payments
  for all using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

create index if not exists customer_payments_org_paid_idx on public.customer_payments (org_id, paid_at desc);
create index if not exists customer_payments_debt_idx on public.customer_payments (debt_id, paid_at desc);

alter table public.supplier_debts
  add column if not exists purchase_id uuid references public.purchases(id) on delete set null;

create index if not exists supplier_debts_purchase_idx on public.supplier_debts (purchase_id);

alter table public.returns
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists variant_id uuid references public.product_variants(id) on delete set null;

alter table public.sales
  add column if not exists returned_quantity integer not null default 0;

-- == MIGRATION: 20260505000006_sales_quote_link.sql ==

-- Link sales back to their originating quote
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_quote ON public.sales(quote_id)
  WHERE quote_id IS NOT NULL;

-- == MIGRATION: 20260505000007_trial_expiration_cron.sql ==

-- Expire trials that ended without upgrading to a paid plan
-- Runs every hour via pg_cron (requires pg_cron extension enabled in Supabase dashboard)

CREATE OR REPLACE FUNCTION public.expire_overdue_trials()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Mark trialing subscriptions as past_due when trial_ends_at has passed
  UPDATE public.subscriptions s
  SET status = 'past_due'
  FROM public.organizations o
  WHERE s.org_id = o.id
    AND s.status = 'trialing'
    AND o.trial_ends_at IS NOT NULL
    AND o.trial_ends_at < now()
    AND s.stripe_subscription_id IS NULL; -- Only orgs that never entered a payment method

  -- For orgs that DID add a payment method (have stripe_subscription_id),
  -- Stripe handles the transition via webhooks — don't override.
END;
$$;

-- Schedule: run every hour (requires pg_cron)
SELECT cron.schedule(
  'expire-overdue-trials',
  '0 * * * *',
  $$ SELECT public.expire_overdue_trials(); $$
) WHERE EXISTS (
  SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
);

-- == MIGRATION: 20260506000001_afip_improvements.sql ==

-- AFIP: add environment tracking and expanded error status on invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS afip_environment text
  CHECK (afip_environment IN ('homologacion', 'produccion'));

-- Expand afip_status to cover new error states
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_afip_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_afip_status_check
  CHECK (afip_status IN ('pending','authorized','rejected','error','config_error','network_error','validation_error','not_applicable'));

-- == MIGRATION: 20260506000002_catch_up_all_tables.sql ==

-- ============================================================================
-- CATCH-UP MIGRATION — 2026-05-06
-- Applies all migrations from 20260429 → 20260505 in one safe, idempotent run.
-- Run this in the Supabase SQL Editor to fix "table not found" errors.
-- Every statement uses IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS.
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TYPES
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE public.invoice_status AS ENUM ('draft','sent','paid','overdue','canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. INVOICES / FACTURAS (20260429_invoices)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number           text NOT NULL,
  customer_name    text NOT NULL,
  customer_email   text,
  customer_address text,
  customer_tax_id  text,
  issue_date       date NOT NULL DEFAULT CURRENT_DATE,
  due_date         date,
  status           public.invoice_status NOT NULL DEFAULT 'draft',
  notes            text,
  currency         text NOT NULL DEFAULT 'ARS',
  subtotal         numeric NOT NULL DEFAULT 0,
  tax_pct          numeric NOT NULL DEFAULT 0,
  tax_amount       numeric NOT NULL DEFAULT 0,
  total            numeric NOT NULL DEFAULT 0,
  paid_at          timestamptz,
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity    numeric NOT NULL DEFAULT 1,
  unit_price  numeric NOT NULL DEFAULT 0,
  total       numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  org_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0
);

ALTER TABLE public.invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_select" ON public.invoices;
DROP POLICY IF EXISTS "invoice_select" ON public.invoices;
CREATE POLICY "invoice_select" ON public.invoices FOR SELECT USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);
DROP POLICY IF EXISTS "invoice_insert" ON public.invoices;
DROP POLICY IF EXISTS "invoice_insert" ON public.invoices;
CREATE POLICY "invoice_insert" ON public.invoices FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid() AND role IN ('owner','admin'))
);
DROP POLICY IF EXISTS "invoice_update" ON public.invoices;
DROP POLICY IF EXISTS "invoice_update" ON public.invoices;
CREATE POLICY "invoice_update" ON public.invoices FOR UPDATE USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid() AND role IN ('owner','admin'))
);
DROP POLICY IF EXISTS "invoice_delete" ON public.invoices;
DROP POLICY IF EXISTS "invoice_delete" ON public.invoices;
CREATE POLICY "invoice_delete" ON public.invoices FOR DELETE USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid() AND role IN ('owner','admin'))
);
DROP POLICY IF EXISTS "invoice_items_select" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_select" ON public.invoice_items;
CREATE POLICY "invoice_items_select" ON public.invoice_items FOR SELECT USING (
  invoice_id IN (SELECT id FROM public.invoices WHERE org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
);
DROP POLICY IF EXISTS "invoice_items_all" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_all" ON public.invoice_items;
CREATE POLICY "invoice_items_all" ON public.invoice_items FOR ALL USING (
  invoice_id IN (SELECT id FROM public.invoices WHERE org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid() AND role IN ('owner','admin')))
);
DROP POLICY IF EXISTS "invoice_seq_all" ON public.invoice_sequences;
DROP POLICY IF EXISTS "invoice_seq_all" ON public.invoice_sequences;
CREATE POLICY "invoice_seq_all" ON public.invoice_sequences FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid() AND role IN ('owner','admin'))
);

CREATE INDEX IF NOT EXISTS idx_invoices_org        ON public.invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status     ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(invoice_id);

-- AFIP fields for invoices (20260504_afip_fields)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tipo_comprobante integer,
  ADD COLUMN IF NOT EXISTS cae              text,
  ADD COLUMN IF NOT EXISTS cae_vencimiento  date,
  ADD COLUMN IF NOT EXISTS afip_status      text DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS afip_error       text,
  ADD COLUMN IF NOT EXISTS numero_afip      integer;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. BARCODE + VARIANT IMPROVEMENTS (20260430_barcode_variants)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS sku     text;

CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_sku     ON public.products(sku)     WHERE sku IS NOT NULL;

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS variant_type    text NOT NULL DEFAULT 'sabor',
  ADD COLUMN IF NOT EXISTS price_override  numeric;

CREATE INDEX IF NOT EXISTS idx_product_variants_org ON public.product_variants(org_id) WHERE org_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. CASH SESSIONS (20260430_cash_sessions)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opened_by       uuid REFERENCES auth.users(id),
  closed_by       uuid REFERENCES auth.users(id),
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  opening_amount  numeric NOT NULL DEFAULT 0,
  closing_amount  numeric,
  expected_cash   numeric,
  difference      numeric,
  notes           text,
  status          text NOT NULL DEFAULT 'open'
);

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cash_sessions_org" ON public.cash_sessions;
DROP POLICY IF EXISTS "cash_sessions_org" ON public.cash_sessions;
CREATE POLICY "cash_sessions_org" ON public.cash_sessions FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_org    ON public.cash_sessions(org_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON public.cash_sessions(org_id, status);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. QUOTES / PRESUPUESTOS (20260430_presupuestos)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quote_number    text NOT NULL,
  customer_name   text NOT NULL,
  customer_email  text,
  customer_phone  text,
  items           jsonb NOT NULL DEFAULT '[]',
  subtotal        numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  total           numeric NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'draft',
  valid_until     date,
  notes           text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quote_sequences (
  org_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0
);

ALTER TABLE public.quotes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quotes_org" ON public.quotes;
DROP POLICY IF EXISTS "quotes_org" ON public.quotes;
CREATE POLICY "quotes_org" ON public.quotes FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);
DROP POLICY IF EXISTS "quote_sequences_org" ON public.quote_sequences;
DROP POLICY IF EXISTS "quote_sequences_org" ON public.quote_sequences;
CREATE POLICY "quote_sequences_org" ON public.quote_sequences FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_quotes_org    ON public.quotes(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON public.quotes(org_id, status);

CREATE OR REPLACE FUNCTION public.next_quote_number(p_org_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_next integer;
BEGIN
  INSERT INTO public.quote_sequences (org_id, last_number) VALUES (p_org_id, 1)
  ON CONFLICT (org_id) DO UPDATE SET last_number = quote_sequences.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'PRE-' || LPAD(v_next::text, 4, '0');
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. SUPPLIERS / PROVEEDORES (20260430_proveedores)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  contact    text,
  phone      text,
  email      text,
  address    text,
  notes      text,
  tags       text[],
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers_org" ON public.suppliers;
DROP POLICY IF EXISTS "suppliers_org" ON public.suppliers;
CREATE POLICY "suppliers_org" ON public.suppliers FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_org      ON public.suppliers(org_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON public.purchases(supplier_id) WHERE supplier_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. TIENDANUBE INTEGRATION (20260430_tiendanube)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tiendanube_connections (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id                 text NOT NULL,
  access_token             text NOT NULL,
  store_name               text,
  store_url                text,
  connected_at             timestamptz NOT NULL DEFAULT now(),
  last_sync_products_at    timestamptz,
  last_sync_orders_at      timestamptz,
  sync_products            boolean NOT NULL DEFAULT true,
  sync_orders              boolean NOT NULL DEFAULT true,
  UNIQUE(org_id, store_id)
);

ALTER TABLE public.tiendanube_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tiendanube_connections_org" ON public.tiendanube_connections;
DROP POLICY IF EXISTS "tiendanube_connections_org" ON public.tiendanube_connections;
CREATE POLICY "tiendanube_connections_org" ON public.tiendanube_connections FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tiendanube_id text;
ALTER TABLE public.sales    ADD COLUMN IF NOT EXISTS tiendanube_order_id text;
ALTER TABLE public.tiendanube_connections ADD COLUMN IF NOT EXISTS webhook_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tiendanube_unique ON public.products(org_id, tiendanube_id) WHERE tiendanube_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_tiendanube    ON public.sales(org_id, tiendanube_order_id) WHERE tiendanube_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tiendanube_conn_org ON public.tiendanube_connections(org_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. DEVOLUCIONES + MERCADO PAGO (20260430_sprint3)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.returns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id),
  sale_id       uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  product_id    uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name  text NOT NULL,
  quantity      integer NOT NULL DEFAULT 1,
  amount_ars    numeric NOT NULL DEFAULT 0,
  reason        text,
  refund_method text NOT NULL DEFAULT 'efectivo',
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "returns_org" ON public.returns;
DROP POLICY IF EXISTS "returns_org" ON public.returns;
CREATE POLICY "returns_org" ON public.returns FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_returns_org  ON public.returns(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_sale ON public.returns(sale_id) WHERE sale_id IS NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS returned  boolean NOT NULL DEFAULT false;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS return_id uuid REFERENCES public.returns(id) ON DELETE SET NULL;

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS mp_access_token text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS mp_enabled      boolean NOT NULL DEFAULT false;


-- ═══════════════════════════════════════════════════════════════════════════
-- 9. CUSTOMERS + SPLIT PAYMENTS (20260502_sprint4_features)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS split_payments      jsonb   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS global_discount_ars numeric DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.customers (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id),
  name       text        NOT NULL,
  email      text,
  phone      text,
  address    text,
  birthday   date,
  tags       text[]      DEFAULT '{}',
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_customers" ON public.customers;
DROP POLICY IF EXISTS "org_members_manage_customers" ON public.customers;
CREATE POLICY "org_members_manage_customers" ON public.customers FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS customers_org_id_idx ON public.customers(org_id);
CREATE INDEX IF NOT EXISTS customers_name_idx   ON public.customers(org_id, name);


-- ═══════════════════════════════════════════════════════════════════════════
-- 10. BANK TRANSACTIONS (20260503_bank_transactions)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date        date        NOT NULL,
  description text        NOT NULL,
  amount_ars  numeric     NOT NULL,
  type        text        NOT NULL CHECK (type IN ('credit','debit')),
  matched     boolean     NOT NULL DEFAULT false,
  match_ref   text,
  account     text        NOT NULL DEFAULT 'Cuenta Principal',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_bank_transactions" ON public.bank_transactions;
DROP POLICY IF EXISTS "org_members_manage_bank_transactions" ON public.bank_transactions;
CREATE POLICY "org_members_manage_bank_transactions" ON public.bank_transactions FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS bank_transactions_org_date_idx ON public.bank_transactions(org_id, date DESC);
CREATE INDEX IF NOT EXISTS bank_transactions_matched_idx  ON public.bank_transactions(org_id, matched);


-- ═══════════════════════════════════════════════════════════════════════════
-- 11. EMAIL CAMPAIGNS (20260503_email_campaigns)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subject      text        NOT NULL,
  body_html    text        NOT NULL,
  segment      text        NOT NULL DEFAULT 'all',
  status       text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent','failed')),
  sent_count   integer     NOT NULL DEFAULT 0,
  failed_count integer     NOT NULL DEFAULT 0,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_email_campaigns" ON public.email_campaigns;
DROP POLICY IF EXISTS "org_members_manage_email_campaigns" ON public.email_campaigns;
CREATE POLICY "org_members_manage_email_campaigns" ON public.email_campaigns FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS email_campaigns_org_id_idx ON public.email_campaigns(org_id);
CREATE INDEX IF NOT EXISTS email_campaigns_status_idx ON public.email_campaigns(org_id, status);

-- Settings columns for monthly targets and API key
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS monthly_targets jsonb DEFAULT NULL;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS api_key         text UNIQUE DEFAULT NULL;
CREATE INDEX IF NOT EXISTS settings_api_key_idx ON public.settings(api_key) WHERE api_key IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 12. SUPPLIER DEBTS (20260503_supplier_debts)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.supplier_debts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id   uuid        REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name text        NOT NULL,
  description   text        NOT NULL,
  amount_ars    numeric     NOT NULL DEFAULT 0,
  paid_ars      numeric     NOT NULL DEFAULT 0,
  remaining_ars numeric     GENERATED ALWAYS AS (amount_ars - paid_ars) STORED,
  due_date      date,
  status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','paid')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_debts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_supplier_debts" ON public.supplier_debts;
DROP POLICY IF EXISTS "org_members_manage_supplier_debts" ON public.supplier_debts;
CREATE POLICY "org_members_manage_supplier_debts" ON public.supplier_debts FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS supplier_debts_org_id_idx   ON public.supplier_debts(org_id);
CREATE INDEX IF NOT EXISTS supplier_debts_status_idx   ON public.supplier_debts(org_id, status);
CREATE INDEX IF NOT EXISTS supplier_debts_due_date_idx ON public.supplier_debts(org_id, due_date);

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_debt_id uuid        NOT NULL REFERENCES public.supplier_debts(id) ON DELETE CASCADE,
  amount_ars       numeric     NOT NULL,
  method           text        NOT NULL DEFAULT 'transferencia',
  note             text,
  paid_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_supplier_payments" ON public.supplier_payments;
DROP POLICY IF EXISTS "org_members_manage_supplier_payments" ON public.supplier_payments;
CREATE POLICY "org_members_manage_supplier_payments" ON public.supplier_payments FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);


-- ═══════════════════════════════════════════════════════════════════════════
-- 13. CHEQUES (20260504_cheques)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cheques (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type          text NOT NULL DEFAULT 'received' CHECK (type IN ('received','issued')),
  customer_name text,
  bank_name     text,
  check_number  text,
  amount_ars    numeric NOT NULL,
  issue_date    date,
  due_date      date NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','deposited','cleared','bounced','cancelled')),
  deposited_at  date,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cheques ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cheques_org_access" ON public.cheques;
DROP POLICY IF EXISTS "cheques_org_access" ON public.cheques;
CREATE POLICY "cheques_org_access" ON public.cheques FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS cheques_org_due_idx ON public.cheques(org_id, due_date, status);


-- ═══════════════════════════════════════════════════════════════════════════
-- 14. INSTALLMENT SCHEDULE / CUOTAS (20260504_cuotas)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS installments            integer DEFAULT 1 CHECK (installments >= 1),
  ADD COLUMN IF NOT EXISTS installment_amount_ars  numeric,
  ADD COLUMN IF NOT EXISTS first_installment_date  date;

CREATE TABLE IF NOT EXISTS public.installment_schedule (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id             uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  installment_number  integer NOT NULL,
  amount_ars          numeric NOT NULL,
  due_date            date NOT NULL,
  paid                boolean NOT NULL DEFAULT false,
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.installment_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "installment_schedule_org_access" ON public.installment_schedule;
DROP POLICY IF EXISTS "installment_schedule_org_access" ON public.installment_schedule;
CREATE POLICY "installment_schedule_org_access" ON public.installment_schedule FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS installment_schedule_org_due_idx ON public.installment_schedule(org_id, due_date, paid);
CREATE INDEX IF NOT EXISTS installment_schedule_sale_idx    ON public.installment_schedule(sale_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 15. CUSTOMER COMMUNICATIONS (20260504_customer_comms)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.customer_communications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  type          text NOT NULL DEFAULT 'note' CHECK (type IN ('note','call','whatsapp','email','visit','other')),
  summary       text NOT NULL,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.customer_communications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comm_org_access" ON public.customer_communications;
DROP POLICY IF EXISTS "comm_org_access" ON public.customer_communications;
CREATE POLICY "comm_org_access" ON public.customer_communications FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS customer_comms_org_name_idx
  ON public.customer_communications(org_id, customer_name, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 16. DEALS / PIPELINE (20260504_deals)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.deals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title          text NOT NULL,
  customer_name  text,
  value_ars      numeric DEFAULT 0,
  stage          text NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead','contactado','propuesta','negociacion','cerrado','perdido')),
  notes          text,
  expected_close date,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deals_org_access" ON public.deals;
DROP POLICY IF EXISTS "deals_org_access" ON public.deals;
CREATE POLICY "deals_org_access" ON public.deals FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS deals_org_stage_idx ON public.deals(org_id, stage);


-- ═══════════════════════════════════════════════════════════════════════════
-- 17. LOYALTY POINTS (20260504_loyalty)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.loyalty_points (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  delta         integer NOT NULL,
  reason        text,
  reference_id  uuid,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.loyalty_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loyalty_org_access" ON public.loyalty_points;
DROP POLICY IF EXISTS "loyalty_org_access" ON public.loyalty_points;
CREATE POLICY "loyalty_org_access" ON public.loyalty_points FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS loyalty_org_customer_idx ON public.loyalty_points(org_id, customer_name);

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS loyalty_enabled          boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS loyalty_points_per_1000  integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS loyalty_points_value_ars integer DEFAULT 100;


-- ═══════════════════════════════════════════════════════════════════════════
-- 18. MARKETING TEMPLATES (20260504_marketing_templates)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.marketing_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title       text NOT NULL,
  content     text NOT NULL,
  post_type   text NOT NULL DEFAULT 'post',
  industry    text,
  tags        text[] DEFAULT '{}',
  is_public   boolean NOT NULL DEFAULT false,
  likes       integer NOT NULL DEFAULT 0,
  uses_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketing_templates_read_public" ON public.marketing_templates;
DROP POLICY IF EXISTS "marketing_templates_read_public" ON public.marketing_templates;
CREATE POLICY "marketing_templates_read_public" ON public.marketing_templates FOR SELECT USING (
  is_public = true OR org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);
DROP POLICY IF EXISTS "marketing_templates_manage_own" ON public.marketing_templates;
DROP POLICY IF EXISTS "marketing_templates_manage_own" ON public.marketing_templates;
CREATE POLICY "marketing_templates_manage_own" ON public.marketing_templates FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS marketing_templates_public_idx ON public.marketing_templates(is_public, likes DESC);
CREATE INDEX IF NOT EXISTS marketing_templates_org_idx    ON public.marketing_templates(org_id, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 19. PAYMENT LINKS (20260504_payment_links) — FK bug fixed: quotes not presupuestos
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.payment_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quote_id      uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  quote_number  text,
  customer_name text NOT NULL,
  customer_phone text,
  items         jsonb NOT NULL DEFAULT '[]',
  total_ars     numeric NOT NULL,
  mp_link       text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','pending_confirmation','paid','cancelled')),
  paid_at       timestamptz,
  notes         text,
  expires_at    date,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_links_org_access" ON public.payment_links;
DROP POLICY IF EXISTS "payment_links_org_access" ON public.payment_links;
CREATE POLICY "payment_links_org_access" ON public.payment_links FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);
DROP POLICY IF EXISTS "payment_links_public_read" ON public.payment_links;
DROP POLICY IF EXISTS "payment_links_public_read" ON public.payment_links;
CREATE POLICY "payment_links_public_read" ON public.payment_links FOR SELECT USING (true);
DROP POLICY IF EXISTS "payment_links_customer_update" ON public.payment_links;
DROP POLICY IF EXISTS "payment_links_customer_update" ON public.payment_links;
CREATE POLICY "payment_links_customer_update" ON public.payment_links FOR UPDATE
  USING (true) WITH CHECK (status IN ('pending_confirmation'));

CREATE INDEX IF NOT EXISTS payment_links_org_idx   ON public.payment_links(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_links_quote_idx ON public.payment_links(quote_id);

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS bank_cbu    text,
  ADD COLUMN IF NOT EXISTS bank_alias  text,
  ADD COLUMN IF NOT EXISTS bank_name   text,
  ADD COLUMN IF NOT EXISTS bank_holder text;


-- ═══════════════════════════════════════════════════════════════════════════
-- 20. PRICE HISTORY (20260504_price_history)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.price_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  old_price_ars numeric,
  new_price_ars numeric NOT NULL,
  old_cost_usd  numeric,
  new_cost_usd  numeric,
  change_pct    numeric,
  changed_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "price_history_org_access" ON public.price_history;
DROP POLICY IF EXISTS "price_history_org_access" ON public.price_history;
CREATE POLICY "price_history_org_access" ON public.price_history FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS price_history_product_idx ON public.price_history(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS price_history_org_idx     ON public.price_history(org_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_price_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (TG_OP = 'UPDATE') AND (
    OLD.sale_price_ars IS DISTINCT FROM NEW.sale_price_ars OR
    OLD.total_cost_usd IS DISTINCT FROM NEW.total_cost_usd
  ) THEN
    INSERT INTO public.price_history (
      product_id, org_id,
      old_price_ars, new_price_ars,
      old_cost_usd,  new_cost_usd,
      change_pct, changed_by
    ) VALUES (
      NEW.id, NEW.org_id,
      OLD.sale_price_ars, NEW.sale_price_ars,
      OLD.total_cost_usd, NEW.total_cost_usd,
      CASE WHEN OLD.sale_price_ars > 0
        THEN ROUND(((NEW.sale_price_ars - OLD.sale_price_ars) / OLD.sale_price_ars) * 100, 1)
        ELSE NULL
      END,
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_price_change ON public.products;
DROP TRIGGER IF EXISTS trg_record_price_change ON public.products;
CREATE TRIGGER trg_record_price_change
  AFTER UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.record_price_change();


-- ═══════════════════════════════════════════════════════════════════════════
-- 21. CUSTOMER REFERRALS (20260504_referrals)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.customer_referrals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  referrer_name   text NOT NULL,
  referred_name   text NOT NULL,
  referral_code   text NOT NULL,
  bonus_ars       numeric DEFAULT 0,
  bonus_points    integer DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','credited','cancelled')),
  sale_id         uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referrals_org_access" ON public.customer_referrals;
DROP POLICY IF EXISTS "referrals_org_access" ON public.customer_referrals;
CREATE POLICY "referrals_org_access" ON public.customer_referrals FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS referrals_org_code_idx    ON public.customer_referrals(org_id, referral_code);
CREATE INDEX IF NOT EXISTS referrals_org_referrer_idx ON public.customer_referrals(org_id, referrer_name);

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS referral_enabled      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS referral_bonus_ars    integer DEFAULT 500,
  ADD COLUMN IF NOT EXISTS referral_bonus_points integer DEFAULT 5;


-- ═══════════════════════════════════════════════════════════════════════════
-- 22. SELLER COMMISSIONS (20260504_seller_commissions)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS commission_percent  numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_enabled  boolean DEFAULT false;

CREATE TABLE IF NOT EXISTS public.seller_payouts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_name        text NOT NULL,
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  sales_total_ars    numeric NOT NULL DEFAULT 0,
  commission_percent numeric NOT NULL DEFAULT 0,
  commission_ars     numeric NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  paid_at            timestamptz,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seller_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seller_payouts_org_access" ON public.seller_payouts;
DROP POLICY IF EXISTS "seller_payouts_org_access" ON public.seller_payouts;
CREATE POLICY "seller_payouts_org_access" ON public.seller_payouts FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS seller_payouts_org_idx  ON public.seller_payouts(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS seller_payouts_user_idx ON public.seller_payouts(user_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 23. TASKS (20260504_tasks)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title        text NOT NULL,
  description  text,
  priority     text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','cancelled')),
  due_date     date,
  completed_at timestamptz,
  category     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_org_access" ON public.tasks;
DROP POLICY IF EXISTS "tasks_org_access" ON public.tasks;
CREATE POLICY "tasks_org_access" ON public.tasks FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS tasks_org_status_idx ON public.tasks(org_id, status, due_date);
CREATE INDEX IF NOT EXISTS tasks_assigned_idx   ON public.tasks(assigned_to, status);


-- ═══════════════════════════════════════════════════════════════════════════
-- 24. AUTOMATION FLOWS (20260504_automation_flows + v2)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.automation_flows (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name           text NOT NULL,
  trigger_type   text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}',
  action_type    text NOT NULL,
  action_config  jsonb NOT NULL DEFAULT '{}',
  active         boolean NOT NULL DEFAULT true,
  last_run_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_flows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_flows_org_access" ON public.automation_flows;
DROP POLICY IF EXISTS "automation_flows_org_access" ON public.automation_flows;
CREATE POLICY "automation_flows_org_access" ON public.automation_flows FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS automation_flows_org_active_idx ON public.automation_flows(org_id, active);

-- Widen check constraints (v2) — drop old, add new
ALTER TABLE public.automation_flows DROP CONSTRAINT IF EXISTS automation_flows_trigger_type_check;
ALTER TABLE public.automation_flows DROP CONSTRAINT IF EXISTS automation_flows_action_type_check;
ALTER TABLE public.automation_flows
  ADD CONSTRAINT automation_flows_trigger_type_check CHECK (trigger_type IN (
    'customer_inactive','debt_overdue','low_stock','birthday','stock_out','new_customer','big_sale'
  ));
ALTER TABLE public.automation_flows
  ADD CONSTRAINT automation_flows_action_type_check CHECK (action_type IN (
    'notification','email','whatsapp_message','create_task','create_purchase_order','webhook'
  ));


-- ═══════════════════════════════════════════════════════════════════════════
-- 25. LOCATIONS + STOCK TRANSFERS (20260504_locations)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.locations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  address    text,
  phone      text,
  is_main    boolean NOT NULL DEFAULT false,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "locations_org_access" ON public.locations;
DROP POLICY IF EXISTS "locations_org_access" ON public.locations;
CREATE POLICY "locations_org_access" ON public.locations FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS locations_org_idx ON public.locations(org_id, active);

CREATE TABLE IF NOT EXISTS public.location_stock (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  stock       integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(location_id, product_id)
);

ALTER TABLE public.location_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "location_stock_org_access" ON public.location_stock;
DROP POLICY IF EXISTS "location_stock_org_access" ON public.location_stock;
CREATE POLICY "location_stock_org_access" ON public.location_stock FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  to_location_id   uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  product_id       uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_name     text NOT NULL,
  quantity         integer NOT NULL CHECK (quantity > 0),
  notes            text,
  transferred_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_transfers_org_access" ON public.stock_transfers;
DROP POLICY IF EXISTS "stock_transfers_org_access" ON public.stock_transfers;
CREATE POLICY "stock_transfers_org_access" ON public.stock_transfers FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS stock_transfers_org_idx ON public.stock_transfers(org_id, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 26. PRODUCT LOTS + TAGS (20260504_product_lots, 20260504_product_tags)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS lot_number  text,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS tags        text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS products_expiry_idx ON public.products(org_id, expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_tags_idx   ON public.products USING gin(tags) WHERE tags IS NOT NULL AND array_length(tags, 1) > 0;


-- ═══════════════════════════════════════════════════════════════════════════
-- 27. SETTINGS — remaining columns (webhook, AFIP, daily KPI alert)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS webhook_url     text,
  ADD COLUMN IF NOT EXISTS webhook_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS webhook_events  text[]  DEFAULT ARRAY['sale.created','stock.low','debt.overdue'];

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS afip_cuit            text,
  ADD COLUMN IF NOT EXISTS afip_razon_social    text,
  ADD COLUMN IF NOT EXISTS afip_domicilio       text,
  ADD COLUMN IF NOT EXISTS afip_punto_venta     integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS afip_environment     text    DEFAULT 'homologacion',
  ADD COLUMN IF NOT EXISTS afip_tipo_emisor     text    DEFAULT 'monotributo',
  ADD COLUMN IF NOT EXISTS afip_certificate     text,
  ADD COLUMN IF NOT EXISTS afip_private_key     text,
  ADD COLUMN IF NOT EXISTS afip_ta_token        text,
  ADD COLUMN IF NOT EXISTS afip_ta_sign         text,
  ADD COLUMN IF NOT EXISTS afip_ta_expires_at   timestamptz;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS daily_sales_alert_threshold  numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_margin_alert_threshold numeric DEFAULT 0;


-- ═══════════════════════════════════════════════════════════════════════════
-- 28. CASH ENTRIES (20260505_cash_entries)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cash_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id     UUID REFERENCES public.cash_sessions(id) ON DELETE SET NULL,
  entry_type     TEXT NOT NULL,
  payment_method TEXT,
  amount_ars     NUMERIC NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id   UUID,
  description    TEXT,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_entries_org     ON public.cash_entries(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_entries_session ON public.cash_entries(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_entries_ref     ON public.cash_entries(reference_type, reference_id);

ALTER TABLE public.cash_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members manage cash entries" ON public.cash_entries;
DROP POLICY IF EXISTS "org members manage cash entries" ON public.cash_entries;
CREATE POLICY "org members manage cash entries" ON public.cash_entries FOR ALL TO authenticated
  USING    (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.trg_sale_cash_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id  UUID;
  v_session UUID;
BEGIN
  IF NOT NEW.paid THEN RETURN NEW; END IF;
  IF NEW.payment_method NOT IN ('efectivo','transferencia','debito','credito','mayorista') THEN
    RETURN NEW;
  END IF;
  SELECT m.org_id INTO v_org_id FROM public.memberships m WHERE m.user_id = NEW.user_id ORDER BY m.joined_at LIMIT 1;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_session FROM public.cash_sessions WHERE org_id = v_org_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF v_session IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.cash_entries (org_id, session_id, entry_type, payment_method, amount_ars, reference_type, reference_id, description, created_by)
  VALUES (v_org_id, v_session, 'sale_in', COALESCE(NEW.payment_method,'efectivo'), NEW.total_ars, 'sale', NEW.id, 'Venta ' || COALESCE(NEW.payment_method,'') || ': ' || NEW.product_name, NEW.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_cash_entry ON public.sales;
DROP TRIGGER IF EXISTS trg_sale_cash_entry ON public.sales;
CREATE TRIGGER trg_sale_cash_entry
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_cash_entry();

CREATE OR REPLACE VIEW public.cash_session_summary AS
SELECT
  cs.id AS session_id,
  cs.org_id, cs.opened_at, cs.closed_at, cs.status, cs.opening_amount,
  COALESCE(SUM(CASE WHEN ce.payment_method='efectivo' AND ce.entry_type IN ('sale_in','debt_payment','manual_in') THEN ce.amount_ars
                    WHEN ce.entry_type IN ('expense_out','supplier_out','manual_out') AND ce.payment_method='efectivo' THEN -ce.amount_ars
                    ELSE 0 END), 0) AS efectivo_neto,
  COALESCE(SUM(CASE WHEN ce.payment_method='transferencia' AND ce.entry_type IN ('sale_in','debt_payment') THEN ce.amount_ars ELSE 0 END), 0) AS transferencia_total,
  COALESCE(SUM(CASE WHEN ce.payment_method IN ('debito','credito') AND ce.entry_type IN ('sale_in','debt_payment') THEN ce.amount_ars ELSE 0 END), 0) AS tarjeta_total,
  COALESCE(SUM(CASE WHEN ce.entry_type='sale_in' THEN ce.amount_ars ELSE 0 END), 0) AS total_ventas,
  COALESCE(SUM(CASE WHEN ce.entry_type='debt_payment' THEN ce.amount_ars ELSE 0 END), 0) AS total_cobros,
  COALESCE(SUM(CASE WHEN ce.entry_type IN ('expense_out','supplier_out','manual_out') THEN ce.amount_ars ELSE 0 END), 0) AS total_egresos,
  COUNT(ce.id) AS total_movements
FROM public.cash_sessions cs
LEFT JOIN public.cash_entries ce ON ce.session_id = cs.id
GROUP BY cs.id, cs.org_id, cs.opened_at, cs.closed_at, cs.status, cs.opening_amount;

CREATE OR REPLACE FUNCTION public.record_debt_payment_cash_entry(
  p_org_id UUID, p_debt_id UUID, p_amount_ars NUMERIC,
  p_payment_method TEXT, p_description TEXT, p_created_by UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_session  UUID;
  v_entry_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE org_id = p_org_id AND user_id = p_created_by)
  THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT id INTO v_session FROM public.cash_sessions WHERE org_id = p_org_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
  INSERT INTO public.cash_entries (org_id, session_id, entry_type, payment_method, amount_ars, reference_type, reference_id, description, created_by)
  VALUES (p_org_id, v_session, 'debt_payment', p_payment_method, p_amount_ars, 'debt', p_debt_id, COALESCE(p_description,'Cobro de deuda'), p_created_by)
  RETURNING id INTO v_entry_id;
  RETURN v_entry_id;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 29. KARDEX — STOCK MOVEMENTS (20260505_kardex)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id     UUID REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id     UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_name   TEXT NOT NULL,
  variant_name   TEXT,
  movement_type  TEXT NOT NULL,
  quantity       INTEGER NOT NULL,
  stock_before   INTEGER NOT NULL DEFAULT 0,
  stock_after    INTEGER NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id   UUID,
  unit_cost_usd  NUMERIC,
  unit_price_ars NUMERIC,
  notes          TEXT,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_org     ON public.stock_movements(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON public.stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant ON public.stock_movements(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type    ON public.stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref     ON public.stock_movements(reference_type, reference_id);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members read stock movements" ON public.stock_movements;
DROP POLICY IF EXISTS "org members read stock movements" ON public.stock_movements;
CREATE POLICY "org members read stock movements" ON public.stock_movements FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "org members insert stock movements" ON public.stock_movements;
DROP POLICY IF EXISTS "org members insert stock movements" ON public.stock_movements;
CREATE POLICY "org members insert stock movements" ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_org_id UUID, p_product_id UUID, p_variant_id UUID,
  p_product_name TEXT, p_variant_name TEXT,
  p_movement_type TEXT, p_quantity INTEGER,
  p_reference_type TEXT DEFAULT NULL, p_reference_id UUID DEFAULT NULL,
  p_unit_cost_usd NUMERIC DEFAULT NULL, p_unit_price_ars NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL, p_created_by UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_stock_before INTEGER;
  v_stock_after  INTEGER;
  v_mov_id       UUID;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_stock_before FROM public.product_variants WHERE id = p_variant_id;
  ELSE
    SELECT stock INTO v_stock_before FROM public.products WHERE id = p_product_id;
  END IF;
  v_stock_before := COALESCE(v_stock_before, 0);
  v_stock_after  := v_stock_before + p_quantity;
  IF p_variant_id IS NOT NULL THEN
    UPDATE public.product_variants SET stock = v_stock_after WHERE id = p_variant_id;
    UPDATE public.products p SET stock = (SELECT COALESCE(SUM(pv.stock),0) FROM public.product_variants pv WHERE pv.product_id = p.id) WHERE id = p_product_id;
  ELSE
    UPDATE public.products SET stock = v_stock_after WHERE id = p_product_id;
  END IF;
  INSERT INTO public.stock_movements (
    org_id, product_id, variant_id, product_name, variant_name,
    movement_type, quantity, stock_before, stock_after,
    reference_type, reference_id, unit_cost_usd, unit_price_ars, notes, created_by
  ) VALUES (
    p_org_id, p_product_id, p_variant_id, p_product_name, p_variant_name,
    p_movement_type, p_quantity, v_stock_before, v_stock_after,
    p_reference_type, p_reference_id, p_unit_cost_usd, p_unit_price_ars, p_notes, p_created_by
  ) RETURNING id INTO v_mov_id;
  RETURN v_mov_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sale_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id       UUID;
  v_variant_name TEXT;
BEGIN
  SELECT m.org_id INTO v_org_id FROM public.memberships m WHERE m.user_id = NEW.user_id ORDER BY m.joined_at LIMIT 1;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name FROM public.product_variants WHERE id = NEW.variant_id;
  END IF;
  PERFORM public.record_stock_movement(
    p_org_id=>v_org_id, p_product_id=>NEW.product_id, p_variant_id=>NEW.variant_id,
    p_product_name=>NEW.product_name, p_variant_name=>v_variant_name,
    p_movement_type=>'sale', p_quantity=>-NEW.quantity,
    p_reference_type=>'sale', p_reference_id=>NEW.id,
    p_unit_cost_usd=>NEW.cost_per_unit_usd, p_unit_price_ars=>NEW.unit_price_ars,
    p_created_by=>NEW.user_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_stock_movement ON public.sales;
DROP TRIGGER IF EXISTS trg_sale_stock_movement ON public.sales;
CREATE TRIGGER trg_sale_stock_movement
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_stock_movement();

CREATE OR REPLACE FUNCTION public.trg_purchase_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org_id UUID;
BEGIN
  SELECT m.org_id INTO v_org_id FROM public.memberships m WHERE m.user_id = NEW.user_id ORDER BY m.joined_at LIMIT 1;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.record_stock_movement(
    p_org_id=>v_org_id, p_product_id=>NEW.product_id, p_variant_id=>NULL,
    p_product_name=>NEW.product_name, p_variant_name=>NULL,
    p_movement_type=>'purchase', p_quantity=>NEW.quantity,
    p_reference_type=>'purchase', p_reference_id=>NEW.id,
    p_unit_cost_usd=>NEW.unit_cost_usd, p_created_by=>NEW.user_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_stock_movement ON public.purchases;
DROP TRIGGER IF EXISTS trg_purchase_stock_movement ON public.purchases;
CREATE TRIGGER trg_purchase_stock_movement
  AFTER INSERT ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.trg_purchase_stock_movement();

CREATE OR REPLACE VIEW public.kardex_summary AS
SELECT
  sm.org_id, sm.product_id, sm.product_name,
  p.stock AS current_stock,
  COUNT(*)                                                            AS total_movements,
  SUM(CASE WHEN sm.quantity > 0 THEN sm.quantity ELSE 0 END)         AS total_in,
  SUM(CASE WHEN sm.quantity < 0 THEN ABS(sm.quantity) ELSE 0 END)    AS total_out,
  MAX(sm.created_at)                                                  AS last_movement_at
FROM public.stock_movements sm
LEFT JOIN public.products p ON p.id = sm.product_id
GROUP BY sm.org_id, sm.product_id, sm.product_name, p.stock;

CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_org_id UUID, p_product_id UUID, p_variant_id UUID,
  p_new_stock INTEGER, p_notes TEXT, p_created_by UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_stock INTEGER;
  v_delta         INTEGER;
  v_product_name  TEXT;
  v_variant_name  TEXT;
  v_movement_type TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE org_id = p_org_id AND user_id = p_created_by)
  THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT name INTO v_product_name FROM public.products WHERE id = p_product_id;
  IF p_variant_id IS NOT NULL THEN
    SELECT variant_name, stock INTO v_variant_name, v_current_stock FROM public.product_variants WHERE id = p_variant_id;
  ELSE
    SELECT stock INTO v_current_stock FROM public.products WHERE id = p_product_id;
  END IF;
  v_current_stock := COALESCE(v_current_stock, 0);
  v_delta := p_new_stock - v_current_stock;
  IF v_delta = 0 THEN RETURN NULL; END IF;
  v_movement_type := CASE WHEN v_delta > 0 THEN 'adjustment_in' ELSE 'adjustment_out' END;
  RETURN public.record_stock_movement(
    p_org_id=>p_org_id, p_product_id=>p_product_id, p_variant_id=>p_variant_id,
    p_product_name=>v_product_name, p_variant_name=>v_variant_name,
    p_movement_type=>v_movement_type, p_quantity=>v_delta,
    p_reference_type=>'manual', p_notes=>p_notes, p_created_by=>p_created_by
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 30. ONBOARDING FLAG (20260505_onboarding_flag)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

UPDATE public.organizations o
SET onboarding_completed = true
WHERE onboarding_completed = false
  AND EXISTS (
    SELECT 1 FROM public.settings s
    WHERE s.org_id = o.id
      AND s.business_name IS NOT NULL
      AND s.business_name != ''
      AND s.business_name != 'Mi Negocio'
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 31. SALES — quote link (20260505_sales_quote_link)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_quote ON public.sales(quote_id) WHERE quote_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 32. DEMO DATA FUNCTION (20260505_demo_data_function)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.seed_demo_data(p_org_id uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prod1 uuid := gen_random_uuid();
  v_prod2 uuid := gen_random_uuid();
  v_prod3 uuid := gen_random_uuid();
  v_sale1 uuid := gen_random_uuid();
  v_sale2 uuid := gen_random_uuid();
  v_sale3 uuid := gen_random_uuid();
  v_today date := current_date;
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE org_id = p_org_id LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'org already has products');
  END IF;
  INSERT INTO public.products (id, org_id, user_id, name, brand, category, gender, cost_usd, customs_fee, total_cost_usd, sale_price_ars, profit_per_unit_ars, profit_per_unit_usd, stock, featured) VALUES
    (v_prod1, p_org_id, p_user_id, 'BACCARAT ROUGE 540', 'MAISON FRANCIS KURKDJIAN', 'perfume_arabe', 'unisex', 8.50, 1.50, 10.00, 15000, 5000, 3.33, 12, true),
    (v_prod2, p_org_id, p_user_id, 'GOOD GIRL', 'CAROLINA HERRERA', 'perfume_mujer', 'mujer', 6.00, 1.00, 7.00, 10500, 3500, 2.33, 8, false),
    (v_prod3, p_org_id, p_user_id, 'SAUVAGE EDP', 'DIOR', 'perfume_hombre', 'hombre', 7.50, 1.50, 9.00, 13500, 4500, 3.00, 5, false);
  INSERT INTO public.settings (org_id, user_id, business_name, usd_rate_blue, low_stock_threshold)
  VALUES (p_org_id, p_user_id, 'Mi Perfumería', 1200, 3) ON CONFLICT (org_id) DO NOTHING;
  INSERT INTO public.sales (id, org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, cost_per_unit_usd, profit_ars, profit_usd, customer_name, date, paid, payment_method) VALUES
    (v_sale1, p_org_id, p_user_id, v_prod1, 'BACCARAT ROUGE 540', 1, 15000, 15000, 10.00, 5000, 4.17, 'María González', (v_today - 2)::timestamptz, true, 'transferencia'),
    (v_sale2, p_org_id, p_user_id, v_prod2, 'GOOD GIRL', 2, 10500, 21000, 7.00, 7000, 5.83, 'Laura Martínez', (v_today - 1)::timestamptz, true, 'efectivo'),
    (v_sale3, p_org_id, p_user_id, v_prod3, 'SAUVAGE EDP', 1, 13500, 13500, 9.00, 4500, 3.75, 'Carlos Pérez', v_today::timestamptz, false, 'transferencia');
  INSERT INTO public.debts (org_id, user_id, sale_id, customer_name, amount_ars, paid_ars, remaining_ars, status, description)
  VALUES (p_org_id, p_user_id, v_sale3, 'Carlos Pérez', 13500, 0, 13500, 'pending', 'SAUVAGE EDP — pago pendiente');
  INSERT INTO public.customers (org_id, user_id, name, phone, tags, notes)
  VALUES (p_org_id, p_user_id, 'María González', '+54 9 11 1234-5678', ARRAY['VIP','Baccarat'], 'Cliente frecuente, regalo habitual') ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'products', 3, 'sales', 3);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_demo_data(uuid, uuid) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 33. TRIAL EXPIRATION FUNCTION (20260505_trial_expiration_cron)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.expire_overdue_trials()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.subscriptions s
  SET status = 'past_due'
  FROM public.organizations o
  WHERE s.org_id = o.id
    AND s.status = 'trialing'
    AND o.trial_ends_at IS NOT NULL
    AND o.trial_ends_at < now()
    AND s.stripe_subscription_id IS NULL;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 34. PG_CRON JOBS (only if pg_cron extension is enabled)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Trial expiration (hourly)
    PERFORM cron.schedule('expire-overdue-trials', '0 * * * *', $j$ SELECT public.expire_overdue_trials(); $j$);

    -- Customer reactivation alerts (daily 9AM UTC)
    PERFORM cron.schedule('customer-reactivation-alerts', '0 9 * * *', $j$
      SELECT net.http_post(
        url := current_setting('app.supabase_functions_url') || '/customer-reactivation-alerts',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
        body := '{}'::jsonb
      )
    $j$);

    -- Daily KPI alert (9AM UTC)
    PERFORM cron.schedule('daily-kpi-alert', '0 9 * * *', $j$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/daily-kpi-alert',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.supabase_service_key')),
        body := '{}'::jsonb
      )
    $j$);

    -- Automation flows runner (11AM UTC daily)
    PERFORM cron.schedule('run-automation-flows-daily', '0 11 * * *', $j$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/run-automation-flows',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.supabase_anon_key')),
        body := '{}'::jsonb
      )
    $j$);

    -- Weekly performance digest (Mondays 9AM UTC)
    PERFORM cron.schedule('weekly-performance-digest', '0 9 * * 1', $j$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/weekly-performance-digest',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
        body := '{}'::jsonb
      )
    $j$);
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- pg_cron not enabled — skip silently
  NULL;
END $$;

-- == MIGRATION: 20260506000003_mp_webhook_columns.sql ==

-- Add Mercado Pago webhook tracking columns to payment_links
ALTER TABLE public.payment_links ADD COLUMN IF NOT EXISTS mp_payment_id text;
ALTER TABLE public.payment_links ADD COLUMN IF NOT EXISTS external_ref  text;

-- Allow 'rejected' as a valid status for MP-rejected payments
ALTER TABLE public.payment_links DROP CONSTRAINT IF EXISTS payment_links_status_check;
ALTER TABLE public.payment_links ADD CONSTRAINT payment_links_status_check
  CHECK (status IN ('pending','pending_confirmation','paid','cancelled','rejected'));

-- Settings: add MP webhook secret column (optional per-org override)
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS mp_webhook_secret text;

-- == MIGRATION: 20260506000004_rls_fixes.sql ==

-- ============================================================================
-- RLS FIXES — 2026-05-06
-- Fixes overly restrictive / missing row-level-security policies across
-- all tables that are accessed from the frontend.
-- Every statement is idempotent (DROP IF EXISTS + CREATE OR REPLACE / IF NOT EXISTS).
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. influencer_exchanges
--    OLD: owner/admin only  →  NEW: all org members (same pattern as every
--    other org-scoped table). Anyone in the org can create/manage canjes.
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Org admins manage exchanges"  ON public.influencer_exchanges;
DROP POLICY IF EXISTS "Admin manages exchanges"      ON public.influencer_exchanges;
DROP POLICY IF EXISTS "Users manage own exchanges"   ON public.influencer_exchanges;

DROP POLICY IF EXISTS "org_members_manage_exchanges" ON public.influencer_exchanges;
CREATE POLICY "org_members_manage_exchanges" ON public.influencer_exchanges
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. marketing_templates
--    PUBLIC templates can only be read, not updated, by non-owners.
--    likes / uses_count increments fail silently in the UI.
--    Add a permissive UPDATE policy so any authenticated user can update
--    public templates (e.g. increment likes/uses_count).
-- ═══════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "marketing_templates_public_update" ON public.marketing_templates;
DROP POLICY IF EXISTS "marketing_templates_public_update" ON public.marketing_templates;
CREATE POLICY "marketing_templates_public_update" ON public.marketing_templates
  FOR UPDATE TO authenticated
  USING (is_public = true)
  WITH CHECK (is_public = true);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. stripe_events
--    No RLS was enabled. Service-role (edge functions) bypasses RLS anyway,
--    but we should still lock the table so no authenticated user can read or
--    write event IDs directly from the client.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stripe_events_no_client_access" ON public.stripe_events;
DROP POLICY IF EXISTS "stripe_events_no_client_access" ON public.stripe_events;
CREATE POLICY "stripe_events_no_client_access" ON public.stripe_events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false);   -- clients never access this table; service_role bypasses RLS


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. customer_notes
--    Table exists (in types.ts) but may be missing RLS policies.
--    Ensure the table + policies exist so the data-export in SettingsPage
--    and any future writes don't get blocked.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.customer_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  notes         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, customer_name)
);

ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_customer_notes" ON public.customer_notes;
DROP POLICY IF EXISTS "org_members_manage_customer_notes" ON public.customer_notes;
CREATE POLICY "org_members_manage_customer_notes" ON public.customer_notes
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS customer_notes_org_name_idx
  ON public.customer_notes(org_id, customer_name);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. stock_history
--    StockCountPage inserts into this table (best-effort via allSettled).
--    Create it so the inserts succeed instead of being silently swallowed.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stock_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id   uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  change       integer NOT NULL,
  new_stock    integer NOT NULL,
  reason       text,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_stock_history" ON public.stock_history;
DROP POLICY IF EXISTS "org_members_manage_stock_history" ON public.stock_history;
CREATE POLICY "org_members_manage_stock_history" ON public.stock_history
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS stock_history_org_product_idx
  ON public.stock_history(org_id, product_id, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. webhook_deliveries
--    Only has SELECT policy. Service-role inserts bypass RLS, but add an
--    explicit INSERT policy for the edge-function pattern where the client
--    anon/service key is used.
--    (No change needed — service_role bypasses RLS entirely. Document only.)
-- ═══════════════════════════════════════════════════════════════════════════
-- Nothing to do: edge functions use service_role which bypasses RLS.


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. admin_audit_logs
--    Only has SELECT policy for platform_admins. Inserts come from edge
--    functions via service_role (bypasses RLS). No change needed.
-- ═══════════════════════════════════════════════════════════════════════════
-- Nothing to do: edge functions use service_role which bypasses RLS.


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. financial_movements / customer_payments
--    These were added in 20260505_operational_ledgers.sql with correct RLS.
--    Verify they are covered here idempotently.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE IF EXISTS public.financial_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.customer_payments   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_financial_movements" ON public.financial_movements;
DROP POLICY IF EXISTS "org_members_manage_financial_movements" ON public.financial_movements;
CREATE POLICY "org_members_manage_financial_movements" ON public.financial_movements
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "org_members_manage_customer_payments" ON public.customer_payments;
DROP POLICY IF EXISTS "org_members_manage_customer_payments" ON public.customer_payments;
CREATE POLICY "org_members_manage_customer_payments" ON public.customer_payments
  FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

-- == MIGRATION: 20260506000005_stripe_events_idempotency.sql ==

-- Stripe event deduplication table
-- Stores processed event IDs so retries are safely ignored.
CREATE TABLE IF NOT EXISTS public.stripe_events (
  event_id     text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-expire old events after 30 days (pg_cron cleans up)
CREATE INDEX IF NOT EXISTS stripe_events_processed_at ON public.stripe_events(processed_at);

-- Add stripe_customer_id to subscriptions if missing (needed for portal/dunning)
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS trial_end          timestamptz;

-- == MIGRATION: 20260506000006_tiendanube_client_secret.sql ==

-- Add client_secret to tiendanube_connections for webhook HMAC verification
ALTER TABLE public.tiendanube_connections ADD COLUMN IF NOT EXISTS client_secret text;

-- == MIGRATION: 20260506000007_webhook_deliveries_audit.sql ==

-- webhook_deliveries: track all outbound webhook delivery attempts
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  event text NOT NULL,
  webhook_url text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  attempt_count int NOT NULL DEFAULT 1,
  last_response_status int,
  last_response_body text,
  delivered boolean NOT NULL DEFAULT false,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_read_webhook_deliveries" ON webhook_deliveries;
CREATE POLICY "org_members_read_webhook_deliveries"
  ON webhook_deliveries FOR SELECT
  USING (org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid()));

-- admin_audit_logs: track platform admin actions for accountability
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  admin_email text,
  action text NOT NULL,
  target_org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  target_user_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_admins_read_audit_logs" ON admin_audit_logs;
CREATE POLICY "platform_admins_read_audit_logs"
  ON admin_audit_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()));

-- Add webhook_secret to settings for HMAC signing
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS webhook_secret text;

-- == MIGRATION: 20260506000008_fix_trigger_created_at.sql ==

-- Fix triggers that incorrectly referenced m.created_at on memberships.
-- The memberships table uses joined_at, not created_at.

CREATE OR REPLACE FUNCTION public.trg_sale_cash_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id  UUID;
  v_session UUID;
BEGIN
  IF NOT NEW.paid THEN RETURN NEW; END IF;
  IF NEW.payment_method NOT IN ('efectivo','transferencia','debito','credito','mayorista') THEN
    RETURN NEW;
  END IF;
  SELECT m.org_id INTO v_org_id FROM public.memberships m WHERE m.user_id = NEW.user_id ORDER BY m.joined_at LIMIT 1;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_session FROM public.cash_sessions WHERE org_id = v_org_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF v_session IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.cash_entries (org_id, session_id, entry_type, payment_method, amount_ars, reference_type, reference_id, description, created_by)
  VALUES (v_org_id, v_session, 'sale_in', COALESCE(NEW.payment_method,'efectivo'), NEW.total_ars, 'sale', NEW.id, 'Venta ' || COALESCE(NEW.payment_method,'') || ': ' || NEW.product_name, NEW.user_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sale_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id       UUID;
  v_variant_name TEXT;
BEGIN
  SELECT m.org_id INTO v_org_id FROM public.memberships m WHERE m.user_id = NEW.user_id ORDER BY m.joined_at LIMIT 1;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name FROM public.product_variants WHERE id = NEW.variant_id;
  END IF;
  PERFORM public.record_stock_movement(
    p_org_id=>v_org_id, p_product_id=>NEW.product_id, p_variant_id=>NEW.variant_id,
    p_product_name=>NEW.product_name, p_variant_name=>v_variant_name,
    p_movement_type=>'sale', p_quantity=>-NEW.quantity,
    p_reference_type=>'sale', p_reference_id=>NEW.id,
    p_unit_cost_usd=>NEW.cost_per_unit_usd, p_unit_price_ars=>NEW.unit_price_ars,
    p_created_by=>NEW.user_id
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_purchase_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org_id UUID;
BEGIN
  SELECT m.org_id INTO v_org_id FROM public.memberships m WHERE m.user_id = NEW.user_id ORDER BY m.joined_at LIMIT 1;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.record_stock_movement(
    p_org_id=>v_org_id, p_product_id=>NEW.product_id, p_variant_id=>NULL,
    p_product_name=>NEW.product_name, p_variant_name=>NULL,
    p_movement_type=>'purchase', p_quantity=>NEW.quantity,
    p_reference_type=>'purchase', p_reference_id=>NEW.id,
    p_unit_cost_usd=>NEW.unit_cost_usd, p_created_by=>NEW.user_id
  );
  RETURN NEW;
END;
$$;

-- == FIX: docs/fix_production_sql.sql ==

-- ============================================================
-- PASTE IN: Supabase Dashboard > SQL Editor
-- Project: wcfohngxrtopgggumjmw
-- ============================================================

-- FIX 1: column m.created_at does not exist (POST /sales 400)
-- Triggers look for memberships.created_at but the column is joined_at.
-- Add created_at as an alias so all triggers keep working.
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

UPDATE public.memberships
   SET created_at = joined_at
 WHERE created_at = now()
   AND joined_at IS NOT NULL;


-- FIX 2: influencer_exchanges 403 Forbidden
DROP POLICY IF EXISTS "Org admins manage exchanges"  ON public.influencer_exchanges;
DROP POLICY IF EXISTS "Admin manages exchanges"      ON public.influencer_exchanges;
DROP POLICY IF EXISTS "Users manage own exchanges"   ON public.influencer_exchanges;
DROP POLICY IF EXISTS "org_members_manage_exchanges" ON public.influencer_exchanges;

ALTER TABLE public.influencer_exchanges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_exchanges" ON public.influencer_exchanges;
CREATE POLICY "org_members_manage_exchanges"
  ON public.influencer_exchanges
  FOR ALL TO authenticated
  USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  )
  WITH CHECK (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );
