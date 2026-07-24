-- ============================================================================
-- Bloque 2 — Multi-tienda + atribución de marketing en transacciones
-- Additivo: agrega columnas nullable, no rompe datos ni código existente.
-- ============================================================================

-- ── Multi-tienda: qué sucursal originó cada venta / gasto ──────────────────
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;

-- ── Atribución de marketing: de dónde vino la venta ────────────────────────
-- coupon_code: el cupón (o código de influencer) usado en la venta.
-- attribution_source: 'coupon' | 'influencer' | 'campaign' | 'referral' | NULL
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS attribution_source text;

-- ── Índices para los filtros por sucursal y los reportes de atribución ─────
CREATE INDEX IF NOT EXISTS sales_location_idx ON public.sales (org_id, location_id);
CREATE INDEX IF NOT EXISTS sales_coupon_idx ON public.sales (org_id, coupon_code);
CREATE INDEX IF NOT EXISTS expenses_location_idx ON public.expenses (org_id, location_id);
