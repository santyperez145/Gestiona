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
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL
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
-- AUDIT TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_contracts_updated ON public.influencer_contracts;
CREATE TRIGGER trg_contracts_updated BEFORE UPDATE ON public.influencer_contracts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_deliverables_updated ON public.influencer_deliverables;
CREATE TRIGGER trg_deliverables_updated BEFORE UPDATE ON public.influencer_deliverables FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_portal_updated ON public.brand_portal_profiles;
CREATE TRIGGER trg_portal_updated BEFORE UPDATE ON public.brand_portal_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================
-- RLS
-- ============================================
ALTER TABLE public.influencer_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_portal_profiles ENABLE ROW LEVEL SECURITY;

-- Contratos: solo miembros de la org pueden ver/editar
CREATE POLICY "Contracts - Read" ON public.influencer_contracts FOR SELECT USING (org_id = public.current_org_id());
CREATE POLICY "Contracts - Insert" ON public.influencer_contracts FOR INSERT WITH CHECK (org_id = public.current_org_id());
CREATE POLICY "Contracts - Update" ON public.influencer_contracts FOR UPDATE USING (org_id = public.current_org_id());
CREATE POLICY "Contracts - Delete" ON public.influencer_contracts FOR DELETE USING (org_id = public.current_org_id());

-- Entregables: solo miembros de la org
CREATE POLICY "Deliverables - Read" ON public.influencer_deliverables FOR SELECT USING (org_id = public.current_org_id());
CREATE POLICY "Deliverables - Insert" ON public.influencer_deliverables FOR INSERT WITH CHECK (org_id = public.current_org_id());
CREATE POLICY "Deliverables - Update" ON public.influencer_deliverables FOR UPDATE USING (org_id = public.current_org_id());
CREATE POLICY "Deliverables - Delete" ON public.influencer_deliverables FOR DELETE USING (org_id = public.current_org_id());

-- Pagos: solo miembros de la org
CREATE POLICY "Payments - Read" ON public.influencer_payments FOR SELECT USING (org_id = public.current_org_id());
CREATE POLICY "Payments - Insert" ON public.influencer_payments FOR INSERT WITH CHECK (org_id = public.current_org_id());
CREATE POLICY "Payments - Update" ON public.influencer_payments FOR UPDATE USING (org_id = public.current_org_id());
CREATE POLICY "Payments - Delete" ON public.influencer_payments FOR DELETE USING (org_id = public.current_org_id());

-- Brand Portal: solo miembros de la org
CREATE POLICY "Portal - Read" ON public.brand_portal_profiles FOR SELECT USING (org_id = public.current_org_id());
CREATE POLICY "Portal - Insert" ON public.brand_portal_profiles FOR INSERT WITH CHECK (org_id = public.current_org_id());
CREATE POLICY "Portal - Update" ON public.brand_portal_profiles FOR UPDATE USING (org_id = public.current_org_id());
CREATE POLICY "Portal - Delete" ON public.brand_portal_profiles FOR DELETE USING (org_id = public.current_org_id());

-- ============================================
-- MIGRAR DATOS EXISTENTES (si los hay)
-- ============================================
-- Migrar exchanges como entregables si corresponde
INSERT INTO public.influencer_deliverables (org_id, influencer_id, influencer_name, campaign_name, description, due_date, status, created_at)
SELECT DISTINCT
  org_id,
  NULL,
  influencer_name,
  'Canje registrado',
  'Producto: ' || product_name,
  created_at::date + interval '7 days',
  CASE WHEN status = 'publicado' THEN 'completado' ELSE 'en_progreso' END,
  created_at
FROM public.influencer_exchanges
WHERE org_id NOT IN (SELECT org_id FROM public.influencer_deliverables)
ON CONFLICT DO NOTHING;

-- Migrar payouts como pagos
INSERT INTO public.influencer_payments (org_id, influencer_id, influencer_name, amount, currency, payment_method, status, period_start, period_end, created_at, completed_at)
SELECT
  org_id,
  influencer_id,
  influencer_name,
  amount_ars,
  'ARS',
  'transfer',
  CASE WHEN status = 'paid' THEN 'completed' ELSE 'pending' END,
  NULL,
  NULL,
  created_at,
  CASE WHEN status = 'paid' THEN paid_at ELSE NULL END
FROM public.influencer_payouts
WHERE org_id NOT IN (SELECT org_id FROM public.influencer_payments)
ON CONFLICT DO NOTHING;