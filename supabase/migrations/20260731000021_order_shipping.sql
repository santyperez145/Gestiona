-- Cerrar el ciclo de envío de una orden de la tienda online.
--
-- Hasta ahora la orden se pagaba y ahí terminaba el sistema: preparar el envío,
-- imprimir algo para pegarle a la caja y avisarle al comprador se hacía a mano
-- y fuera de la app. `deliveries` ya existía pero sólo se enlazaba a `sales`,
-- no a las órdenes online.
--
-- Lo que NO hace esto: pedirle la etiqueta a la API de Correo Argentino o
-- Andreani. Esos contratos no están verificados y no hay credenciales; cuando
-- las haya, el número de seguimiento entra por `set_order_tracking` igual que
-- si se copiara a mano, así que el resto no cambia.
--
-- Idempotente.

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS ecommerce_order_id uuid REFERENCES public.ecommerce_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS deliveries_ecommerce_order_idx
  ON public.deliveries(ecommerce_order_id) WHERE ecommerce_order_id IS NOT NULL;

-- `sale_id` era obligatorio de hecho: una entrega de una orden online no tiene
-- venta hasta que se registra. Se afloja la exigencia si estaba.
ALTER TABLE public.deliveries ALTER COLUMN sale_id DROP NOT NULL;

-- ── Preparar el envío de una orden ────────────────────────────────────────
-- Crea la entrega a partir de la dirección que ya cargó el comprador. No se
-- vuelve a pedir nada: todo está en la orden.
CREATE OR REPLACE FUNCTION public.prepare_order_shipment(
  p_order_id  uuid,
  p_carrier   text DEFAULT 'propio',
  p_weight_kg numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order    record;
  v_dir      jsonb;
  v_id       uuid;
  v_code     text;
  v_peso     numeric;
BEGIN
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  IF NOT public.has_org_role(v_order.org_id, auth.uid(), ARRAY['owner','admin','manager']) THEN
    RAISE EXCEPTION 'No tenés permiso para preparar envíos de esta tienda';
  END IF;

  -- Preparar el envío de algo que todavía no se cobró es la forma más cara de
  -- equivocarse. Se avisa acá y no en la UI, que es donde se puede saltear.
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'La orden todavía no está paga';
  END IF;

  -- Si ya tiene entrega, se devuelve la que hay en vez de crear otra.
  SELECT id, tracking_code INTO v_id, v_code
  FROM public.deliveries WHERE ecommerce_order_id = p_order_id LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'tracking_code', v_code, 'existing', true);
  END IF;

  v_dir := COALESCE(v_order.shipping_address, '{}'::jsonb);

  -- Peso: el que se pase, o el declarado de la tienda por unidad, o 0.5 kg.
  IF p_weight_kg IS NOT NULL AND p_weight_kg > 0 THEN
    v_peso := p_weight_kg;
  ELSE
    SELECT COALESCE(s.default_item_weight_kg, 0.5)
             * GREATEST(1, (SELECT COALESCE(sum((it->>'quantity')::int), 1)
                            FROM jsonb_array_elements(v_order.items) it))
      INTO v_peso
    FROM public.ecommerce_stores s WHERE s.org_id = v_order.org_id LIMIT 1;
    v_peso := COALESCE(v_peso, 0.5);
  END IF;

  -- El código interno se deriva del número de orden: buscar la entrega de un
  -- pedido no debería requerir una tabla de traducción.
  v_code := 'ENV-' || v_order.order_number;

  INSERT INTO public.deliveries (
    org_id, ecommerce_order_id, tracking_code,
    customer_name, customer_phone, customer_email,
    address_street, address_city, address_province, address_zip, address_notes,
    carrier, status, weight_kg,
    cod_amount, cod_collected
  ) VALUES (
    v_order.org_id, p_order_id, v_code,
    v_order.customer_name, v_order.customer_phone, v_order.customer_email,
    COALESCE(v_dir->>'street', v_dir->>'address', ''),
    COALESCE(v_dir->>'city', ''),
    COALESCE(v_dir->>'province', v_dir->>'state', ''),
    COALESCE(v_dir->>'zip', v_dir->>'postal_code', ''),
    NULLIF(v_dir->>'notes', ''),
    COALESCE(NULLIF(btrim(p_carrier), ''), 'propio'),
    'pending', v_peso,
    -- Ya está paga, así que no hay nada que cobrar contra entrega.
    0, true
  )
  RETURNING id INTO v_id;

  UPDATE public.ecommerce_orders
     SET fulfillment_status = 'processing'
   WHERE id = p_order_id AND fulfillment_status IN ('pending', 'unfulfilled');

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'tracking_code', v_code, 'existing', false);
END;
$$;

