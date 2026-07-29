-- `create_store_order` ahora vincula el pedido a la cuenta del comprador si
-- inició sesión, y guarda su dirección para precargar la próxima compra.
--
-- Sigue funcionando igual para invitados: comprar sin cuenta no debe requerir
-- registrarse, que es la principal causa de carritos abandonados.
-- Idempotente (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.create_store_order(
  p_slug           text,
  p_items          jsonb,
  p_customer_name  text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping       jsonb,
  p_payment_method text,
  p_notes          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  SELECT s.id, s.org_id, s.name, s.shipping_cost, s.free_shipping_above, s.payment_methods
  INTO v_store
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug) AND s.is_active;

  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada o inactiva';
  END IF;

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

  -- Cuenta del comprador, si compró logueado. Es opcional a propósito.
  IF auth.uid() IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM public.store_customers
    WHERE store_id = v_store.id AND user_id = auth.uid();
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));

    SELECT id, name, brand, stock, sale_price_ars, discount_price_ars, image_url
    INTO v_prod
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid AND org_id = v_store.org_id;

    IF v_prod.id IS NULL THEN
      RAISE EXCEPTION 'Un producto del carrito ya no está disponible';
    END IF;
    IF v_prod.stock < v_qty THEN
      RAISE EXCEPTION 'Sin stock suficiente de %  (quedan %)', v_prod.name, v_prod.stock;
    END IF;

    -- Precio autoritativo del servidor: nunca el que manda el navegador.
    v_unit := COALESCE(NULLIF(v_prod.discount_price_ars, 0), v_prod.sale_price_ars);
    v_subtotal := v_subtotal + v_unit * v_qty;

    v_items := v_items || jsonb_build_object(
      'product_id', v_prod.id, 'name', v_prod.name, 'brand', v_prod.brand,
      'quantity', v_qty, 'unit_price', v_unit, 'total', v_unit * v_qty,
      'image_url', v_prod.image_url
    );
  END LOOP;

  v_shipping := COALESCE(v_store.shipping_cost, 0);
  IF v_store.free_shipping_above IS NOT NULL
     AND v_store.free_shipping_above > 0
     AND v_subtotal >= v_store.free_shipping_above THEN
    v_shipping := 0;
  END IF;

  v_order_number := 'TN-' || to_char(now(), 'YYYYMMDD') || '-' ||
                    lpad((floor(random() * 10000))::text, 4, '0');

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, store_customer_id, order_number,
    customer_name, customer_email, customer_phone,
    items, subtotal, shipping_cost, discount_amount, tax_amount, total,
    payment_method, payment_status, fulfillment_status,
    shipping_address, billing_address, notes
  ) VALUES (
    v_store.org_id, v_store.id, v_customer_id, v_order_number,
    btrim(p_customer_name), lower(btrim(p_customer_email)), p_customer_phone,
    v_items, v_subtotal, v_shipping, 0, 0, v_subtotal + v_shipping,
    p_payment_method, 'pending', 'pending',
    COALESCE(p_shipping, '{}'::jsonb), COALESCE(p_shipping, '{}'::jsonb), p_notes
  )
  RETURNING id INTO v_order_id;

  -- Se recuerda la dirección para precargar el próximo checkout.
  IF v_customer_id IS NOT NULL THEN
    UPDATE public.store_customers
    SET default_address = COALESCE(p_shipping, default_address),
        phone           = COALESCE(NULLIF(p_customer_phone, ''), phone),
        name            = COALESCE(NULLIF(btrim(p_customer_name), ''), name)
    WHERE id = v_customer_id;
  END IF;

  -- El stock se descuenta al confirmar el pago, no acá: reservarlo antes
  -- dejaría productos bloqueados por carritos abandonados.

  RETURN jsonb_build_object(
    'order_number', v_order_number,
    'total', v_subtotal + v_shipping,
    'subtotal', v_subtotal,
    'shipping', v_shipping
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_store_order(text, jsonb, text, text, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_store_order(text, jsonb, text, text, text, jsonb, text, text) TO anon, authenticated;
