-- ============================================================================
-- Precios por categoría — markup y descuento por defecto distintos por categoría
-- ============================================================================
-- Estructura del jsonb:
--   { "perfume_arabe": {"markup": 2.0, "discount": 20},
--     "vaper": {"markup": 1.6, "discount": 15}, ... }
-- El form de productos usa el markup/discount de la categoría al autocalcular
-- precios (en vez del ×2 fijo global).

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS category_pricing jsonb NOT NULL DEFAULT '{}'::jsonb;
