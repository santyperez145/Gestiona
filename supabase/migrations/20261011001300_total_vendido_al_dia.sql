-- ═══════════════════════════════════════════════════════════════════════════
-- products.total_sold se mantiene con cada venta
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido 2026-10-11: `products.total_sold` existe desde 20260411 y la tienda
-- lo usa para «Más vendidos», para ordenar las sugerencias del buscador y los
-- productos relacionados, pero nada lo actualizaba: está en 0 en todos los
-- comercios, aun con 34 ventas registradas sobre 17 productos. El orden «Más
-- vendidos» de la tienda no ordenaba nada.
--
--   · Disparador en `sales` (alta, baja y cambio de producto o cantidad):
--     suma o resta las unidades netas de devoluciones (`quantity -
--     returned_quantity`). Una venta fraccionada (0,5 kg) cuenta como una
--     unidad: la columna es entera y mide popularidad, no kilos.
--   · Recalcula el contador desde las ventas existentes. Es un dato derivado
--     (un caché de `sales`), no un dato que haya cargado el comercio.
--   · `_unidades_de_venta` es interna (sin ejecución para la app).
--
-- Idempotente. Reversible: DROP TRIGGER, DROP FUNCTION (el contador queda
-- como esté).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public._unidades_de_venta(p_cantidad numeric, p_devuelto numeric)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$ SELECT CASE WHEN coalesce(p_cantidad, 0) - coalesce(p_devuelto, 0) <= 0 THEN 0
  ELSE ceil(coalesce(p_cantidad, 0) - coalesce(p_devuelto, 0))::integer END $$;

CREATE OR REPLACE FUNCTION public._total_vendido_al_dia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.product_id IS NOT NULL THEN
    UPDATE public.products
      SET total_sold = GREATEST(0, coalesce(total_sold, 0) - public._unidades_de_venta(OLD.quantity, OLD.returned_quantity))
    WHERE id = OLD.product_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.product_id IS NOT NULL THEN
    UPDATE public.products
      SET total_sold = coalesce(total_sold, 0) + public._unidades_de_venta(NEW.quantity, NEW.returned_quantity)
    WHERE id = NEW.product_id;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._total_vendido_al_dia() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._unidades_de_venta(numeric, numeric) FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_total_vendido_al_dia ON public.sales;
CREATE TRIGGER trg_total_vendido_al_dia
  AFTER INSERT OR DELETE OR UPDATE OF product_id, quantity, returned_quantity ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public._total_vendido_al_dia();

-- Caché al día con lo que ya se vendió.
UPDATE public.products p
SET total_sold = coalesce(v.unidades, 0)
FROM (
  SELECT pr.id, (SELECT sum(public._unidades_de_venta(s.quantity, s.returned_quantity)) FROM public.sales s WHERE s.product_id = pr.id) AS unidades
  FROM public.products pr
) v
WHERE v.id = p.id AND coalesce(p.total_sold, 0) IS DISTINCT FROM coalesce(v.unidades, 0);

COMMENT ON FUNCTION public._total_vendido_al_dia() IS
  'Mantiene products.total_sold (unidades vendidas; una venta fraccionada cuenta una) con cada alta, baja o cambio en sales.';

COMMIT;
