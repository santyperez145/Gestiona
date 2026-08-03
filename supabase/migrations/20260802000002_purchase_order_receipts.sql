-- ═══════════════════════════════════════════════════════════════════════════
-- Recepción parcial de órdenes de compra
--
-- El ROADMAP lo anotaba como "hoy la orden se recibe entera o nada". Mirando el
-- código es peor: **no se recibe nada**. El botón "Marcar recibida" corre un
-- UPDATE de `status` y `received_date` y nada más. No toca `quantity_received`
-- —que ya existía en `purchase_order_items` y quedaba en 0 para siempre— ni
-- mueve una sola unidad de stock.
--
-- O sea que el módulo de órdenes de compra estaba desconectado del inventario:
-- se podía marcar recibida una OC de 200 unidades y el stock no se movía. El
-- estado `partially_received` estaba en el vocabulario y en la UI con su color
-- ámbar, pero no había forma de llegar a él.
--
-- ── Cómo se mueve el stock, que no es escribiéndolo ───────────────────────
--
-- `purchases` ya tiene `trg_purchase_stock_movement`, que llama a
-- `record_stock_movement`. Así que recibir una OC **inserta filas en
-- `purchases`** y deja que el trigger existente haga el movimiento. Escribir el
-- stock a mano acá habría duplicado el descuento, que es el error que ya se
-- cometió una vez con `trg_sale_stock_movement` y dejó un stock de 2 en −2.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Bug previo: el trigger ignoraba el org_id de la compra ────────────────
--
-- Derivaba la organización de la PRIMERA membresía del usuario en vez de usar
-- `NEW.org_id`, que existe y es NOT NULL. Para alguien que pertenece a dos
-- organizaciones, una compra cargada en la segunda movía el stock de la
-- primera: mercadería que entra en un negocio aparece en otro.
--
-- Se arregla acá porque la recepción de OC depende de esto: si no, recibir una
-- orden movería el stock de la organización equivocada. Se conserva el fallback
-- por membresía para filas viejas que por algún camino no tengan org_id.
CREATE OR REPLACE FUNCTION public.trg_purchase_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org_id UUID;
BEGIN
  v_org_id := NEW.org_id;

  IF v_org_id IS NULL THEN
    SELECT m.org_id INTO v_org_id FROM public.memberships m
     WHERE m.user_id = NEW.user_id ORDER BY m.joined_at LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public.record_stock_movement(
    p_org_id=>v_org_id, p_product_id=>NEW.product_id, p_variant_id=>NULL,
    p_product_name=>NEW.product_name, p_variant_name=>NULL,
    p_movement_type=>'purchase', p_quantity=>NEW.quantity,
    p_reference_type=>'purchase', p_reference_id=>NEW.id,
    p_unit_cost_usd=>NEW.unit_cost_usd, p_created_by=>NEW.user_id
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_purchase_stock_movement IS
  'Mueve el stock al insertar una compra. Usa NEW.org_id; antes derivaba la organización de la primera membresía del usuario y una compra de la segunda organización movía el stock de la primera.';

-- ── Historial de recepciones ──────────────────────────────────────────────
--
-- Una fila por "llegaron N unidades de este renglón". Recibir parcial implica
-- varias entregas, y sin historial no se puede responder cuándo llegó cada
-- parte ni quién la recibió — que es justamente lo que se le reclama al
-- proveedor cuando falta mercadería.
CREATE TABLE IF NOT EXISTS public.purchase_order_receipts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_id      uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.purchase_order_items(id) ON DELETE CASCADE,
  purchase_id   uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  quantity      numeric NOT NULL CHECK (quantity > 0),
  received_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  notes         text
);

CREATE INDEX IF NOT EXISTS idx_po_receipts_order ON public.purchase_order_receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_po_receipts_org   ON public.purchase_order_receipts(org_id, received_at DESC);

COMMENT ON TABLE public.purchase_order_receipts IS
  'Cada entrega parcial de una orden de compra. purchase_id apunta a la fila de `purchases` que movió el stock, para poder rastrear el movimiento desde la recepción.';

ALTER TABLE public.purchase_order_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_members_read_po_receipts ON public.purchase_order_receipts;
CREATE POLICY org_members_read_po_receipts ON public.purchase_order_receipts
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

-- Sin policy de INSERT a propósito: se escribe sólo por `receive_purchase_order`,
-- que valida cantidades. Una escritura directa podría registrar una recepción
-- sin mover el stock, o recibir más de lo pedido.

-- ── Recibir ───────────────────────────────────────────────────────────────
--
-- Un solo RPC para toda la operación: valida, registra la entrega, mueve el
-- stock y recalcula el estado. En un round-trip y en una transacción, porque a
-- mitad de camino el stock ya se movió y la orden todavía diría "confirmada".
--
-- `p_items` es [{"item_id": uuid, "quantity": n}, ...]. Cantidad mayor a lo que
-- falta ⇒ error, no recorte silencioso: recibir de más es un problema con el
-- proveedor y tiene que verse, no arreglarse solo.
CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_order_id uuid,
  p_items    jsonb,
  p_notes    text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org        uuid;
  v_user       uuid := auth.uid();
  v_currency   text;
  v_supplier   text;
  v_supplier_id uuid;
  v_rate       numeric;
  v_item       jsonb;
  v_it         record;
  v_qty        numeric;
  v_pendiente  numeric;
  v_cost_usd   numeric;
  v_purchase   uuid;
  v_recibidos  int := 0;
  v_estado     text;
