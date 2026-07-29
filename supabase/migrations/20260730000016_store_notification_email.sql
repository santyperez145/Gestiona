-- Email al que llegan los avisos de venta de la tienda online.
--
-- Sin esto los avisos van al email con el que el dueño inicia sesión, que
-- suele ser personal. Un comercio normalmente quiere que los pedidos lleguen
-- a una casilla de ventas, y que la vean varias personas.
-- Idempotente.

ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS notification_email text;

COMMENT ON COLUMN public.ecommerce_stores.notification_email IS
  'Destino de los avisos de pedido nuevo. Si está vacío se usa el email del dueño de la organización.';
