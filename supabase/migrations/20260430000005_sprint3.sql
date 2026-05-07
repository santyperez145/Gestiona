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
