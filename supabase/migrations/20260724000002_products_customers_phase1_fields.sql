-- ============================================================================
-- Campos aditivos baratos — aplican a TODAS las categorías
-- ============================================================================
-- products: estado activo/inactivo + fecha de próximo ingreso (para el
-- widget "Próximos Ingresos" del Dashboard). margin_pct NO se agrega: se
-- sigue calculando en cliente (ProductsPage ya lo hace) para evitar drift.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS expected_restock_at DATE;

CREATE INDEX IF NOT EXISTS idx_products_restock
  ON public.products(org_id, expected_restock_at)
  WHERE expected_restock_at IS NOT NULL;

-- customers: campos CRM verticales. whatsapp_number es nullable — si se deja
-- vacío el front usa phone; no se migran datos existentes.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS instagram_handle TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT,
  ADD COLUMN IF NOT EXISTS buys_vapers BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scent_preferences TEXT[] NOT NULL DEFAULT '{}';
