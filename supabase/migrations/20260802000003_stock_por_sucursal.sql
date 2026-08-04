-- ═══════════════════════════════════════════════════════════════════════════
-- Stock real por sucursal
--
-- La estructura estaba entera y sin usar: `locations`, `location_stock` con su
-- UNIQUE (location_id, product_id), la página para administrarlas, el selector
-- compartido `StoreFilter` y hasta un selector propio en el POS que **ya
-- guardaba `sales.location_id`**. Lo único que faltaba era el eslabón del medio:
-- `record_stock_movement` no sabía de sucursales, así que `location_stock`
-- nunca se escribía y quedaba en 0 filas.
--
-- Resultado: la venta sabía en qué sucursal se hizo y el stock no. Con dos
-- locales, el sistema no podía responder "¿cuánto tengo acá?", que es la única
-- pregunta que importa cuando alguien está parado frente al mostrador.
--
-- ── Qué NO cambia ─────────────────────────────────────────────────────────
--
-- `products.stock` sigue siendo el total de la organización y lo sigue
-- manteniendo la misma función. Todo lo que ya lee ese número —el catálogo, la
-- tienda, las alertas de reposición, los reportes— sigue funcionando igual.
-- `location_stock` es el desglose, no el reemplazo.
--
-- Y si la organización no tiene sucursales cargadas —que es el caso de todas
-- hoy— el comportamiento es **exactamente** el de antes: sin `location_id` no
-- se toca `location_stock`. La feature se enciende sola cuando el comercio crea
-- su primera sucursal.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Dónde ocurrió cada movimiento ─────────────────────────────────────────
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_location
  ON public.stock_movements(location_id, created_at DESC) WHERE location_id IS NOT NULL;

COMMENT ON COLUMN public.stock_movements.location_id IS
  'Sucursal donde ocurrió el movimiento. Null = la organización no usa sucursales, o el movimiento es anterior a que las usara.';

-- La mercadería tiene que poder ENTRAR a una sucursal, no sólo salir. Sin esto
-- `location_stock` sólo bajaría y terminaría en negativo.
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.purchases.location_id IS
  'Sucursal a la que entró la mercadería. Null = sin sucursales.';

-- ── record_stock_movement, ahora con sucursal ─────────────────────────────
--
-- ⚠️ Va DROP y no sólo CREATE OR REPLACE: agregar un parámetro **no reemplaza**
-- la función, crea una sobrecarga. Quedarían las dos, la vieja seguiría sin
-- tocar `location_stock`, y una llamada con parámetros nombrados que omitiera
-- `p_location_id` sería ambigua y fallaría. Se dropea la firma exacta anterior.
DROP FUNCTION IF EXISTS public.record_stock_movement(
  uuid, uuid, uuid, text, text, text, integer, text, uuid, numeric, numeric, text, uuid);

CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_org_id UUID, p_product_id UUID, p_variant_id UUID,
  p_product_name TEXT, p_variant_name TEXT,
  p_movement_type TEXT, p_quantity INTEGER,
  p_reference_type TEXT DEFAULT NULL, p_reference_id UUID DEFAULT NULL,
  p_unit_cost_usd NUMERIC DEFAULT NULL, p_unit_price_ars NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL, p_created_by UUID DEFAULT NULL,
  p_location_id UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stock_before INTEGER;
  v_stock_after  INTEGER;
  v_mov_id       UUID;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_stock_before FROM public.product_variants WHERE id = p_variant_id;
  ELSE
    SELECT stock INTO v_stock_before FROM public.products WHERE id = p_product_id;
  END IF;
  v_stock_before := COALESCE(v_stock_before, 0);
  v_stock_after  := v_stock_before + p_quantity;

  IF p_variant_id IS NOT NULL THEN
    UPDATE public.product_variants SET stock = v_stock_after WHERE id = p_variant_id;
    UPDATE public.products p
       SET stock = (SELECT COALESCE(SUM(pv.stock),0) FROM public.product_variants pv WHERE pv.product_id = p.id)
     WHERE id = p_product_id;
  ELSE
    UPDATE public.products SET stock = v_stock_after WHERE id = p_product_id;
  END IF;

  -- ── El desglose por sucursal ────────────────────────────────────────────
  -- `location_stock` es por producto, no por variante: la tabla no tiene
  -- variant_id. Un movimiento de variante suma al producto, que es el nivel al
  -- que se cuenta la mercadería en el depósito.
  IF p_location_id IS NOT NULL AND p_product_id IS NOT NULL THEN
    INSERT INTO public.location_stock (org_id, location_id, product_id, stock, updated_at)
    VALUES (p_org_id, p_location_id, p_product_id, p_quantity, now())
    ON CONFLICT (location_id, product_id) DO UPDATE
      SET stock = public.location_stock.stock + EXCLUDED.stock,
          updated_at = now();
  END IF;

  INSERT INTO public.stock_movements (
    org_id, product_id, variant_id, product_name, variant_name,
    movement_type, quantity, stock_before, stock_after,
    reference_type, reference_id, unit_cost_usd, unit_price_ars, notes, created_by,
    location_id
  ) VALUES (
    p_org_id, p_product_id, p_variant_id, p_product_name, p_variant_name,
    p_movement_type, p_quantity, v_stock_before, v_stock_after,
    p_reference_type, p_reference_id, p_unit_cost_usd, p_unit_price_ars, p_notes, p_created_by,
    p_location_id
  ) RETURNING id INTO v_mov_id;

  RETURN v_mov_id;
