-- Borrar un producto con ventas.
--
-- sales.product_id es ON DELETE SET NULL: borrar un producto deja sus ventas en
-- el historial sin vínculo. Ese UPDATE disparaba trg_sale_stock_movement, que
-- intentaba devolver el stock vendido al producto que se estaba borrando y
-- fallaba contra location_stock (producto inexistente). Resultado: ningún
-- producto con ventas se podía borrar, ni desde la app ni por SQL.
--
-- Ahora la reversión sólo corre si el producto (y la variante) siguen
-- existiendo. Editar o borrar una venta de un producto vivo no cambia.

CREATE OR REPLACE FUNCTION public.trg_sale_stock_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id       UUID;
  v_variant_name TEXT;
  v_fila         RECORD;
BEGIN
  -- En DELETE sólo existe OLD; en el resto manda NEW.
  v_fila := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  v_org_id := v_fila.org_id;
  IF v_org_id IS NULL THEN
    SELECT m.org_id INTO v_org_id FROM public.memberships m
     WHERE m.user_id = v_fila.user_id ORDER BY m.joined_at LIMIT 1;
  END IF;
  IF v_org_id IS NULL THEN RETURN v_fila; END IF;

  -- Devolver lo que la fila vieja había sacado. Cubre el DELETE y también el
  -- UPDATE que cambia de producto, de variante, de cantidad o de sucursal:
  -- se revierte entero y se vuelve a aplicar, en vez de intentar una
  -- diferencia que no sirve cuando cambia el producto.
  -- Si el producto (o la variante) se está borrando, la venta queda en el
  -- historial sin vínculo (ON DELETE SET NULL) y no hay stock al que
  -- devolverle nada: intentarlo reinsertaba stock de un producto inexistente
  -- y hacía imposible borrar cualquier producto con ventas.
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.product_id IS NOT NULL AND COALESCE(OLD.quantity,0) <> 0
     AND EXISTS (SELECT 1 FROM public.products p WHERE p.id = OLD.product_id)
     AND (OLD.variant_id IS NULL OR EXISTS (SELECT 1 FROM public.product_variants v WHERE v.id = OLD.variant_id)) THEN
    IF OLD.variant_id IS NOT NULL THEN
      SELECT variant_name INTO v_variant_name FROM public.product_variants WHERE id = OLD.variant_id;
    ELSE
      v_variant_name := NULL;
    END IF;
    PERFORM public.record_stock_movement(
      p_org_id=>v_org_id, p_product_id=>OLD.product_id, p_variant_id=>OLD.variant_id,
      p_product_name=>OLD.product_name, p_variant_name=>v_variant_name,
      p_movement_type=>CASE WHEN TG_OP = 'DELETE' THEN 'sale_deleted' ELSE 'sale_edited' END,
      p_quantity=>OLD.quantity,
      p_reference_type=>'sale', p_reference_id=>OLD.id,
      p_unit_cost_usd=>OLD.cost_per_unit_usd, p_unit_price_ars=>OLD.unit_price_ars,
      p_created_by=>OLD.user_id, p_location_id=>OLD.location_id
    );
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF NEW.product_id IS NOT NULL AND COALESCE(NEW.quantity,0) <> 0 THEN
    IF NEW.variant_id IS NOT NULL THEN
      SELECT variant_name INTO v_variant_name FROM public.product_variants WHERE id = NEW.variant_id;
    ELSE
      v_variant_name := NULL;
    END IF;
    PERFORM public.record_stock_movement(
      p_org_id=>v_org_id, p_product_id=>NEW.product_id, p_variant_id=>NEW.variant_id,
      p_product_name=>NEW.product_name, p_variant_name=>v_variant_name,
      p_movement_type=>'sale', p_quantity=>-NEW.quantity,
      p_reference_type=>'sale', p_reference_id=>NEW.id,
      p_unit_cost_usd=>NEW.cost_per_unit_usd, p_unit_price_ars=>NEW.unit_price_ars,
      p_created_by=>NEW.user_id, p_location_id=>NEW.location_id
    );
  END IF;

  RETURN NEW;
END;
$function$;
