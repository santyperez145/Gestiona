
-- ============= INFLUENCERS =============
CREATE TABLE public.influencers (
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
CREATE POLICY "Org admins manage influencers" ON public.influencers FOR ALL TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
CREATE POLICY "Org members read influencers" ON public.influencers FOR SELECT TO authenticated
  USING (is_org_member(org_id, auth.uid()));
CREATE POLICY "Public read active influencers" ON public.influencers FOR SELECT TO anon
  USING (status = 'activo');
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
CREATE TRIGGER trg_influencer_tier BEFORE INSERT OR UPDATE OF followers_ig ON public.influencers
  FOR EACH ROW EXECUTE FUNCTION public.calculate_influencer_tier();

-- ============= INFLUENCER SALES =============
CREATE TABLE public.influencer_sales (
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
CREATE POLICY "Org admins manage influencer_sales" ON public.influencer_sales FOR ALL TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
CREATE POLICY "Org members read influencer_sales" ON public.influencer_sales FOR SELECT TO authenticated
  USING (is_org_member(org_id, auth.uid()));

-- ============= PAYOUTS =============
CREATE TABLE public.influencer_payouts (
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
CREATE POLICY "Org admins manage payouts" ON public.influencer_payouts FOR ALL TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
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
CREATE TRIGGER trg_process_referral_sale AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.process_referral_sale();

-- ============= PRODUCT COMBOS =============
CREATE TABLE public.product_combos (
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
CREATE POLICY "Org admins manage combos" ON public.product_combos FOR ALL TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
CREATE POLICY "Org members read combos" ON public.product_combos FOR SELECT TO authenticated
  USING (is_org_member(org_id, auth.uid()));
CREATE POLICY "Public read active combos" ON public.product_combos FOR SELECT TO anon USING (active = true);
CREATE TRIGGER trg_combos_updated BEFORE UPDATE ON public.product_combos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= STORY TEMPLATES =============
CREATE TABLE public.story_templates (
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
CREATE POLICY "Org admins manage templates" ON public.story_templates FOR ALL TO authenticated
  USING (org_id IS NULL OR has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (org_id IS NOT NULL AND has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
CREATE POLICY "Read templates" ON public.story_templates FOR SELECT TO authenticated, anon
  USING (active = true);

-- ============= INDUSTRY PRESETS =============
CREATE TABLE public.industry_presets (
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
CREATE POLICY "Read industries" ON public.industry_presets FOR SELECT TO authenticated, anon USING (active = true);

-- ============= BRAND KNOWLEDGE =============
CREATE TABLE public.brand_knowledge (
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
CREATE POLICY "Org admins manage brand knowledge" ON public.brand_knowledge FOR ALL TO authenticated
  USING (org_id IS NULL OR has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (org_id IS NOT NULL AND has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
CREATE POLICY "Read brand knowledge" ON public.brand_knowledge FOR SELECT TO authenticated USING (active = true);

-- ============= CATALOG BANNERS =============
CREATE TABLE public.catalog_banners (
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
CREATE POLICY "Org admins manage banners" ON public.catalog_banners FOR ALL TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
CREATE POLICY "Public read active banners" ON public.catalog_banners FOR SELECT TO anon, authenticated
  USING (active = true AND (expires_at IS NULL OR expires_at > now()));
CREATE TRIGGER trg_banners_updated BEFORE UPDATE ON public.catalog_banners
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= AI OFFER RECOMMENDATIONS =============
CREATE TABLE public.ai_offer_recommendations (
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
CREATE POLICY "Org admins manage AI recs" ON public.ai_offer_recommendations FOR ALL TO authenticated
  USING (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
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
