BEGIN;
-- Recovery for the undeployed 20260917 migration. Do not infer deliverables or
-- duplicate historical payouts: those are not evidence of a contract/payment.
-- Migración: Contratos, Entregables, Pagos y Brand Portal para Influencer Marketing
-- Fecha: 2026-09-17
-- Descripción: Tablas completas para contratos con influencers, tracking de entregables, liquidaciones y portal de marca

-- ============================================
-- CONTRATOS CON INFLUENCERS
-- ============================================
CREATE TABLE IF NOT EXISTS public.influencer_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  influencer_id UUID REFERENCES public.influencers(id) ON DELETE SET NULL,
  influencer_name TEXT NOT NULL,
  contract_type TEXT NOT NULL DEFAULT 'fixed' CHECK (contract_type IN ('fixed', 'percentage', 'hybrid')),
  contract_amount NUMERIC(12, 2) DEFAULT 0,
  commission_percent NUMERIC(5, 2) DEFAULT 0,
  commission_fixed NUMERIC(12, 2) DEFAULT 0,
  is_signed BOOLEAN DEFAULT FALSE,
  valid_from DATE NOT NULL,
  valid_until DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'expired', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_org ON public.influencer_contracts(org_id);
CREATE INDEX IF NOT EXISTS idx_contracts_influencer ON public.influencer_contracts(influencer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON public.influencer_contracts(status);

-- ============================================
-- ENTREGABLES CON FECHAS
-- ============================================
CREATE TABLE IF NOT EXISTS public.influencer_deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  influencer_id UUID REFERENCES public.influencers(id) ON DELETE SET NULL,
  influencer_name TEXT NOT NULL,
  campaign_name TEXT,
  description TEXT NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'en_progreso', 'completado', 'entregado')),
  delivery_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deliverables_org ON public.influencer_deliverables(org_id);
CREATE INDEX IF NOT EXISTS idx_deliverables_influencer ON public.influencer_deliverables(influencer_id);
CREATE INDEX IF NOT EXISTS idx_deliverables_status ON public.influencer_deliverables(status);
CREATE INDEX IF NOT EXISTS idx_deliverables_due ON public.influencer_deliverables(due_date);

-- ============================================
-- PAGOS Y LIQUIDACIONES
-- ============================================
CREATE TABLE IF NOT EXISTS public.influencer_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  influencer_id UUID REFERENCES public.influencers(id) ON DELETE SET NULL,
  influencer_name TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ARS',
  payment_method TEXT NOT NULL DEFAULT 'transfer' CHECK (payment_method IN ('transfer', 'mp_money', 'cash', 'check', 'other')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
  period_start DATE,
  period_end DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_org ON public.influencer_payments(org_id);
CREATE INDEX IF NOT EXISTS idx_payments_influencer ON public.influencer_payments(influencer_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.influencer_payments(status);

-- ============================================
-- PORTAL DE MARCA - Perfiles de Influencers
-- ============================================
CREATE TABLE IF NOT EXISTS public.brand_portal_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  influencer_id UUID REFERENCES public.influencers(id) ON DELETE SET NULL,
  influencer_name TEXT NOT NULL,
  portal_name TEXT,
  description TEXT,
  website_url TEXT,
  instagram_handle TEXT,
  tiktok_handle TEXT,
  youtube_handle TEXT,
  followers_ig BIGINT DEFAULT 0,
  followers_tiktok BIGINT DEFAULT 0,
  engagement_rate NUMERIC(5, 2) DEFAULT 0,
  tier TEXT CHECK (tier IN ('nano', 'micro', 'medio', 'macro')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  category TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_org ON public.brand_portal_profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_portal_influencer ON public.brand_portal_profiles(influencer_id);
CREATE INDEX IF NOT EXISTS idx_portal_status ON public.brand_portal_profiles(status);

-- ============================================

CREATE OR REPLACE FUNCTION public.validate_influencer_relation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.influencer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.influencers WHERE id = NEW.influencer_id AND org_id = NEW.org_id
  ) THEN RAISE EXCEPTION 'invalid_influencer_organization' USING ERRCODE = '23503'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_influencer_relation() FROM PUBLIC, anon, authenticated;

DO $policies$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['influencer_contracts', 'influencer_deliverables', 'influencer_payments', 'brand_portal_profiles'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', v_table);
    EXECUTE format('CREATE POLICY influencer_read ON public.%I FOR SELECT TO authenticated USING (public.can_manage_influencers(org_id))', v_table);
    EXECUTE format('CREATE POLICY influencer_create ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_manage_influencers(org_id, ''create''))', v_table);
    EXECUTE format('CREATE POLICY influencer_edit ON public.%I FOR UPDATE TO authenticated USING (public.can_manage_influencers(org_id, ''edit'')) WITH CHECK (public.can_manage_influencers(org_id, ''edit''))', v_table);
    EXECUTE format('CREATE POLICY influencer_delete ON public.%I FOR DELETE TO authenticated USING (public.can_manage_influencers(org_id, ''delete''))', v_table);
    EXECUTE format('CREATE TRIGGER validate_influencer_relation BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.validate_influencer_relation()', v_table);
  END LOOP;
  -- Restrictive policies also constrain older permissive policies on installations
  -- that already applied the original migration.
  FOREACH v_table IN ARRAY ARRAY['influencers', 'influencer_contracts', 'influencer_deliverables', 'influencer_payments', 'brand_portal_profiles'] LOOP
    EXECUTE format('CREATE POLICY influencer_view_boundary ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.can_manage_influencers(org_id))', v_table);
    EXECUTE format('CREATE POLICY influencer_create_boundary ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.can_manage_influencers(org_id, ''create''))', v_table);
    EXECUTE format('CREATE POLICY influencer_edit_boundary ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.can_manage_influencers(org_id, ''edit'')) WITH CHECK (public.can_manage_influencers(org_id, ''edit''))', v_table);
    EXECUTE format('CREATE POLICY influencer_delete_boundary ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.can_manage_influencers(org_id, ''delete''))', v_table);
  END LOOP;
END;
$policies$;
COMMIT;
