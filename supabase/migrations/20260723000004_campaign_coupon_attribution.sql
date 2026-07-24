-- ============================================================================
-- Bloque "cerrar loops" — Atribución de campañas por cupón
-- Permite asociar un cupón a una campaña de email/WhatsApp. Como las ventas ya
-- guardan coupon_code (migración 20260723000001), esto habilita medir las
-- ventas/ingresos generados por cada campaña reutilizando la misma atribución.
-- Additivo, columna nullable.
-- ============================================================================

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS coupon_code text;

ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS coupon_code text;
