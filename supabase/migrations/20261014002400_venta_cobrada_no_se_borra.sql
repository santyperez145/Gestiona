-- Ventas: lo cobrado, facturado o fiado no se borra; se anula con devolución.
--
-- Medido el 2026-10-14: un administrador podía borrar cualquier venta desde
-- Ventas. La base sólo revertía el stock: el efectivo de la caja y el cobro
-- de Mercado Pago quedaban sin venta, la factura con CAE quedaba huérfana
-- (invoices.sale_id SET NULL) y la deuda de cuenta corriente seguía cobrándole
-- al cliente una venta que ya no existía (debts.sale_id SET NULL).
--
-- Ahora se rechaza borrar una venta que tenga cobro registrado (caja o pago),
-- factura autorizada, devoluciones, saldo en cuenta corriente o que venga de
-- la tienda online, con el camino correcto en el mensaje. Una venta cargada a
-- mano sin nada de eso (un error de carga) se sigue pudiendo borrar. Borrar el
-- negocio entero no se frena.
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_borrado_de_venta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(current_setting('gestiona.organization_deleting', true), '') = 'on' THEN RETURN OLD; END IF;
  IF OLD.ecommerce_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta venta es de la tienda online: se anula desde el pedido' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoices i WHERE (i.id = OLD.invoice_id OR i.sale_id = OLD.id) AND i.cae IS NOT NULL) THEN
    RAISE EXCEPTION 'Esta venta tiene factura autorizada por ARCA: se anula con una devolución, que emite la nota de crédito' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.returns r WHERE r.sale_id = OLD.id) THEN
    RAISE EXCEPTION 'Esta venta tiene devoluciones registradas: no se puede borrar' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.debts d WHERE d.sale_id = OLD.id) THEN
    RAISE EXCEPTION 'Esta venta está en la cuenta corriente del cliente: anulala con una devolución para que también se ajuste lo que debe' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.sale_transaction_id IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.cash_entries c WHERE c.sale_transaction_id = OLD.sale_transaction_id)
       OR EXISTS (SELECT 1 FROM public.payment_transactions p WHERE p.source = 'pos' AND p.source_id = OLD.sale_transaction_id
                    AND p.status NOT IN ('failed', 'cancelled'))) THEN
    RAISE EXCEPTION 'Esta venta se cobró por la caja: anulala con una devolución, que devuelve el dinero y el stock' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_borrado_de_venta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_borrado_de_venta ON public.sales;
CREATE TRIGGER trg_guard_borrado_de_venta
BEFORE DELETE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.guard_borrado_de_venta();

COMMIT;
