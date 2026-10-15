-- Sucursales: dar de baja una sucursal no puede esconder stock ni dejar la
-- caja o la tienda sin local.
--
-- Medido el 2026-10-14: «Eliminar» en Sucursales la marcaba inactiva sin
-- ningún control. El stock que tenía dejaba de verse y de poder venderse (la
-- casa central de un comercio tiene 642.506 unidades), una caja abierta
-- quedaba en un local que ya no existe y se podía dar de baja la principal o
-- la que usa la tienda online.
--
-- Ahora la baja se rechaza, con el motivo, si la sucursal es la principal,
-- tiene stock (de productos o variantes), tiene una caja abierta o la usa una
-- tienda online. Primero se transfiere el stock o se cierra la caja.
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_baja_de_sucursal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unidades numeric;
BEGIN
  IF NOT (coalesce(OLD.active, true) AND NEW.active IS FALSE) THEN RETURN NEW; END IF;
  IF coalesce(OLD.is_main, false) THEN
    RAISE EXCEPTION 'Es la sucursal principal: marcá otra como principal antes de darla de baja' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(stock), 0) INTO v_unidades FROM public.location_stock WHERE location_id = OLD.id AND stock > 0;
  v_unidades := v_unidades + coalesce((SELECT sum(stock) FROM public.location_variant_stock WHERE location_id = OLD.id AND stock > 0), 0);
  IF v_unidades > 0 THEN
    RAISE EXCEPTION 'Tiene % unidades en stock: transferilas a otra sucursal antes de darla de baja', trim(to_char(v_unidades, 'FM999G999G990D###')) USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cash_sessions WHERE location_id = OLD.id AND status = 'open') THEN
    RAISE EXCEPTION 'Tiene una caja abierta: cerrala antes de dar de baja la sucursal' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ecommerce_stores WHERE fulfillment_location_id = OLD.id) THEN
    RAISE EXCEPTION 'La usa la tienda online para su stock: elegí otra sucursal en la tienda antes de darla de baja' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_baja_de_sucursal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_baja_de_sucursal ON public.locations;
CREATE TRIGGER trg_guard_baja_de_sucursal
BEFORE UPDATE OF active ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.guard_baja_de_sucursal();

COMMIT;
