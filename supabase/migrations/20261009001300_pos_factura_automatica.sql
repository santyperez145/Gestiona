-- Facturación automática en el POS.
--
-- El ticket pide factura ARCA con un interruptor que arrancaba siempre apagado
-- y quedaba como lo dejó el último cajero. El comercio que factura todo lo
-- define una vez: cada ticket nuevo arranca pidiendo factura. El cajero puede
-- apagarlo para un ticket puntual; la emisión sigue en facturar_venta_pos.

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS pos_factura_automatica boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.settings.pos_factura_automatica IS
  'Cada ticket nuevo del POS arranca pidiendo factura ARCA. Lo cambian dueño/admin (RLS de settings).';