-- ── Cargar el seguimiento ─────────────────────────────────────────────────
-- Sirve igual si el número se copió de la web del correo o si lo devolvió una
-- API: el resto del sistema no necesita saber de dónde salió.
CREATE OR REPLACE FUNCTION public.set_order_tracking(
  p_order_id  uuid,
  p_carrier   text,
  p_tracking  text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order    record;
  v_tracking text := NULLIF(btrim(p_tracking), '');
BEGIN
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  IF NOT public.has_org_role(v_order.org_id, auth.uid(), ARRAY['owner','admin','manager']) THEN
    RAISE EXCEPTION 'No tenés permiso para editar envíos de esta tienda';
  END IF;
  IF v_tracking IS NULL THEN RAISE EXCEPTION 'Falta el número de seguimiento'; END IF;

  UPDATE public.deliveries
     SET carrier           = COALESCE(NULLIF(btrim(p_carrier), ''), carrier),
         external_tracking = v_tracking,
         status            = CASE WHEN status IN ('pending', 'assigned') THEN 'in_transit' ELSE status END,
         picked_up_at      = COALESCE(picked_up_at, now()),
         updated_at        = now()
   WHERE ecommerce_order_id = p_order_id;

  UPDATE public.ecommerce_orders
     SET tracking_number    = v_tracking,
         fulfillment_status = 'shipped'
   WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'tracking', v_tracking);
END;
$$;

-- ── Seguimiento para el comprador ─────────────────────────────────────────
-- Sin cuenta: alcanza con el número de orden y el email con el que compró. Es
-- el mismo par que ya usa la página de la orden, así que no se abre nada nuevo.
CREATE OR REPLACE FUNCTION public.get_order_tracking(p_order_number text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order record;
  v_del   record;
  v_url   text;
BEGIN
  SELECT o.id, o.fulfillment_status, o.tracking_number, o.created_at, o.org_id
    INTO v_order
  FROM public.ecommerce_orders o
  WHERE upper(o.order_number) = upper(btrim(p_order_number))
    AND lower(o.customer_email) = lower(btrim(p_email));

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT d.carrier, d.external_tracking, d.status, d.picked_up_at, d.delivered_at
    INTO v_del
  FROM public.deliveries d WHERE d.ecommerce_order_id = v_order.id LIMIT 1;

  -- URL de seguimiento del transportista, si el comercio la tiene cargada.
  SELECT replace(c.tracking_url, '{tracking_number}', COALESCE(v_del.external_tracking, ''))
    INTO v_url
  FROM public.carriers c
  WHERE c.org_id = v_order.org_id
    AND lower(c.code) = lower(COALESCE(v_del.carrier, ''))
    AND c.tracking_url IS NOT NULL
  LIMIT 1;

  RETURN jsonb_build_object(
    'found', true,
    'fulfillment_status', v_order.fulfillment_status,
    'tracking_number', v_order.tracking_number,
    'carrier', v_del.carrier,
    'shipment_status', v_del.status,
    'picked_up_at', v_del.picked_up_at,
    'delivered_at', v_del.delivered_at,
    'tracking_url', NULLIF(v_url, ''),
    'ordered_at', v_order.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_order_shipment(uuid, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_order_tracking(uuid, text, text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_order_tracking(text, text)              FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.prepare_order_shipment(uuid, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_tracking(uuid, text, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_tracking(text, text)              TO anon, authenticated;