BEGIN
  SELECT po.org_id, po.currency, po.supplier_name, po.supplier_id
    INTO v_org, v_currency, v_supplier, v_supplier_id
    FROM public.purchase_orders po WHERE po.id = p_order_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'La orden de compra no existe' USING ERRCODE = 'no_data_found';
  END IF;

  -- SECURITY DEFINER saltea la RLS, así que el control de acceso es esta línea.
  IF NOT public.is_org_member(v_org, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta orden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No se indicó qué recibir' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Cotización de la organización. Sólo se usa para convertir entre USD y ARS;
  -- si no hay, se deja el costo como vino y el total en pesos en 0 antes que
  -- inventar un número.
  SELECT NULLIF(s.exchange_rate, 0) INTO v_rate
    FROM public.settings s WHERE s.org_id = v_org LIMIT 1;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    SELECT i.* INTO v_it FROM public.purchase_order_items i
     WHERE i.id = (v_item->>'item_id')::uuid AND i.order_id = p_order_id;

    IF v_it.id IS NULL THEN
      RAISE EXCEPTION 'El renglón % no pertenece a esta orden', v_item->>'item_id'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_pendiente := v_it.quantity_ordered - COALESCE(v_it.quantity_received, 0);
    IF v_qty > v_pendiente THEN
      RAISE EXCEPTION 'De "%" faltan % unidades y se quieren recibir %',
        v_it.product_name, v_pendiente, v_qty USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- El costo de `purchases` es en dólares. La OC puede estar en cualquiera de
    -- las dos monedas (la base default USD, el formulario ARS), así que se
    -- convierte según la que tenga.
    v_cost_usd := CASE
      WHEN upper(COALESCE(v_currency, 'USD')) = 'ARS' AND v_rate IS NOT NULL
        THEN v_it.unit_cost / v_rate
      ELSE v_it.unit_cost
    END;

    -- El stock lo mueve `trg_purchase_stock_movement` al insertar acá. No se
    -- escribe el stock a mano: duplicarlo es el error clásico de este repo.
    INSERT INTO public.purchases (
      org_id, user_id, product_id, product_name, quantity,
      unit_cost_usd, customs_fee, total_usd, exchange_rate, total_ars,
      date, supplier, supplier_id
    ) VALUES (
      v_org, v_user, v_it.product_id, v_it.product_name, v_qty::int,
      v_cost_usd, 0, v_cost_usd * v_qty, COALESCE(v_rate, 0),
      CASE WHEN v_rate IS NULL THEN 0 ELSE v_cost_usd * v_qty * v_rate END,
      now(), v_supplier, v_supplier_id
    ) RETURNING id INTO v_purchase;

    INSERT INTO public.purchase_order_receipts (
      org_id, order_id, order_item_id, purchase_id, quantity, received_by, notes
    ) VALUES (v_org, p_order_id, v_it.id, v_purchase, v_qty, v_user, p_notes);

    UPDATE public.purchase_order_items
       SET quantity_received = COALESCE(quantity_received, 0) + v_qty
     WHERE id = v_it.id;

    v_recibidos := v_recibidos + 1;
  END LOOP;

  IF v_recibidos = 0 THEN
    RAISE EXCEPTION 'No se recibió ningún renglón' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- El estado sale de los renglones, no de lo que crea quien llama: si falta
  -- una sola unidad, la orden no está recibida.
  SELECT CASE
           WHEN bool_and(COALESCE(quantity_received,0) >= quantity_ordered) THEN 'received'
           ELSE 'partially_received'
         END
    INTO v_estado
    FROM public.purchase_order_items WHERE order_id = p_order_id;

  UPDATE public.purchase_orders
     SET status = v_estado,
         received_date = CASE WHEN v_estado = 'received' THEN current_date ELSE received_date END,
         updated_at = now()
   WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'status', v_estado,
    'renglones_recibidos', v_recibidos,
    'pendientes', (SELECT COALESCE(sum(quantity_ordered - COALESCE(quantity_received,0)), 0)
                     FROM public.purchase_order_items WHERE order_id = p_order_id)
  );
END;
$$;

COMMENT ON FUNCTION public.receive_purchase_order IS
  'Registra una entrega (total o parcial) de una orden de compra: valida contra lo pendiente, inserta en `purchases` para que el trigger mueva el stock, deja la recepción en `purchase_order_receipts` y recalcula el estado de la orden. Recibir más de lo pedido es un error, no un recorte silencioso.';

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, jsonb, text) TO authenticated;
GRANT SELECT ON public.purchase_order_receipts TO authenticated;
