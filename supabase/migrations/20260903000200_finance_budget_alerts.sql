-- Finance Budget Alerts
-- Created: 2026-09-03
-- Purpose: Create finance_budget_alerts table for budget pulse alerts

DROP TABLE IF EXISTS public.finance_budget_alerts CASCADE;

CREATE TABLE public.finance_budget_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  year INT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  category_key TEXT NOT NULL,
  budget NUMERIC(14,2) NOT NULL DEFAULT 0,
  spent NUMERIC(14,2) NOT NULL DEFAULT 0,
  pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 80,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, year, month, category_key)
);

CREATE INDEX idx_finance_budget_alerts_org ON public.finance_budget_alerts(org_id, year, month);

ALTER TABLE public.finance_budget_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance_budget_alerts_org" ON public.finance_budget_alerts;
CREATE POLICY "finance_budget_alerts_org"
  ON public.finance_budget_alerts
  FOR ALL USING (public.is_org_member(org_id, auth.uid()))
  WITH CHECK (public.is_org_member(org_id, auth.uid()));