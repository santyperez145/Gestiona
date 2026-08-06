-- ═══════════════════════════════════════════════════════════════════════════
-- A2 — Reservar el stock entre la orden y el pago
--
-- Hoy `create_store_order` **valida** stock pero no lo toca: el descuento
-- ocurre recién en `mark_store_order_paid`. Entre esos dos momentos —que pueden
-- ser veinte minutos si el comprador va a hacer la transferencia— el stock
-- sigue figurando disponible para todos.
--
-- Resultado: dos compradores compran la última unidad al mismo tiempo, los dos
-- pagan, y uno se entera después. En una tienda de perfumes importados, donde
-- muchos productos tienen stock 1, no es un caso raro: es el caso.
--
-- ── El concepto: stock disponible ────────────────────────────────────────
--
--     disponible = stock − reservas activas
--
-- Una reserva no descuenta: **aparta**. Por eso al pagar hay que soltarla y
-- descontar, no descontar dos veces — que es exactamente el error que este repo
-- cometió tres veces y que `mark_store_order_paid` ya documenta en su cuerpo.
--
-- ── Una sola tabla, no dos ───────────────────────────────────────────────
--
-- `stock_reservations` ya existía para reservas manuales ("apartame esto para
-- Juan"): tiene `customer_name`, `customer_phone`, `notes`. Una reserva de
-- checkout es la misma pregunta —"¿esta mercadería está comprometida?"— con
-- otro origen, así que se le agrega `order_id` en vez de crear una tabla
-- paralela. Dos tablas contestando lo mismo es cómo se llegó a que
-- `bin_stock` y `location_stock` hablaran de lugares distintos.
--
-- ── Por qué triggers y no parchear las funciones ─────────────────────────
--
-- `create_store_order` y `mark_store_order_paid` las está editando la otra PC
-- en paralelo. Un trigger sobre `ecommerce_orders` consigue lo mismo sin tocar
-- su cuerpo, y además cubre cualquier camino futuro que cree una orden.
--
-- Si la reserva falla, la excepción **revierte el INSERT de la orden**. Es lo
-- correcto: una orden que no tiene stock reservado no debería existir.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.stock_reservations
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.ecommerce_orders(id) ON DELETE CASCADE;

-- Las reservas de checkout no tienen nombre ni teléfono cargados a mano.
ALTER TABLE public.stock_reservations ALTER COLUMN customer_name DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reservas_activas
  ON public.stock_reservations(product_id, status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_reservas_orden
  ON public.stock_reservations(order_id) WHERE order_id IS NOT NULL;

COMMENT ON COLUMN public.stock_reservations.order_id IS
  'Orden de la tienda que generó la reserva. Null = reserva manual desde el panel. Las dos comprometen stock igual.';

-- ── Cuánto hay realmente disponible ──────────────────────────────────────
--
-- `stock` menos lo apartado y todavía vigente. Una reserva vencida no bloquea:
-- se la deja en la tabla para poder auditar por qué se cayó una venta, pero no
-- cuenta.
CREATE OR REPLACE FUNCTION public.stock_disponible(
  p_product_id uuid,
  p_variant_id uuid DEFAULT NULL
) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    CASE WHEN p_variant_id IS NOT NULL
         THEN (SELECT v.stock FROM public.product_variants v WHERE v.id = p_variant_id)
         ELSE (SELECT p.stock FROM public.products p WHERE p.id = p_product_id)
    END, 0)
  - COALESCE((
      SELECT sum(r.quantity) FROM public.stock_reservations r
      WHERE r.status = 'active'
        AND (r.expires_at IS NULL OR r.expires_at > now())
        AND r.product_id = p_product_id
        AND r.variant_id IS NOT DISTINCT FROM p_variant_id
    ), 0);
$$;

COMMENT ON FUNCTION public.stock_disponible IS
  'Stock menos lo reservado y vigente. Es el número contra el que hay que validar una venta: `products.stock` incluye mercadería que ya tiene dueño.';

REVOKE ALL ON FUNCTION public.stock_disponible(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.stock_disponible(uuid, uuid) TO anon, authenticated;

-- ── Al crear la orden: apartar ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_reservar_stock_de_orden()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item      jsonb;
  v_pid       uuid;
  v_vid       uuid;
  v_qty       numeric;
  v_disp      numeric;
  v_nombre    text;
  v_minutos   int := 30;
BEGIN
  -- Una orden que nace paga —importada, o de un camino que cobra antes— no
  -- necesita reserva: el stock se descuenta enseguida.
  IF NEW.payment_status = 'paid' THEN RETURN NEW; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) LOOP
    v_pid := NULLIF(v_item->>'product_id', '')::uuid;
    v_vid := NULLIF(v_item->>'variant_id', '')::uuid;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    IF v_pid IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    -- El lock es lo que evita que dos checkouts simultáneos lean el mismo
    -- disponible y los dos pasen. Sin esto la reserva no sirve de nada: sería
    -- la misma carrera, un paso más adelante.
    PERFORM 1 FROM public.products WHERE id = v_pid FOR UPDATE;

    v_disp := public.stock_disponible(v_pid, v_vid);

    IF v_disp < v_qty THEN
      SELECT name INTO v_nombre FROM public.products WHERE id = v_pid;
      RAISE EXCEPTION 'Sin stock disponible de %: quedan % y se piden %',
        COALESCE(v_nombre, 'el producto'), GREATEST(v_disp, 0), v_qty
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    INSERT INTO public.stock_reservations (
      org_id, order_id, product_id, variant_id, quantity,
      status, expires_at, customer_name, notes
    ) VALUES (
      NEW.org_id, NEW.id, v_pid, v_vid, v_qty,
      'active', now() + (v_minutos || ' minutes')::interval,
      NULLIF(NEW.customer_name, ''),
      format('Orden %s', NEW.order_number)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_reservar_stock_de_orden IS
  'Aparta el stock al crear una orden impaga. Si no alcanza, la excepción revierte el INSERT: una orden sin stock reservado no debería existir.';

DROP TRIGGER IF EXISTS trg_reservar_stock_de_orden ON public.ecommerce_orders;
CREATE TRIGGER trg_reservar_stock_de_orden
AFTER INSERT ON public.ecommerce_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_reservar_stock_de_orden();

-- ── Al pagar o cancelar: soltar ──────────────────────────────────────────
--
-- ⚠️ Soltar, **no descontar**. El descuento lo hace `mark_store_order_paid`
-- insertando en `sales`, y de ahí `trg_sale_stock_movement`. Si acá también se
-- tocara el stock, se descontaría dos veces — que es el error que este repo ya
-- cometió en las ventas, las compras y las transferencias.
CREATE OR REPLACE FUNCTION public.trg_soltar_reserva_de_orden()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    -- Se usa el vocabulario que la tabla ya tenía —`fulfilled`, `cancelled`,
    -- `expired`— en vez de inventar uno nuevo: hay una pantalla de reservas
    -- manuales que lo lee, y dos vocabularios para lo mismo es cómo se termina
    -- con la mitad de las filas invisibles en un listado.
    IF NEW.payment_status = 'paid' THEN
      UPDATE public.stock_reservations
         SET status = 'fulfilled', resolved_at = now()
       WHERE order_id = NEW.id AND status = 'active';
    -- Sólo los estados que el CHECK de `ecommerce_orders` admite de verdad:
    -- pending, paid, failed, refunded, partial. Listar 'cancelled' o 'expired'
    -- acá sería una rama muerta que da la impresión de estar cubierta.
    ELSIF NEW.payment_status IN ('failed', 'refunded') THEN
      UPDATE public.stock_reservations
         SET status = 'cancelled', resolved_at = now()
       WHERE order_id = NEW.id AND status = 'active';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_soltar_reserva_de_orden ON public.ecommerce_orders;
CREATE TRIGGER trg_soltar_reserva_de_orden
AFTER UPDATE OF payment_status ON public.ecommerce_orders
FOR EACH ROW EXECUTE FUNCTION public.trg_soltar_reserva_de_orden();

COMMENT ON FUNCTION public.trg_soltar_reserva_de_orden IS
  'Suelta la reserva al pagar (fulfilled) o al caerse la orden (cancelled). NO toca el stock: descontarlo acá además del trigger de ventas restaría el doble.';

-- ── Vencimiento ──────────────────────────────────────────────────────────
--
-- Se marcan, no se borran: una reserva vencida explica por qué una venta no se
-- concretó, y borrarla deja el hueco sin explicación. Igual dejan de bloquear
-- desde el momento en que vencen, porque `stock_disponible` mira `expires_at`.
CREATE OR REPLACE FUNCTION public.vencer_reservas()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  UPDATE public.stock_reservations
     SET status = 'expired', resolved_at = now()
   WHERE status = 'active'
     AND expires_at IS NOT NULL
     AND expires_at <= now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.vencer_reservas IS
  'Marca como vencidas las reservas que pasaron su plazo. No hace falta que corra para que el stock se libere —stock_disponible ya ignora las vencidas— pero deja el estado explícito para poder auditarlo.';

-- ── Control ──────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.stock_comprometido
WITH (security_invoker = true) AS
SELECT r.org_id, r.product_id, p.name AS producto,
       p.stock AS stock_total,
       sum(r.quantity) AS reservado,
       p.stock - sum(r.quantity) AS disponible,
       min(r.expires_at) AS primera_vence,
       count(*) FILTER (WHERE r.order_id IS NOT NULL) AS de_ordenes,
       count(*) FILTER (WHERE r.order_id IS NULL) AS manuales
FROM public.stock_reservations r
JOIN public.products p ON p.id = r.product_id
WHERE r.status = 'active' AND (r.expires_at IS NULL OR r.expires_at > now())
GROUP BY r.org_id, r.product_id, p.name, p.stock;

COMMENT ON VIEW public.stock_comprometido IS
  'Mercadería apartada y todavía vigente. `disponible` es lo que se le puede vender a alguien más; si sale negativo hay reservas por encima del stock y algo se sobrevendió.';

GRANT SELECT ON public.stock_comprometido TO authenticated;
