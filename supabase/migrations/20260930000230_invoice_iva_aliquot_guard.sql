-- La integracion WSFE no debe emitir un importe con un Id de alicuota
-- distinto. A/B incluyen tambien la alicuota 0%; C no discrimina IVA.
CREATE OR REPLACE FUNCTION public.validar_alicuota_factura()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.tipo_comprobante IS NOT NULL
     AND COALESCE(NEW.tax_pct, -1) NOT IN (0, 2.5, 5, 10.5, 21, 27) THEN
    RAISE EXCEPTION 'La alicuota de IVA no esta admitida por ARCA';
  END IF;
  IF NEW.tipo_comprobante IN (11, 12, 13)
     AND (COALESCE(NEW.tax_pct, 0) <> 0 OR COALESCE(NEW.tax_amount, 0) <> 0) THEN
    RAISE EXCEPTION 'Los comprobantes C no discriminan IVA';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_validar_alicuota_factura ON public.invoices;
CREATE TRIGGER trg_validar_alicuota_factura
BEFORE INSERT OR UPDATE OF tipo_comprobante, tax_pct, tax_amount
ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.validar_alicuota_factura();

REVOKE ALL ON FUNCTION public.validar_alicuota_factura() FROM PUBLIC, anon, authenticated;
