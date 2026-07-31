-- El id de pago vivía en `tracking_number`.
--
-- `mark_store_order_paid` guardaba el id de pago de MercadoPago en
-- `tracking_number`, que es la columna del número de seguimiento del envío.
-- Dos cosas distintas en el mismo campo, y las dos se le muestran al comprador:
-- la primera compra real quedó con "Seguimiento: 170468158111", un número que
-- no le sirve a ningún correo. Peor: al despachar de verdad, el número de envío
-- pisaba el id de pago y se perdía el dato con el que se reconcilia contra
-- MercadoPago.
--
-- Se le da columna propia y se mueve lo ya guardado con una regla conservadora:
-- un valor puramente numérico y largo es un id de pago; cualquier otra cosa se
-- deja donde está, porque puede ser un seguimiento real cargado a mano.
--
-- La función se reproduce completa a propósito —`CREATE OR REPLACE` no admite
-- cambiar una línea suelta— pero derivada del original: el `FOR UPDATE` sobre
-- products, el cálculo de costo y ganancia y el aviso al dueño quedan como
-- estaban.
--
-- Idempotente.

ALTER TABLE public.ecommerce_orders
  ADD COLUMN IF NOT EXISTS payment_id text;

COMMENT ON COLUMN public.ecommerce_orders.payment_id IS
  'Id del pago en el procesador (MercadoPago). No confundir con tracking_number, que es del envío.';

CREATE INDEX IF NOT EXISTS ecommerce_orders_payment_id_idx
  ON public.ecommerce_orders(payment_id) WHERE payment_id IS NOT NULL;

-- Rescatar lo que quedó en el campo equivocado.
UPDATE public.ecommerce_orders
   SET payment_id      = tracking_number,
       tracking_number = NULL
 WHERE payment_id IS NULL
   AND tracking_number ~ '^[0-9]{8,}$';

CREATE OR REPLACE FUNCTION public.mark_store_order_paid(
  p_order_id   uuid,
  p_payment_id text DEFAULT NULL,
  p_method     text DEFAULT 'mercado_pago'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order    record;
  v_item     jsonb;
  v_prod     record;
  v_qty      int;
  v_owner    uuid;
  v_rate     numeric;
  v_cost_ars numeric;
  v_profit   numeric;
  v_ventas   int := 0;
BEGIN
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  -- Idempotencia: si ya está paga, no se vuelve a descontar stock ni a
  -- duplicar la venta. Los webhooks reintentan.
  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'ya_procesada', true);
  END IF;

  SELECT m.user_id INTO v_owner
  FROM public.memberships m
  WHERE m.org_id = v_order.org_id AND m.role = 'owner'
  ORDER BY m.joined_at LIMIT 1;

  SELECT COALESCE(exchange_rate, 1) INTO v_rate
  FROM public.settings WHERE org_id = v_order.org_id;
  v_rate := COALESCE(v_rate, 1);

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 1);

    SELECT id, name, stock, total_cost_usd
    INTO v_prod
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid
    FOR UPDATE;   -- evita que dos pagos simultáneos lean el mismo stock

    IF v_prod.id IS NULL THEN CONTINUE; END IF;

    -- OJO: acá NO se descuenta stock a mano. El trigger
    -- `trg_sale_stock_movement` ya lo hace al insertar en `sales`, vía
    -- `record_stock_movement`, que además deja el asiento en el Kardex.
    -- Descontarlo también acá restaba el doble y dejaba stock negativo.

    v_cost_ars := COALESCE(v_prod.total_cost_usd, 0) * v_rate;
    v_profit   := (v_item->>'unit_price')::numeric * v_qty - v_cost_ars * v_qty;

    -- La venta online entra al mismo libro que el resto: así aparece en
    -- Dashboard, Reportes, P&L y comisiones sin tratamiento especial.
    INSERT INTO public.sales (
      org_id, user_id, product_id, product_name, quantity,
      unit_price_ars, total_ars, cost_per_unit_usd,
      profit_ars, profit_usd, customer_name, date, paid,
      payment_method, source
    ) VALUES (
      v_order.org_id, v_owner, v_prod.id, v_item->>'name', v_qty,
      (v_item->>'unit_price')::numeric,
      (v_item->>'total')::numeric,
      COALESCE(v_prod.total_cost_usd, 0),
      v_profit,
      CASE WHEN v_rate > 0 THEN v_profit / v_rate ELSE 0 END,
      v_order.customer_name, now(), true,
      p_method, 'tienda_online'
    );
    v_ventas := v_ventas + 1;
  END LOOP;

  UPDATE public.ecommerce_orders
  SET payment_status     = 'paid',
      fulfillment_status = CASE WHEN fulfillment_status = 'pending' THEN 'processing' ELSE fulfillment_status END,
      -- El id de pago va a su propia columna. `tracking_number` queda para el
      -- número de seguimiento del envío, que es lo que dice su nombre.
      payment_id         = COALESCE(payment_id, p_payment_id),
      updated_at         = now()
  WHERE id = p_order_id;

  -- Aviso al dueño.
  IF v_owner IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notifications (user_id, org_id, title, message, type)
      VALUES (
        v_owner, v_order.org_id,
        'Pedido pagado en la tienda',
        format('%s pagó %s (pedido %s)', v_order.customer_name,
               to_char(v_order.total, 'FM$999G999G999'), v_order.order_number),
        'ecommerce'
      );
    EXCEPTION WHEN OTHERS THEN NULL;  -- el aviso nunca debe frenar el cobro
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'ventas_creadas', v_ventas);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_store_order_paid(uuid, text, text) FROM PUBLIC;
-- Solo service_role (Edge Functions). Un comprador no puede marcar su propio
-- pedido como pagado.
