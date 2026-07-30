-- La orden ahora entiende variantes.
--
-- El checkout mandaba sólo `product_id`, así que un pedido de "LATTAFA 50ML"
-- se cobraba al precio del padre y descontaba del stock agregado: el comercio
-- no sabía cuál de las variantes había vendido ni cuál reponer. La
-- organización ya tiene 26 variantes cargadas, todas invisibles para la tienda.
--
-- La resolución de cada línea (producto o variante, precio y stock) se
-- centraliza en `resolve_store_line`, para que el checkout y cualquier otro
-- camino futuro cobren igual.
-- Idempotente.

CREATE OR REPLACE FUNCTION public.create_store_order(p_slug text, p_items jsonb, p_customer_name text, p_customer_email text, p_customer_phone text, p_shipping jsonb, p_payment_method text, p_notes text DEFAULT NULL::text, p_coupon text DEFAULT NULL::text, p_shipping_option text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store        record;
  v_item         jsonb;
  v_prod         record;
  v_qty          int;
  v_unit         numeric;
  v_subtotal     numeric := 0;
  v_items        jsonb := '[]'::jsonb;
  v_shipping     numeric := 0;
  v_order_number text;
  v_order_id     uuid;
  v_customer_id  uuid;
  v_linea        jsonb;
  v_coupon       record;
  v_descuento    numeric := 0;
  v_coupon_code  text := NULL;
  v_opt          record;
  v_province     text;
BEGIN
  SELECT s.id, s.org_id, s.name, s.shipping_cost, s.free_shipping_above,
         s.payment_methods, s.shipping_mode, s.pickup_enabled
  INTO v_store
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug) AND s.is_active;

  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Tienda no encontrada o inactiva'; END IF;
  IF p_customer_name IS NULL OR btrim(p_customer_name) = '' THEN
    RAISE EXCEPTION 'El nombre es obligatorio';
  END IF;
  IF p_customer_email IS NULL OR p_customer_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'El email no es válido';
  END IF;
  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'El carrito está vacío';
  END IF;
  IF NOT (p_payment_method = ANY(v_store.payment_methods)) THEN
    RAISE EXCEPTION 'Medio de pago no habilitado en esta tienda';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM public.store_customers
    WHERE store_id = v_store.id AND user_id = auth.uid();
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));

    -- Resolver producto o variante en un solo lugar: el precio y el stock de
    -- una variante son propios, y hasta ahora se cobraba el del padre.
    v_linea := public.resolve_store_line(
      v_store.org_id,
      (v_item->>'product_id')::uuid,
      NULLIF(v_item->>'variant_id', '')::uuid,
      v_qty
    );

    IF NOT (v_linea->>'ok')::boolean THEN
      RAISE EXCEPTION '%', v_linea->>'error';
    END IF;

    v_subtotal := v_subtotal + (v_linea->'line'->>'total')::numeric;
    v_items    := v_items || (v_linea->'line');
  END LOOP;

  -- ── Cupón, revalidado acá ───────────────────────────────────────────────
  -- No alcanza con haberlo chequeado al escribirlo: entre eso y el checkout
  -- puede haberse agotado o vencido.
  IF p_coupon IS NOT NULL AND btrim(p_coupon) <> '' THEN
    SELECT * INTO v_coupon
    FROM public.coupons
    WHERE org_id = v_store.org_id AND upper(code) = upper(btrim(p_coupon))
      AND active
      AND (valid_from IS NULL OR valid_from <= now())
      AND (valid_until IS NULL OR valid_until >= now())
      AND (max_uses IS NULL OR current_uses < max_uses)
    LIMIT 1;

    IF v_coupon.id IS NULL THEN
      RAISE EXCEPTION 'El cupón ya no es válido';
    END IF;

    IF COALESCE(v_coupon.discount_percent, 0) > 0 THEN
      v_descuento := round(v_subtotal * v_coupon.discount_percent / 100.0);
    ELSIF COALESCE(v_coupon.discount_fixed_ars, 0) > 0 THEN
      v_descuento := LEAST(v_coupon.discount_fixed_ars, v_subtotal);
    END IF;

    v_coupon_code := upper(v_coupon.code);
    UPDATE public.coupons SET current_uses = current_uses + 1 WHERE id = v_coupon.id;
  END IF;

  -- ── Envío ───────────────────────────────────────────────────────────────
  -- El precio se RECALCULA acá: el cliente manda cuál opción eligió, no cuánto
  -- cuesta. El envío gratis se evalúa sobre el subtotal ANTES del cupón — si
  -- no, un descuento podría hacer perder el beneficio y eso se siente como un
  -- castigo por usar el cupón.
  v_province := COALESCE(p_shipping->>'provincia', p_shipping->>'province', '');

  SELECT q.option_id, q.carrier, q.service, q.label, q.price,
         q.days_min, q.days_max, q.zone_id
  INTO v_opt
  FROM public.quote_store_shipping(p_slug, v_province, p_shipping->>'cp', p_items) q
  WHERE p_shipping_option IS NULL OR q.option_id = p_shipping_option
  ORDER BY
    -- Si pidió una opción puntual, gana ésa; si no, la más barata
    (q.option_id = COALESCE(p_shipping_option, q.option_id)) DESC,
    q.price
  LIMIT 1;

  IF v_opt.option_id IS NULL THEN
    IF v_store.shipping_mode = 'zones' THEN
      RAISE EXCEPTION 'No hay envío disponible para esa provincia. Elegí otra opción de entrega.';
    END IF;
    -- Modos plano/gratis siempre devuelven una opción; si no hay, es sin costo
    v_shipping := 0;
  ELSE
    v_shipping := v_opt.price;
  END IF;

  v_order_number := public.next_store_order_number();

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, store_customer_id, order_number,
    customer_name, customer_email, customer_phone,
    items, subtotal, shipping_cost, discount_amount, tax_amount, total,
    coupon_code, payment_method, payment_status, fulfillment_status,
    shipping_address, billing_address, notes,
    carrier, shipping_service, shipping_label, shipping_zone_id,
    delivery_days_min, delivery_days_max, shipping_quoted_at
  ) VALUES (
    v_store.org_id, v_store.id, v_customer_id, v_order_number,
    btrim(p_customer_name), lower(btrim(p_customer_email)), p_customer_phone,
    v_items, v_subtotal, v_shipping, v_descuento, 0,
    GREATEST(0, v_subtotal - v_descuento) + v_shipping,
    v_coupon_code, p_payment_method, 'pending', 'pending',
    COALESCE(p_shipping, '{}'::jsonb), COALESCE(p_shipping, '{}'::jsonb), p_notes,
    v_opt.carrier, v_opt.service, v_opt.label, v_opt.zone_id,
    v_opt.days_min, v_opt.days_max, now()
  )
  RETURNING id INTO v_order_id;

  IF v_customer_id IS NOT NULL THEN
    UPDATE public.store_customers
    SET default_address = COALESCE(p_shipping, default_address),
        phone           = COALESCE(NULLIF(p_customer_phone, ''), phone),
        name            = COALESCE(NULLIF(btrim(p_customer_name), ''), name)
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object(
    'order_number',   v_order_number,
    'total',          GREATEST(0, v_subtotal - v_descuento) + v_shipping,
    'subtotal',       v_subtotal,
    'discount',       v_descuento,
    'shipping',       v_shipping,
    'shipping_label', v_opt.label
  );
END;
$function$

