-- Cupones en el checkout de la tienda online.
--
-- La tabla `coupons` y su ABM existían desde antes (se usan en el POS y en los
-- códigos de influencers), pero la tienda no los aceptaba: el comprador no
-- tenía dónde escribirlos.
--
-- La validación es 100% del lado del servidor. Un cupón es plata: si el
-- descuento se calculara en el navegador, cualquiera se haría un 90% desde la
-- consola.
-- Idempotente.

-- ── Consulta pública de un cupón ──────────────────────────────────────────
-- Devuelve solo si es válido y cuánto descuenta. No expone el resto de los
-- cupones ni sus límites internos: alguien podría enumerarlos.
CREATE OR REPLACE FUNCTION public.check_store_coupon(
  p_slug     text,
  p_code     text,
  p_subtotal numeric
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_c        record;
  v_desc     numeric := 0;
BEGIN
  SELECT s.org_id INTO v_org
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug) AND s.is_active;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Tienda no encontrada');
  END IF;

  SELECT * INTO v_c
  FROM public.coupons
  WHERE org_id = v_org AND upper(code) = upper(btrim(p_code))
  LIMIT 1;

  IF v_c.id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón no existe');
  END IF;
  IF NOT v_c.active THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón ya no está activo');
  END IF;
  IF v_c.valid_from IS NOT NULL AND v_c.valid_from > now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón todavía no empezó');
  END IF;
  IF v_c.valid_until IS NOT NULL AND v_c.valid_until < now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón está vencido');
  END IF;
  IF v_c.max_uses IS NOT NULL AND v_c.current_uses >= v_c.max_uses THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón alcanzó su límite de usos');
  END IF;

  IF COALESCE(v_c.discount_percent, 0) > 0 THEN
    v_desc := round(p_subtotal * v_c.discount_percent / 100.0);
  ELSIF COALESCE(v_c.discount_fixed_ars, 0) > 0 THEN
    v_desc := LEAST(v_c.discount_fixed_ars, p_subtotal);
  END IF;

  IF v_desc <= 0 THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón no aplica a este pedido');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code', upper(v_c.code),
    'discount', v_desc,
    'percent', COALESCE(v_c.discount_percent, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_store_coupon(text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_store_coupon(text, text, numeric) TO anon, authenticated;

-- ── Alta de orden con cupón ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_store_order(
  p_slug           text,
  p_items          jsonb,
  p_customer_name  text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping       jsonb,
  p_payment_method text,
  p_notes          text DEFAULT NULL,
  p_coupon         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  v_coupon       record;
  v_descuento    numeric := 0;
  v_coupon_code  text := NULL;
BEGIN
  SELECT s.id, s.org_id, s.name, s.shipping_cost, s.free_shipping_above, s.payment_methods
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

    SELECT id, name, brand, stock, sale_price_ars, discount_price_ars, image_url
    INTO v_prod
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid AND org_id = v_store.org_id;

    IF v_prod.id IS NULL THEN RAISE EXCEPTION 'Un producto del carrito ya no está disponible'; END IF;
    IF v_prod.stock < v_qty THEN
      RAISE EXCEPTION 'Sin stock suficiente de %  (quedan %)', v_prod.name, v_prod.stock;
    END IF;

    v_unit := COALESCE(NULLIF(v_prod.discount_price_ars, 0), v_prod.sale_price_ars);
    v_subtotal := v_subtotal + v_unit * v_qty;

    v_items := v_items || jsonb_build_object(
      'product_id', v_prod.id, 'name', v_prod.name, 'brand', v_prod.brand,
      'quantity', v_qty, 'unit_price', v_unit, 'total', v_unit * v_qty,
      'image_url', v_prod.image_url
    );
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

  -- El envío gratis se evalúa sobre el subtotal ANTES del cupón: si no, un
  -- descuento podría hacer perder el beneficio y dar una sensación de castigo.
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
    coupon_code, payment_method, payment_status, fulfillment_status,
    shipping_address, billing_address, notes
  ) VALUES (
    v_store.org_id, v_store.id, v_customer_id, v_order_number,
    btrim(p_customer_name), lower(btrim(p_customer_email)), p_customer_phone,
    v_items, v_subtotal, v_shipping, v_descuento, 0,
    GREATEST(0, v_subtotal - v_descuento) + v_shipping,
    v_coupon_code, p_payment_method, 'pending', 'pending',
    COALESCE(p_shipping, '{}'::jsonb), COALESCE(p_shipping, '{}'::jsonb), p_notes
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
    'order_number', v_order_number,
    'total', GREATEST(0, v_subtotal - v_descuento) + v_shipping,
    'subtotal', v_subtotal,
    'discount', v_descuento,
    'shipping', v_shipping
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_store_order(text, jsonb, text, text, text, jsonb, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_store_order(text, jsonb, text, text, text, jsonb, text, text, text) TO anon, authenticated;
