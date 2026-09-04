-- ═══════════════════════════════════════════════════════════════════════════
-- El stock se mueve UNA vez, y lo mueve la base
--
-- Cada venta y cada compra movían el stock **dos veces**. Verificado contra la
-- base reproduciendo lo que hace el cliente:
--
--   vender 3 de un producto con 10  → quedaba en 4, no en 7
--   comprar 5 de un producto con 10 → quedaba en 20, no en 15
--
-- El motivo: `addSaleDB`, `addSaleWithVariantDB` y `addPurchaseDB` insertaban la
-- fila —lo que dispara `trg_sale_stock_movement` / `trg_purchase_stock_movement`,
-- que ya descuentan— y **después** volvían a ajustar `products.stock` desde el
-- navegador. Los llaman todos los caminos de venta: POS, Ventas, Presupuestos y
-- el chat de IA.
--
-- Es exactamente el error que CONTRIBUTING.md advierte ("antes de descontar stock,
-- revisar si ya hay un trigger que lo haga") y que ya había dejado un stock de
-- 2 en −2. Se arregló en un lugar y quedó en los otros tres.
--
-- ── Y tres agujeros más que salieron al mirar ────────────────────────────
--
-- **Borrar no devolvía nada.** `deleteSaleDB` y `deletePurchaseDB` sólo borran
-- la fila. Anular una venta de 5 unidades dejaba el stock descontado para
-- siempre: la mercadería existía en el estante y no en el sistema.
--
-- **Las compras programadas sumaban stock antes de llegar.** El cliente
-- salteaba el ajuste si `is_scheduled`, pero el trigger no distinguía, así que
-- la mercadería entraba al stock el día que se programaba el pedido, no el día
-- que llegaba.
--
-- **Editar la cantidad se arreglaba a mano y sólo a veces.** El ajuste por
-- diferencia vivía en el cliente, no cubría el cambio de producto ni la
-- transición de programada a recibida.
--
-- ── La forma de arreglarlo ───────────────────────────────────────────────
--
-- Todo el movimiento de stock de ventas y compras pasa a la base, en INSERT,
-- UPDATE y DELETE. El cliente deja de tocar `products.stock`: inserta la venta
-- y el stock se acomoda solo. Es la única forma de que no vuelva a duplicarse,
-- porque hay al menos seis lugares que insertan ventas y cada uno podía
-- olvidarse —o acordarse de más, que fue lo que pasó—.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Ventas ────────────────────────────────────────────────────────────────
--
-- Se reemplaza el trigger de sólo INSERT por uno que cubre el ciclo entero.
-- La cantidad de una venta SALE del stock, así que el signo va invertido.
CREATE OR REPLACE FUNCTION public.trg_sale_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.product_id IS NOT NULL AND COALESCE(OLD.quantity,0) <> 0 THEN
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
$$;

COMMENT ON FUNCTION public.trg_sale_stock_movement IS
  'Único lugar que mueve stock por ventas. Cubre alta, edición y baja: al editar o borrar devuelve lo que la fila vieja había sacado y vuelve a aplicar la nueva, así un cambio de producto o de sucursal queda bien. El cliente NO debe ajustar products.stock — hacerlo descontaba el doble.';

DROP TRIGGER IF EXISTS trg_sale_stock_movement ON public.sales;
CREATE TRIGGER trg_sale_stock_movement
AFTER INSERT OR UPDATE OR DELETE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.trg_sale_stock_movement();

-- ── Compras ───────────────────────────────────────────────────────────────
--
-- Una compra programada todavía no llegó: no suma stock hasta que deja de
-- estarlo. Por eso la cantidad "efectiva" es 0 mientras `is_scheduled`, y el
-- paso de programada a recibida entra solo por el UPDATE.
CREATE OR REPLACE FUNCTION public.trg_purchase_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id UUID;
  v_fila   RECORD;
  v_viejo  INTEGER := 0;
  v_nuevo  INTEGER := 0;
BEGIN
  v_fila := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  v_org_id := v_fila.org_id;
  IF v_org_id IS NULL THEN
    SELECT m.org_id INTO v_org_id FROM public.memberships m
     WHERE m.user_id = v_fila.user_id ORDER BY m.joined_at LIMIT 1;
  END IF;
  IF v_org_id IS NULL THEN RETURN v_fila; END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_viejo := CASE WHEN COALESCE(OLD.is_scheduled, false) THEN 0 ELSE COALESCE(OLD.quantity, 0) END;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_nuevo := CASE WHEN COALESCE(NEW.is_scheduled, false) THEN 0 ELSE COALESCE(NEW.quantity, 0) END;
  END IF;

  -- Cambio de producto: se revierte del viejo y se aplica al nuevo, porque una
  -- diferencia no significa nada entre dos productos distintos.
  IF TG_OP = 'UPDATE' AND OLD.product_id IS DISTINCT FROM NEW.product_id THEN
    IF OLD.product_id IS NOT NULL AND v_viejo <> 0 THEN
      PERFORM public.record_stock_movement(
        p_org_id=>v_org_id, p_product_id=>OLD.product_id, p_variant_id=>NULL,
        p_product_name=>OLD.product_name, p_variant_name=>NULL,
        p_movement_type=>'purchase_edited', p_quantity=>-v_viejo,
        p_reference_type=>'purchase', p_reference_id=>OLD.id,
        p_unit_cost_usd=>OLD.unit_cost_usd, p_created_by=>OLD.user_id,
        p_location_id=>OLD.location_id);
    END IF;
    IF NEW.product_id IS NOT NULL AND v_nuevo <> 0 THEN
      PERFORM public.record_stock_movement(
        p_org_id=>v_org_id, p_product_id=>NEW.product_id, p_variant_id=>NULL,
        p_product_name=>NEW.product_name, p_variant_name=>NULL,
        p_movement_type=>'purchase', p_quantity=>v_nuevo,
        p_reference_type=>'purchase', p_reference_id=>NEW.id,
        p_unit_cost_usd=>NEW.unit_cost_usd, p_created_by=>NEW.user_id,
        p_location_id=>NEW.location_id);
    END IF;
    RETURN NEW;
  END IF;

  -- Mismo producto: alcanza con la diferencia. Cubre alta (0 → q), recepción de
  -- una programada (0 → q), edición de cantidad y baja (q → 0).
  IF (v_nuevo - v_viejo) <> 0 AND v_fila.product_id IS NOT NULL THEN
    PERFORM public.record_stock_movement(
      p_org_id=>v_org_id, p_product_id=>v_fila.product_id, p_variant_id=>NULL,
      p_product_name=>v_fila.product_name, p_variant_name=>NULL,
      p_movement_type=>CASE
        WHEN TG_OP = 'DELETE' THEN 'purchase_deleted'
        WHEN TG_OP = 'UPDATE' THEN 'purchase_edited'
        ELSE 'purchase' END,
      p_quantity=>(v_nuevo - v_viejo),
      p_reference_type=>'purchase', p_reference_id=>v_fila.id,
      p_unit_cost_usd=>v_fila.unit_cost_usd, p_created_by=>v_fila.user_id,
      p_location_id=>v_fila.location_id);
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_purchase_stock_movement IS
  'Único lugar que mueve stock por compras. Una compra programada cuenta como 0 hasta que deja de estarlo, así la mercadería entra cuando llega y no cuando se pide. Cubre alta, edición, recepción y baja. El cliente NO debe ajustar products.stock.';

DROP TRIGGER IF EXISTS trg_purchase_stock_movement ON public.purchases;
CREATE TRIGGER trg_purchase_stock_movement
AFTER INSERT OR UPDATE OR DELETE ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.trg_purchase_stock_movement();

-- ── Control: stock negativo ───────────────────────────────────────────────
-- No se fuerza a cero: un negativo es un dato que hay que mirar, no esconder.
-- Taparlo con GREATEST(0, ...) es lo que hacía que los descuentos dobles
-- pasaran desapercibidos.
CREATE OR REPLACE VIEW public.stock_negativo
WITH (security_invoker = true) AS
SELECT p.org_id, p.id AS product_id, p.name, p.stock
FROM public.products p
WHERE p.stock < 0;

COMMENT ON VIEW public.stock_negativo IS
  'Productos con stock negativo. Tiene que estar vacía: una fila es un movimiento de más o una venta sin respaldo.';

GRANT SELECT ON public.stock_negativo TO authenticated;
