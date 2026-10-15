-- Ventas: una venta fiada se marca cobrada al saldar su deuda, no a mano.
--
-- Medido el 2026-10-14: «Marcar cobrada» en Ventas (una o en lote) ponía
-- `paid = true` aunque la venta tuviera su deuda abierta en Cuentas
-- corrientes: la venta figuraba cobrada, el cliente seguía debiendo y no
-- quedaba ningún cobro registrado (ni caja, ni medio, ni recibo).
--
-- Ahora la base lo rechaza mientras la deuda tenga saldo, con el camino:
-- cobrarla en Cuentas corrientes. Los cobros de cuenta corriente ya saldan
-- la deuda antes de marcar la venta, así que no cambian.
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_venta_fiada_cobrada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.paid IS TRUE AND OLD.paid IS NOT TRUE
     AND EXISTS (SELECT 1 FROM public.debts d WHERE d.sale_id = NEW.id AND coalesce(d.remaining_ars, 0) > 0.01) THEN
    RAISE EXCEPTION 'Esta venta está fiada: cobrala en Cuentas corrientes, que registra el cobro y salda la deuda' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_venta_fiada_cobrada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_venta_fiada_cobrada ON public.sales;
CREATE TRIGGER trg_guard_venta_fiada_cobrada
BEFORE UPDATE OF paid ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.guard_venta_fiada_cobrada();

COMMIT;
