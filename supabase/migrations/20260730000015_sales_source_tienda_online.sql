-- `sales.source` no contemplaba la tienda online propia: el CHECK solo
-- aceptaba manual / pos / tiendanube / api / presupuesto. Al confirmar un pago
-- de la tienda, el INSERT de la venta violaba la restricción y el cobro fallaba
-- entero.
--
-- La tienda propia es un canal de venta más y merece su propio valor, para
-- poder reportar cuánto vende cada canal. Idempotente.

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_source_check;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_source_check
  CHECK (source = ANY (ARRAY[
    'manual'::text,
    'pos'::text,
    'tiendanube'::text,
    'tienda_online'::text,   -- vitrina propia en /tienda/:slug
    'mercadolibre'::text,    -- órdenes bajadas de ML
    'api'::text,
    'presupuesto'::text
  ]));
