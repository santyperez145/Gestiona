-- ═══════════════════════════════════════════════════════════════════════════
-- Descuento por medio de pago
--
-- La tienda acepta MercadoPago, transferencia y efectivo, y los tres le salían
-- **lo mismo al comprador**. Al comercio no: una transferencia le cuesta 0% y
-- MercadoPago se lleva alrededor del 6%. Trasladar parte de esa diferencia es
-- lo que hace toda tienda argentina, y lo que Tiendanube y Empretienda traen de
-- fábrica.
--
-- No es cosmético: mueve ventas al carril barato, y cada venta que se va por
-- transferencia en vez de MercadoPago deja ~6% más de margen.
--
-- ── Dónde vive el número ──────────────────────────────────────────────────
--
-- Acá. `create_store_order` recalcula el total con el descuento incluido; el
-- checkout sólo lo muestra. Es la misma regla que ya rige para precios, stock,
-- cupones y envío: el cliente manda qué eligió, no cuánto sale.
--
-- El espejo en el navegador es `src/lib/paymentDiscount.ts`, con el mismo
-- redondeo (`round()` ↔ `Math.round`). Si se toca una cuenta, se toca la otra:
-- si divergen, el comprador ve un precio y se le cobra otro.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS payment_discounts jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.ecommerce_stores.payment_discounts IS
  'Descuento por medio de pago: {"transferencia": 10, "efectivo": 5}, en porcentaje. Sólo aplica a medios que estén además en payment_methods.';

-- ── El porcentaje válido para un medio ────────────────────────────────────
--
-- Una sola función para que el pedido, la vitrina y el panel lean lo mismo.
-- Devuelve 0 —y no el valor crudo— ante cualquier cosa rara: negativo, mayor al
-- tope, o no numérico. Un descuento inventado sale más caro que uno que no se
-- aplica. Espejo de `porcentajeDe` en paymentDiscount.ts.
CREATE OR REPLACE FUNCTION public.store_payment_discount_pct(
  p_descuentos jsonb,
  p_metodo     text
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v numeric;
BEGIN
  IF p_descuentos IS NULL OR p_metodo IS NULL THEN RETURN 0; END IF;
  BEGIN
    v := (p_descuentos ->> p_metodo)::numeric;
  EXCEPTION WHEN others THEN
    RETURN 0;   -- el JSON traía algo que no es un número
  END;
  IF v IS NULL OR v <= 0 THEN RETURN 0; END IF;
  RETURN LEAST(v, 90);   -- mismo tope que MAX_DESCUENTO_PORCENTAJE
END;
$$;

COMMENT ON FUNCTION public.store_payment_discount_pct IS
  'Porcentaje de descuento válido para un medio de pago, o 0. Espejo de porcentajeDe() en src/lib/paymentDiscount.ts — si se toca una, se toca la otra.';

-- ── La vitrina necesita saberlo para mostrarlo ────────────────────────────
DROP FUNCTION IF EXISTS public.get_store_by_slug(text);

CREATE OR REPLACE FUNCTION public.get_store_by_slug(p_slug text)
RETURNS TABLE (
  org_id           uuid,
  owner_user_id    uuid,
  name             text,
  description      text,
  slug             text,
  theme            text,
  primary_color    text,
  logo_url         text,
  banner_url       text,
  currency         text,
  payment_methods  text[],
  payment_discounts jsonb,
  shipping_cost    numeric,
  free_shipping_above numeric,
  shipping_mode    text,
  pickup_enabled   boolean,
  pickup_address   text,
  meta_title       text,
  meta_description text,
  social_links     jsonb,
  meta_pixel_id    text,
  ga_measurement_id text,
  tiktok_pixel_id  text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    s.org_id,
    (SELECT m.user_id FROM public.memberships m
      WHERE m.org_id = s.org_id AND m.role = 'owner'
      ORDER BY m.joined_at LIMIT 1) AS owner_user_id,
    s.name, s.description, s.slug, s.theme, s.primary_color,
    s.logo_url, s.banner_url, s.currency, s.payment_methods,
    COALESCE(s.payment_discounts, '{}'::jsonb),
    s.shipping_cost, s.free_shipping_above,
    COALESCE(s.shipping_mode, 'flat'), COALESCE(s.pickup_enabled, false), s.pickup_address,
    s.meta_title, s.meta_description, s.social_links,
    s.meta_pixel_id, s.ga_measurement_id, s.tiktok_pixel_id
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_store_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_by_slug(text) TO anon, authenticated;

-- ── El pedido: el descuento se aplica y se cobra acá ──────────────────────
--
-- Se parte de la definición vigente y se le intercalan tres cosas: leer
-- `payment_discounts`, calcular el descuento entre el cupón y el envío, y
-- sumarlo a `discount_amount`. **No se reescribió la función**: tiene
-- validaciones de nombre, email, carrito vacío y medio habilitado, resuelve
-- variantes con `resolve_store_line` y revalida el cupón contra usos y
-- vigencia. Reescribirla de memoria era la forma más fácil de perder una de
-- ésas sin que ningún test lo notara.
--
-- El orden de la cuenta, que es el que se lee naturalmente:
--
--   1. subtotal de productos, con los precios de la base
--   2. cupón sobre el subtotal
--   3. descuento por medio de pago sobre lo que queda de mercadería
--   4. envío, que se suma después y NO se descuenta
--
-- El envío gratis se sigue evaluando sobre el subtotal ANTES de los descuentos:
-- si no, un descuento podría hacer perder el beneficio y se siente como un
-- castigo por usarlo.

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
  v_desc_pago    numeric := 0;
  v_pct_pago     numeric := 0;
  v_base_pago    numeric;
  v_total        numeric;
  v_coupon_code  text := NULL;
  v_opt          record;
  v_province     text;
BEGIN
  SELECT s.id, s.org_id, s.name, s.shipping_cost, s.free_shipping_above,
         s.payment_methods, s.shipping_mode, s.pickup_enabled,
         COALESCE(s.payment_discounts, '{}'::jsonb) AS payment_discounts
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

  -- ── Descuento por medio de pago ─────────────────────────────────────────
  -- Sobre lo que queda de mercadería DESPUÉS del cupón: los dos se acumulan,
  -- que es como se lee "10% off pagando por transferencia". El envío queda
  -- afuera — descontarlo sería regalar plata que se le paga al correo.
  v_base_pago := GREATEST(0, v_subtotal - v_descuento);
  v_pct_pago  := public.store_payment_discount_pct(v_store.payment_discounts, p_payment_method);
  IF v_pct_pago > 0 THEN
    v_desc_pago := LEAST(round(v_base_pago * v_pct_pago / 100.0), round(v_base_pago));
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

  v_total := GREATEST(0, v_subtotal - v_descuento - v_desc_pago) + v_shipping;
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
    v_items, v_subtotal, v_shipping, v_descuento + v_desc_pago, 0,
    v_total,
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
    'total',          v_total,
    'subtotal',       v_subtotal,
    'discount',       v_descuento + v_desc_pago,
    'coupon_discount',      v_descuento,
    'payment_discount',     v_desc_pago,
    'payment_discount_pct', v_pct_pago,
    'shipping',       v_shipping,
    'shipping_label', v_opt.label
  );
END;
$function$;

COMMENT ON FUNCTION public.create_store_order IS
  'Crea el pedido recalculando TODO en la base: precios, stock, cupón, descuento por medio de pago y envío. El cliente manda qué eligió, nunca cuánto sale.';
