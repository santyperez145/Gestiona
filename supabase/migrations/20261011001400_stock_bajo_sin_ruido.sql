-- ═══════════════════════════════════════════════════════════════════════════
-- Aviso de stock bajo: sólo de lo que se vende y una vez por producto
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido 2026-10-11: Ferretería Famatina tiene 10.552 notificaciones «Stock
-- bajo» sin leer, todas del 8 y 9 de octubre: las generó la importación del
-- catálogo, una por artículo, porque `notify_low_stock` avisa en cada cambio
-- de stock que cruza el umbral. En un catálogo grande la mayoría de los
-- artículos no se tiene en stock; avisar de todos tapa los avisos útiles.
--
--   · Sólo avisa si el producto ya se vendió alguna vez (hay ventas): el
--     stock que baja por una venta es el que corta la próxima.
--   · No repite: si ya hay un aviso de stock bajo sin leer de ese producto,
--     no crea otro.
--
-- No toca las notificaciones existentes (el comercio puede marcarlas como
-- leídas). Idempotente (CREATE OR REPLACE). Reversible: volver a la versión de
-- 20260421111259.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.notify_low_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE threshold integer;
BEGIN
  SELECT COALESCE(low_stock_threshold, 3) INTO threshold
  FROM public.settings WHERE org_id = NEW.org_id LIMIT 1;
  IF threshold IS NULL THEN threshold := 3; END IF;

  IF NEW.stock <= threshold AND (OLD.stock IS NULL OR OLD.stock > threshold)
     -- Lo que nunca se vendió no corta ninguna venta (y una importación no
     -- es una venta).
     AND EXISTS (SELECT 1 FROM public.sales s WHERE s.product_id = NEW.id)
     AND NOT EXISTS (
       SELECT 1 FROM public.notifications n
       WHERE n.org_id = NEW.org_id AND n.type = 'stock_bajo'
         AND n.entity_type = 'product' AND n.entity_id = NEW.id::text AND NOT n.read
     ) THEN
    INSERT INTO public.notifications (user_id, org_id, title, message, type, entity_type, entity_id)
    VALUES (
      NEW.user_id, NEW.org_id,
      'Stock bajo: ' || NEW.name,
      CASE WHEN NEW.stock = 0 THEN 'Sin stock disponible' ELSE 'Solo quedan ' || NEW.stock || ' unidades' END,
      'stock_bajo', 'product', NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
