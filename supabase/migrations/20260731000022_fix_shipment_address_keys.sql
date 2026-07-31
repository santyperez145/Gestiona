-- La etiqueta salía sin dirección.
--
-- `prepare_order_shipment` leía `shipping_address` con claves en inglés
-- (`street`, `city`, `province`, `zip`), pero el checkout de la tienda las
-- guarda **en español**: `calle`, `ciudad`, `provincia`, `cp`, `notas`. Los
-- `COALESCE` caían todos al `''` final, así que la entrega se creaba con el
-- destino vacío y la etiqueta se imprimía con el nombre del comprador y nada
-- más. Se ve recién al imprimir, que es tarde.
--
-- Se leen las dos formas: primero la que escribe el checkout, y las inglesas
-- como respaldo por si alguna orden vieja quedó con ese formato.
--
-- De paso, `p_carrier` ahora valida contra el vocabulario que ya fija el CHECK
-- de `deliveries.carrier`. Antes cualquier valor llegaba hasta el INSERT y
-- explotaba con un error de constraint que no dice nada útil.
--
-- Idempotente.

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
  v_carrier  text := COALESCE(NULLIF(btrim(p_carrier), ''), 'propio');
BEGIN
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  IF NOT public.has_org_role(v_order.org_id, auth.uid(), ARRAY['owner','admin','manager']) THEN
    RAISE EXCEPTION 'No tenés permiso para preparar envíos de esta tienda';
  END IF;

  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'La orden todavía no está paga';
  END IF;

  -- Mismo vocabulario que el CHECK de la tabla y que `src/lib/carriers.ts`.
  IF v_carrier NOT IN ('propio','oca','andreani','correo_arg','mercado_envios','otro') THEN
    RAISE EXCEPTION 'Transportista desconocido: %', v_carrier;
  END IF;

  SELECT id, tracking_code INTO v_id, v_code
  FROM public.deliveries WHERE ecommerce_order_id = p_order_id LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'tracking_code', v_code, 'existing', true);
  END IF;

  v_dir := COALESCE(v_order.shipping_address, '{}'::jsonb);

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
    -- El checkout escribe en español; el inglés queda de respaldo.
    COALESCE(NULLIF(v_dir->>'calle', ''),     NULLIF(v_dir->>'street', ''),   v_dir->>'address', ''),
    COALESCE(NULLIF(v_dir->>'ciudad', ''),    v_dir->>'city', ''),
    COALESCE(NULLIF(v_dir->>'provincia', ''), NULLIF(v_dir->>'province', ''), v_dir->>'state', ''),
    COALESCE(NULLIF(v_dir->>'cp', ''),        NULLIF(v_dir->>'zip', ''),      v_dir->>'postal_code', ''),
    COALESCE(NULLIF(v_dir->>'notas', ''),     NULLIF(v_dir->>'notes', '')),
    v_carrier,
    'pending', v_peso,
    0, true
  )
  RETURNING id INTO v_id;

  UPDATE public.ecommerce_orders
     SET fulfillment_status = 'processing'
   WHERE id = p_order_id AND fulfillment_status IN ('pending', 'unfulfilled');

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'tracking_code', v_code, 'existing', false);
END;
$$;

-- Mismo criterio de vocabulario al cargar el seguimiento.
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
  v_carrier  text := NULLIF(btrim(p_carrier), '');
BEGIN
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  IF NOT public.has_org_role(v_order.org_id, auth.uid(), ARRAY['owner','admin','manager']) THEN
    RAISE EXCEPTION 'No tenés permiso para editar envíos de esta tienda';
  END IF;
  IF v_tracking IS NULL THEN RAISE EXCEPTION 'Falta el número de seguimiento'; END IF;

  IF v_carrier IS NOT NULL
     AND v_carrier NOT IN ('propio','oca','andreani','correo_arg','mercado_envios','otro') THEN
    RAISE EXCEPTION 'Transportista desconocido: %', v_carrier;
  END IF;

  UPDATE public.deliveries
     SET carrier           = COALESCE(v_carrier, carrier),
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