END;
$$;

COMMENT ON FUNCTION public.record_stock_movement IS
  'Único lugar que mueve stock. Mantiene products.stock (total de la organización) y, si se pasa p_location_id, el desglose en location_stock. Sin sucursal se comporta exactamente como antes.';

-- ── Los triggers pasan la sucursal ────────────────────────────────────────
--
-- Y de paso se arregla en `sales` el mismo bug que tenía `purchases`: la
-- organización salía de la PRIMERA membresía del usuario en vez de NEW.org_id,
-- así que para alguien que pertenece a dos organizaciones, una venta en la
-- segunda descontaba el stock de la primera. En ventas es peor que en compras:
-- descuenta mercadería de un negocio que no vendió nada.
CREATE OR REPLACE FUNCTION public.trg_sale_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id       UUID;
  v_variant_name TEXT;
BEGIN
  v_org_id := NEW.org_id;
  IF v_org_id IS NULL THEN
    SELECT m.org_id INTO v_org_id FROM public.memberships m
     WHERE m.user_id = NEW.user_id ORDER BY m.joined_at LIMIT 1;
  END IF;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name FROM public.product_variants WHERE id = NEW.variant_id;
  END IF;

  PERFORM public.record_stock_movement(
    p_org_id=>v_org_id, p_product_id=>NEW.product_id, p_variant_id=>NEW.variant_id,
    p_product_name=>NEW.product_name, p_variant_name=>v_variant_name,
    p_movement_type=>'sale', p_quantity=>-NEW.quantity,
    p_reference_type=>'sale', p_reference_id=>NEW.id,
    p_unit_cost_usd=>NEW.cost_per_unit_usd, p_unit_price_ars=>NEW.unit_price_ars,
    p_created_by=>NEW.user_id,
    p_location_id=>NEW.location_id
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_sale_stock_movement IS
  'Descuenta stock al vender, en la sucursal de la venta. Usa NEW.org_id; antes derivaba la organización de la primera membresía del usuario y una venta de la segunda organización descontaba el stock de la primera.';

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
    p_unit_cost_usd=>NEW.unit_cost_usd, p_created_by=>NEW.user_id,
    p_location_id=>NEW.location_id
  );
  RETURN NEW;
END;
$$;

-- ── Recibir una OC elige a qué sucursal entra ─────────────────────────────
-- Se dropea y recrea porque la firma cambia. La función es de ayer y no tiene
-- datos que dependan de ella.
DROP FUNCTION IF EXISTS public.receive_purchase_order(uuid, jsonb, text);

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_order_id    uuid,
  p_items       jsonb,
  p_notes       text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
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

  IF NOT public.is_org_member(v_org, v_user) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta orden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Una sucursal de OTRA organización sería una fuga entre tenants.
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l WHERE l.id = p_location_id AND l.org_id = v_org
  ) THEN
    RAISE EXCEPTION 'La sucursal no pertenece a esta organización'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No se indicó qué recibir' USING ERRCODE = 'invalid_parameter_value';
  END IF;

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

    v_cost_usd := CASE
      WHEN upper(COALESCE(v_currency, 'USD')) = 'ARS' AND v_rate IS NOT NULL
        THEN v_it.unit_cost / v_rate
      ELSE v_it.unit_cost
    END;

    INSERT INTO public.purchases (
      org_id, user_id, product_id, product_name, quantity,
      unit_cost_usd, customs_fee, total_usd, exchange_rate, total_ars,
      date, supplier, supplier_id, location_id
    ) VALUES (
      v_org, v_user, v_it.product_id, v_it.product_name, v_qty::int,
      v_cost_usd, 0, v_cost_usd * v_qty, COALESCE(v_rate, 0),
      CASE WHEN v_rate IS NULL THEN 0 ELSE v_cost_usd * v_qty * v_rate END,
      now(), v_supplier, v_supplier_id, p_location_id
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

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, jsonb, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, jsonb, text, uuid) TO authenticated;

