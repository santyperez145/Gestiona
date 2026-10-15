-- Ventas: lo cobrado, facturado o fiado no se reescribe; se corrige con una
-- devolución.
--
-- Medido el 2026-10-14: «Editar» en Ventas podía cambiar producto, cantidad,
-- precio, total, medio de pago, sucursal o pasar a «no cobrada» cualquier
-- venta. El stock acompañaba, pero en una venta cobrada por la caja el
-- arqueo dejaba de cuadrar, en una facturada el comprobante con CAE decía
-- otra cosa y en una fiada la deuda quedaba por otro importe.
--
-- Ahora, si la venta tiene cobro registrado, factura autorizada, devoluciones,
-- deuda o viene de la tienda, esos campos no cambian (el mensaje remite a
-- Devoluciones). Cliente, notas y fecha se siguen corrigiendo, y los flujos
-- del sistema (cobros que la marcan cobrada, devoluciones, facturación) no se
-- ven afectados porque no tocan esos campos o sólo marcan «cobrada».
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_reescritura_de_venta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_motivo text;
BEGIN
  IF NEW.product_id IS NOT DISTINCT FROM OLD.product_id
     AND NEW.variant_id IS NOT DISTINCT FROM OLD.variant_id
     AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity
     AND NEW.unit_price_ars IS NOT DISTINCT FROM OLD.unit_price_ars
     AND NEW.total_ars IS NOT DISTINCT FROM OLD.total_ars
     AND NEW.payment_method IS NOT DISTINCT FROM OLD.payment_method
     AND NEW.location_id IS NOT DISTINCT FROM OLD.location_id
     AND NOT (OLD.paid IS TRUE AND NEW.paid IS NOT TRUE) THEN
    RETURN NEW;
  END IF;

  v_motivo := CASE
    WHEN OLD.ecommerce_order_id IS NOT NULL THEN 'es de la tienda online'
    WHEN EXISTS (SELECT 1 FROM public.invoices i WHERE (i.id = OLD.invoice_id OR i.sale_id = OLD.id) AND i.cae IS NOT NULL) THEN 'tiene factura autorizada por ARCA'
    WHEN EXISTS (SELECT 1 FROM public.returns r WHERE r.sale_id = OLD.id) THEN 'tiene devoluciones'
    WHEN EXISTS (SELECT 1 FROM public.debts d WHERE d.sale_id = OLD.id) THEN 'está en la cuenta corriente del cliente'
    WHEN OLD.sale_transaction_id IS NOT NULL AND (
           EXISTS (SELECT 1 FROM public.cash_entries c WHERE c.sale_transaction_id = OLD.sale_transaction_id)
           OR EXISTS (SELECT 1 FROM public.payment_transactions p WHERE p.source = 'pos' AND p.source_id = OLD.sale_transaction_id
                        AND p.status NOT IN ('failed', 'cancelled'))) THEN 'se cobró por la caja'
    ELSE NULL END;
  IF v_motivo IS NOT NULL THEN
    RAISE EXCEPTION 'Esta venta %: el producto, la cantidad, el importe y el cobro no se cambian; corregila con una devolución', v_motivo
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_reescritura_de_venta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_reescritura_de_venta ON public.sales;
CREATE TRIGGER trg_guard_reescritura_de_venta
BEFORE UPDATE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.guard_reescritura_de_venta();

COMMIT;
