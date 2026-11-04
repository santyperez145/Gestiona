-- Sin descuentos que nadie eligió (2026-11-04).
--
-- Desde 20260407211631 cada negocio nuevo nacía con 10 % de descuento por
-- efectivo y 5 % por transferencia en la caja (DEFAULT de la columna). El E2E
-- del primer día lo mostró: el comercio cargó su producto a $12.500 y la caja
-- se lo cobraba $11.250 en su primera venta, sin haberlo decidido. Un descuento
-- es una decisión comercial del dueño, no un valor de fábrica.
--
-- Sólo cambia el valor por defecto para los negocios que nazcan desde ahora.
-- Los existentes conservan lo que tienen: alguno pudo haberlo elegido, y los
-- datos reales no se reescriben.

ALTER TABLE public.settings ALTER COLUMN discount_cash_percent SET DEFAULT 0;
ALTER TABLE public.settings ALTER COLUMN discount_transfer_percent SET DEFAULT 0;
ALTER TABLE public.settings ALTER COLUMN discount_debit_percent SET DEFAULT 0;
ALTER TABLE public.settings ALTER COLUMN discount_credit_percent SET DEFAULT 0;

DO $verify$
DECLARE
  v_col record;
BEGIN
  FOR v_col IN
    SELECT column_name, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'settings'
       AND column_name IN ('discount_cash_percent', 'discount_transfer_percent', 'discount_debit_percent', 'discount_credit_percent')
  LOOP
    -- Según la versión, Postgres lo muestra como 0 o como 0::numeric.
    IF split_part(v_col.column_default, '::', 1) IS DISTINCT FROM '0' THEN
      RAISE EXCEPTION 'settings.% sigue naciendo con %', v_col.column_name, v_col.column_default;
    END IF;
  END LOOP;
END
$verify$;
