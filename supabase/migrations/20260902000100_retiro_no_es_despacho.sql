-- Retiro en tienda no es un envío.
--
-- Medido 2026-09-02: las 2 órdenes pagas de Exentry son carrier=retiro,
-- shipping_service=sucursal, fulfillment=processing. El Foco decía
-- "pedidos pagados sin despachar" y esta RPC exigía una fila en
-- `deliveries` y el paso `shipped` antes de `delivered`. Square y Shopify
-- cierran pickup con "listo / retirado", no con etiqueta.
--
-- Domicilio sigue igual: preparar → en camino → entregado.
-- Misma firma: CREATE OR REPLACE no agrega sobrecarga.

CREATE OR REPLACE FUNCTION public.update_store_order_fulfillment(
  p_order_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_delivery_id uuid;
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_retiro boolean;
BEGIN
  IF v_status NOT IN ('shipped', 'delivered') THEN
    RAISE EXCEPTION 'Estado de entrega inválido: %', COALESCE(p_status, '');
  END IF;

  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  IF NOT public.has_permission(v_order.org_id, 'ecommerce', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para actualizar envíos de esta tienda';
  END IF;
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'La orden todavía no está paga';
  END IF;

  v_retiro := COALESCE(v_order.carrier, '') = 'retiro'
           OR COALESCE(v_order.shipping_service, '') = 'sucursal';

  IF v_order.fulfillment_status = 'delivered' THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'status', 'delivered');
  END IF;

  IF v_retiro THEN
    IF v_status = 'shipped' THEN
      RAISE EXCEPTION 'El retiro en tienda no se despacha. Marcalo como retirado.';
    END IF;
    IF v_order.fulfillment_status NOT IN ('pending', 'unfulfilled', 'processing') THEN
      RAISE EXCEPTION 'La orden no está en un estado que se pueda marcar como retirada';
    END IF;

    UPDATE public.deliveries
       SET status = 'delivered',
           delivered_at = COALESCE(delivered_at, now()),
           updated_at = now()
     WHERE ecommerce_order_id = p_order_id;

    UPDATE public.ecommerce_orders
       SET fulfillment_status = 'delivered', updated_at = now()
     WHERE id = p_order_id;

    RETURN jsonb_build_object('ok', true, 'changed', true, 'status', 'delivered');
  END IF;

  SELECT id INTO v_delivery_id
  FROM public.deliveries
  WHERE ecommerce_order_id = p_order_id
  ORDER BY created_at
  LIMIT 1;
  IF v_delivery_id IS NULL THEN
    RAISE EXCEPTION 'Primero prepará el envío de la orden';
  END IF;

  IF v_status = 'shipped' THEN
    IF v_order.fulfillment_status = 'shipped' THEN
      RETURN jsonb_build_object('ok', true, 'changed', false, 'status', 'shipped');
    END IF;
    IF v_order.fulfillment_status NOT IN ('pending', 'unfulfilled', 'processing') THEN
      RAISE EXCEPTION 'La orden no está en un estado que se pueda despachar';
    END IF;

    UPDATE public.deliveries
       SET status = CASE WHEN status IN ('pending', 'assigned') THEN 'in_transit' ELSE status END,
           picked_up_at = COALESCE(picked_up_at, now()),
           updated_at = now()
     WHERE id = v_delivery_id;

    UPDATE public.ecommerce_orders
       SET fulfillment_status = 'shipped', updated_at = now()
     WHERE id = p_order_id;
  ELSE
    IF v_order.fulfillment_status <> 'shipped' THEN
      RAISE EXCEPTION 'La orden tiene que estar en camino antes de marcarse entregada';
    END IF;

    UPDATE public.deliveries
       SET status = 'delivered', delivered_at = COALESCE(delivered_at, now()), updated_at = now()
     WHERE id = v_delivery_id;

    UPDATE public.ecommerce_orders
       SET fulfillment_status = 'delivered', updated_at = now()
     WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'changed', true, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.update_store_order_fulfillment(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_store_order_fulfillment(uuid, text)
  TO authenticated;

DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.update_store_order_fulfillment(uuid, text)'::regprocedure);
  IF v_def NOT LIKE '%El retiro en tienda no se despacha%' THEN
    RAISE EXCEPTION 'update_store_order_fulfillment no distingue retiro de envío';
  END IF;
  IF v_def NOT LIKE '%Primero prepará el envío de la orden%' THEN
    RAISE EXCEPTION 'el camino de domicilio perdió la guarda de deliveries';
  END IF;
END $$;