-- ── Backfill: el stock que ya hay vive en la sucursal principal ───────────
--
-- Sólo para organizaciones que tengan sucursales. Sin esto, la primera venta en
-- una sucursal dejaría `location_stock` en negativo: el total de la
-- organización dice 40 y la sucursal arrancaría en 0.
--
-- Idempotente: si el producto ya tiene fila en alguna sucursal, no se toca.
INSERT INTO public.location_stock (org_id, location_id, product_id, stock, updated_at)
SELECT p.org_id, l.id, p.id, COALESCE(p.stock, 0), now()
FROM public.products p
JOIN LATERAL (
  SELECT lo.id FROM public.locations lo
   WHERE lo.org_id = p.org_id AND lo.active
   ORDER BY lo.is_main DESC, lo.created_at
   LIMIT 1
) l ON true
WHERE NOT EXISTS (
  SELECT 1 FROM public.location_stock ls WHERE ls.product_id = p.id
)
ON CONFLICT (location_id, product_id) DO NOTHING;

-- ── Al crear la PRIMERA sucursal, el stock que ya hay se le asigna ───────
--
-- El backfill de arriba corre una sola vez, al aplicar la migración, y hoy
-- ninguna organización tiene sucursales — así que no asignó nada. Sin este
-- trigger, la organización que cree su primera sucursal el mes que viene
-- arrancaría con `location_stock` en cero teniendo mercadería: la primera venta
-- la dejaría en negativo y el total nunca cerraría con el desglose.
--
-- Y ése no es un caso raro: es el ÚNICO camino por el que esta feature se
-- enciende. Lo detectó la vista de control en la verificación, marcando 10
-- unidades que el sistema no sabía dónde estaban.
--
-- Sólo con la primera: de la segunda en adelante la mercadería se reparte
-- moviéndola, no inventando existencias en el lugar nuevo.
CREATE OR REPLACE FUNCTION public.trg_location_seed_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT NEW.active THEN RETURN NEW; END IF;

  IF (SELECT count(*) FROM public.locations l
       WHERE l.org_id = NEW.org_id AND l.active) > 1 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.location_stock (org_id, location_id, product_id, stock, updated_at)
  SELECT p.org_id, NEW.id, p.id, COALESCE(p.stock, 0), now()
  FROM public.products p
  WHERE p.org_id = NEW.org_id
    AND NOT EXISTS (SELECT 1 FROM public.location_stock ls WHERE ls.product_id = p.id)
  ON CONFLICT (location_id, product_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_location_seed_stock ON public.locations;
CREATE TRIGGER trg_location_seed_stock
AFTER INSERT ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.trg_location_seed_stock();

COMMENT ON FUNCTION public.trg_location_seed_stock IS
  'Al crear la primera sucursal de una organización, le asigna el stock existente. Sin esto la feature arranca descuadrada: el total dice 40 y la sucursal 0.';

-- ── Control: el desglose tiene que cerrar con el total ────────────────────
CREATE OR REPLACE VIEW public.stock_sucursal_descuadrado
WITH (security_invoker = true) AS
SELECT p.org_id, p.id AS product_id, p.name,
       p.stock                       AS total_organizacion,
       COALESCE(sum(ls.stock), 0)    AS suma_sucursales,
       p.stock - COALESCE(sum(ls.stock), 0) AS diferencia
FROM public.products p
LEFT JOIN public.location_stock ls ON ls.product_id = p.id
WHERE EXISTS (SELECT 1 FROM public.locations l WHERE l.org_id = p.org_id AND l.active)
GROUP BY p.org_id, p.id, p.name, p.stock
HAVING p.stock <> COALESCE(sum(ls.stock), 0);

COMMENT ON VIEW public.stock_sucursal_descuadrado IS
  'Productos donde el total de la organización no coincide con la suma por sucursal. Tiene que estar vacía; una fila acá es mercadería que el sistema no sabe dónde está.';

GRANT SELECT ON public.stock_sucursal_descuadrado TO authenticated;
