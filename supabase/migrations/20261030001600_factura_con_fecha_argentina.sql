-- Las facturas llevan la fecha del día argentino (2026-10-30).
--
-- La base corre en UTC. Crear factura, nota de débito y las demás altas de
-- comprobantes usan CURRENT_DATE: entre las 21 y las 24 h de Argentina eso es
-- el día siguiente, y esa fecha es la que va a ARCA (CbteFch). Una factura del
-- 31/10 a las 22 h salía fechada el 1/11: otro período de IVA, para el
-- comercio y para el cliente que la computa. El cierre Z del día tampoco la
-- encontraba. Lo destapó la matriz de cierres Z (20261023000700) cuando el
-- simulacro corrió a las 23:23 de Argentina (02:23 UTC).
--
--   · `hoy_ar()`: el día de hoy en Argentina, para comparar contra fechas
--     de negocio.
--   · Antes de insertar una factura: si la fecha de emisión o el vencimiento
--     es «hoy» según la sesión y la sesión no está en hora argentina, pasa a
--     ser hoy en Argentina. Una fecha elegida a propósito (distinta de hoy)
--     no se toca. Vale para todas las altas, también las que se agreguen.
--   · Lo ya emitido no se toca: lo autorizado por ARCA es inmutable.
--
-- Queda en UTC el resto de los «hoy» por defecto (gastos, vencimientos que
-- calculan las funciones): se revisan aparte, sin cambiar la zona de la base
-- de un saque.

BEGIN;

CREATE OR REPLACE FUNCTION public.hoy_ar()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
$fn$;
COMMENT ON FUNCTION public.hoy_ar() IS
  'El día de hoy en Argentina. La base corre en UTC: CURRENT_DATE es el día siguiente entre las 21 y las 24 h.';
GRANT EXECUTE ON FUNCTION public.hoy_ar() TO anon, authenticated, service_role;

-- El nombre ordena antes que los demás disparadores previos de invoices
-- (trg_exportacion_protegida, trg_guard_…, trg_invoice_…): ellos ya ven la
-- fecha corregida.
CREATE OR REPLACE FUNCTION public.trg_dia_argentino_de_factura()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_hoy date := public.hoy_ar();
BEGIN
  IF CURRENT_DATE <> v_hoy THEN
    IF NEW.issue_date = CURRENT_DATE THEN
      NEW.issue_date := v_hoy;
    END IF;
    IF NEW.due_date = CURRENT_DATE THEN
      NEW.due_date := v_hoy;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.trg_dia_argentino_de_factura() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_dia_argentino_de_factura ON public.invoices;
CREATE TRIGGER trg_dia_argentino_de_factura
  BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_dia_argentino_de_factura();

COMMIT;
