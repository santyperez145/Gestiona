-- Cuentas corrientes: una deuda con cobros o atada a una venta no se borra.
--
-- Medido el 2026-10-14: «Eliminar» en Cuentas corrientes borraba la deuda y,
-- en cascada, sus cobros (debt_payments, customer_payments): el dinero ya
-- había entrado a la caja y el comprobante del cobro desaparecía. Si la deuda
-- venía de una venta fiada, la venta quedaba impaga y sin deuda.
--
-- Ahora se rechaza con el camino correcto: una deuda de una venta se anula
-- con una devolución; una con cobros, no se borra (se puede condonar el
-- saldo). Una deuda cargada a mano sin cobros se sigue pudiendo borrar.
-- Borrar el negocio entero no se frena.
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_borrado_de_deuda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(current_setting('gestiona.organization_deleting', true), '') = 'on' THEN RETURN OLD; END IF;
  IF OLD.sale_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = OLD.sale_id) THEN
    RAISE EXCEPTION 'Esta deuda es de una venta fiada: anulá la venta con una devolución y la deuda se ajusta sola' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.debt_payments p WHERE p.debt_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.customer_payments p WHERE p.debt_id = OLD.id) THEN
    RAISE EXCEPTION 'Esta deuda ya tiene cobros registrados: no se borra, para no perder el registro de lo cobrado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_borrado_de_deuda() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_borrado_de_deuda ON public.debts;
CREATE TRIGGER trg_guard_borrado_de_deuda
BEFORE DELETE ON public.debts
FOR EACH ROW EXECUTE FUNCTION public.guard_borrado_de_deuda();

COMMIT;
