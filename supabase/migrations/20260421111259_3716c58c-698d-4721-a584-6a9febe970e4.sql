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
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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
CREATE POLICY "Members can view their orgs" ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id, auth.uid()) OR public.is_platform_admin(auth.uid()));
DROP POLICY IF EXISTS "Anyone can view org by slug for public catalog" ON public.organizations;
CREATE POLICY "Anyone can view org by slug for public catalog" ON public.organizations FOR SELECT TO anon
  USING (true);
DROP POLICY IF EXISTS "Owners and admins can update org" ON public.organizations;
CREATE POLICY "Owners and admins can update org" ON public.organizations FOR UPDATE TO authenticated
  USING (public.has_org_role(id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Authenticated can create org" ON public.organizations;
CREATE POLICY "Authenticated can create org" ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_user_id);
DROP POLICY IF EXISTS "Only owner can delete org" ON public.organizations;
CREATE POLICY "Only owner can delete org" ON public.organizations FOR DELETE TO authenticated
  USING (auth.uid() = owner_user_id);

-- memberships
DROP POLICY IF EXISTS "Users see memberships of their orgs" ON public.memberships;
CREATE POLICY "Users see memberships of their orgs" ON public.memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "Owners and admins manage memberships" ON public.memberships;
CREATE POLICY "Owners and admins manage memberships" ON public.memberships FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
DROP POLICY IF EXISTS "Self insert as owner on org create" ON public.memberships;
CREATE POLICY "Self insert as owner on org create" ON public.memberships FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND role = 'owner' AND EXISTS(SELECT 1 FROM public.organizations o WHERE o.id = org_id AND o.owner_user_id = auth.uid()));

-- org_invitations
DROP POLICY IF EXISTS "Owners admins manage invitations" ON public.org_invitations;
CREATE POLICY "Owners admins manage invitations" ON public.org_invitations FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- plans (públicos en lectura)
DROP POLICY IF EXISTS "Plans are public" ON public.plans;
CREATE POLICY "Plans are public" ON public.plans FOR SELECT USING (true);

-- subscriptions
DROP POLICY IF EXISTS "Members view subscription" ON public.subscriptions;
CREATE POLICY "Members view subscription" ON public.subscriptions FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "Owners manage subscription" ON public.subscriptions;
CREATE POLICY "Owners manage subscription" ON public.subscriptions FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner']));

-- platform_admins
DROP POLICY IF EXISTS "Platform admins view all" ON public.platform_admins;
CREATE POLICY "Platform admins view all" ON public.platform_admins FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR user_id = auth.uid());

-- ============================================================================
-- 8. REESCRITURA DE RLS EN TABLAS EXISTENTES (ahora basado en org_id)
-- ============================================================================

-- products
DROP POLICY IF EXISTS "Admin manages products" ON public.products;
DROP POLICY IF EXISTS "Authenticated read products" ON public.products;
CREATE POLICY "Org members read products" ON public.products FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY "Org admins manage products" ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']) AND user_id = auth.uid());
CREATE POLICY "Org admins update products" ON public.products FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
CREATE POLICY "Org admins delete products" ON public.products FOR DELETE TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- sales
DROP POLICY IF EXISTS "Admin manages all sales" ON public.sales;
DROP POLICY IF EXISTS "Vendedor can insert own sales" ON public.sales;
DROP POLICY IF EXISTS "Vendedor can select own sales" ON public.sales;
CREATE POLICY "Org members read sales" ON public.sales FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY "Org members create sales" ON public.sales FOR INSERT TO authenticated
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin','vendedor']) AND user_id = auth.uid());
CREATE POLICY "Org admins update sales" ON public.sales FOR UPDATE TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
CREATE POLICY "Org admins delete sales" ON public.sales FOR DELETE TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- purchases
DROP POLICY IF EXISTS "Admin manages purchases" ON public.purchases;
CREATE POLICY "Org admins manage purchases" ON public.purchases FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
CREATE POLICY "Org members read purchases" ON public.purchases FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

-- debts
DROP POLICY IF EXISTS "Admin manages all debts" ON public.debts;
DROP POLICY IF EXISTS "Vendedor can select own debts" ON public.debts;
CREATE POLICY "Org members read debts" ON public.debts FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY "Org admins manage debts" ON public.debts FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- expenses
DROP POLICY IF EXISTS "Admin manages expenses" ON public.expenses;
CREATE POLICY "Org admins manage expenses" ON public.expenses FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- settings
DROP POLICY IF EXISTS "Admin manages settings" ON public.settings;
DROP POLICY IF EXISTS "Authenticated read settings" ON public.settings;
DROP POLICY IF EXISTS "Public read settings for catalog" ON public.settings;
CREATE POLICY "Org members read settings" ON public.settings FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY "Public read settings for catalog" ON public.settings FOR SELECT TO anon USING (true);
CREATE POLICY "Org admins manage settings" ON public.settings FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- customer_notes
DROP POLICY IF EXISTS "Admin manages customer notes" ON public.customer_notes;
CREATE POLICY "Org members manage customer notes" ON public.customer_notes FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin','vendedor']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin','vendedor']));

-- marketing_posts
DROP POLICY IF EXISTS "Admin manages marketing" ON public.marketing_posts;
CREATE POLICY "Org admins manage marketing" ON public.marketing_posts FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- influencer_exchanges
DROP POLICY IF EXISTS "Admin manages exchanges" ON public.influencer_exchanges;
CREATE POLICY "Org admins manage exchanges" ON public.influencer_exchanges FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- coupons
DROP POLICY IF EXISTS "Authenticated can read own coupons" ON public.coupons;
DROP POLICY IF EXISTS "Admin manages coupons" ON public.coupons;
DROP POLICY IF EXISTS "Anon can read active coupons" ON public.coupons;
CREATE POLICY "Org members read coupons" ON public.coupons FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY "Anon read active coupons" ON public.coupons FOR SELECT TO anon USING (active = true);
CREATE POLICY "Org admins manage coupons" ON public.coupons FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- product_variants
DROP POLICY IF EXISTS "Admin manages variants" ON public.product_variants;
DROP POLICY IF EXISTS "Authenticated read own variants" ON public.product_variants;
DROP POLICY IF EXISTS "Public read active variants" ON public.product_variants;
CREATE POLICY "Org members read variants" ON public.product_variants FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY "Public read active variants" ON public.product_variants FOR SELECT TO anon USING (active = true);
CREATE POLICY "Org admins manage variants" ON public.product_variants FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- seller_goals
DROP POLICY IF EXISTS "Admin manages all seller goals" ON public.seller_goals;
DROP POLICY IF EXISTS "Sellers can view own goals" ON public.seller_goals;
CREATE POLICY "Sellers view own goals" ON public.seller_goals FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
CREATE POLICY "Org admins manage seller goals" ON public.seller_goals FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- audit_logs
DROP POLICY IF EXISTS "Users can view own audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Users can insert own audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can view all audit logs" ON public.audit_logs;
CREATE POLICY "Org members view audit logs" ON public.audit_logs FOR SELECT TO authenticated
  USING (org_id IS NULL AND auth.uid() = user_id OR (org_id IS NOT NULL AND public.is_org_member(org_id, auth.uid())));
CREATE POLICY "Users insert own audit logs" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- notifications
DROP POLICY IF EXISTS "Users manage own notifications" ON public.notifications;
CREATE POLICY "Org members manage notifications" ON public.notifications FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (auth.uid() = user_id);

-- profiles: agregar visibilidad a co-miembros de la org
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
CREATE TRIGGER on_auth_user_created_create_org
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_create_org();