ALTER TABLE public.tiendanube_integrations
  ADD COLUMN IF NOT EXISTS platform_fee_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_fee_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS round_to integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.tiendanube_integrations.platform_fee_percent IS 'Comisión % que cobra Tiendanube por venta (plan Inicial 9%, Avanzado 4.5%, etc.)';
COMMENT ON COLUMN public.tiendanube_integrations.payment_fee_percent IS 'Comisión % de la pasarela de pago (Mercado Pago ~6%)';
COMMENT ON COLUMN public.tiendanube_integrations.round_to IS 'Redondear precio final a múltiplo (0 = sin redondeo, 100 = a centenas, 1000 = a miles)';