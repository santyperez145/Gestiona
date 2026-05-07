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

CREATE POLICY "cash_sessions_org" ON public.cash_sessions
  FOR ALL USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_cash_sessions_org ON public.cash_sessions(org_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON public.cash_sessions(org_id, status);
