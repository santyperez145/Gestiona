-- Promo "llevando 2" en la tienda online.
--
-- `price_2x_ars` existe desde hace tiempo: está en la tabla, en la vista
-- pública `store_catalog_products`, en el select de `publicDataSource.ts` y se
-- muestra en el catálogo por WhatsApp y en la página pública. **La tienda
-- online era la única superficie que lo ignoraba**, así que cobraba el precio
-- pleno por una promoción que el comercio ya tenía cargada y ya estaba
-- publicando en otro lado.
--
-- Medido contra la base:
--
--   LOST MARY DURA      — oferta 26.496 c/u, 2x 36.000 → en la tienda pagaba
--                         52.992 por dos. Ahorro real: 16.992.
--   ELFBAR ICE KING 40K — oferta 30.912 c/u, 2x 42.000 → pagaba 61.824.
--                         Ahorro real: 19.824.
--
-- Alguien que vio el catálogo por WhatsApp y entró a la tienda encontraba otro
-- precio. Eso no es sólo plata: es la clase de inconsistencia que hace dudar
-- del resto de los precios.
--
-- ── Por qué por producto y no por línea ──────────────────────────────────
--
-- Los dos productos tienen 9 y 10 sabores cargados como variantes. La compra
-- real es "dos vapers, uno de frutilla y otro de uva", que llegan al RPC como
-- **dos líneas de una unidad cada una**. Una regla que mirara `quantity >= 2`
-- por línea no habría disparado nunca, y el bug habría quedado escondido detrás
-- de una función que "ya lo contempla".
--
-- ── Dónde entra en la cuenta ─────────────────────────────────────────────
--
-- Como descuento, no bajando el subtotal: el subtotal guardado tiene que
-- seguir siendo la suma de los ítems o la orden no cierra contra su propio
-- detalle. Pero se resta **antes** del cupón, porque la promo es un precio y no
-- una rebaja — un 10% off sobre un precio que nadie paga sería regalar plata.
-- El descuento por medio de pago sigue yendo último, sobre lo que queda.
--
-- Idempotente.

-- ── El ahorro, en una función propia ────────────────────────────────────────
-- Separada de `create_store_order` para poder probarla sola y para que el
-- carrito pueda mostrar exactamente el número que se va a cobrar.
CREATE OR REPLACE FUNCTION public.store_promo_2x_discount(
  p_org_id uuid,
  p_items  jsonb
)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  WITH lineas AS (
    SELECT
      (it->>'product_id')::uuid                        AS product_id,
      GREATEST(COALESCE((it->>'quantity')::int, 0), 0) AS qty,
      COALESCE((it->>'unit_price')::numeric, 0)        AS unit_price
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS it
  ),
  por_producto AS (
    SELECT
      l.product_id,
      SUM(l.qty)                AS qty_total,
      SUM(l.qty * l.unit_price) AS total_normal,
      p.price_2x_ars
    FROM lineas l
    JOIN public.products p
      ON p.id = l.product_id AND p.org_id = p_org_id
    WHERE COALESCE(p.price_2x_ars, 0) > 0
    GROUP BY l.product_id, p.price_2x_ars
    HAVING SUM(l.qty) >= 2
  )
  SELECT COALESCE(SUM(
    GREATEST(0,
      -- Precio de referencia: lo que se está cobrando en promedio por unidad de
      -- ese producto. Con sabores que tengan `price_override` distinto, el par
      -- se valúa a lo que realmente cuestan y no al precio de lista.
      floor(pp.qty_total / 2) * (2 * (pp.total_normal / pp.qty_total) - pp.price_2x_ars)
    )
  ), 0)::numeric
  FROM por_producto pp;
$fn$;

REVOKE ALL ON FUNCTION public.store_promo_2x_discount(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_promo_2x_discount(uuid, jsonb) TO anon, authenticated;

COMMENT ON FUNCTION public.store_promo_2x_discount(uuid, jsonb) IS
  'Ahorro de la promo "llevando 2" (products.price_2x_ars) para un carrito ya '
  'resuelto. Agrupa por producto cruzando lineas, porque las variantes de sabor '
  'llegan como lineas separadas de una unidad. Nunca devuelve negativo: si la '
  'promo es peor que el precio vigente, no se aplica.';

-- ── create_store_order, con la promo aplicada ───────────────────────────────
-- El cuerpo es el que está en producción con los cambios insertados; no se
-- reescribió de memoria.
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
  v_promo_2x     numeric := 0;
  v_base_cupon   numeric;
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

  -- ── Promo "llevando 2" ──────────────────────────────────────────────────
  -- Se calcula por PRODUCTO cruzando todas sus líneas, no por línea: estos
  -- productos tienen 9 y 10 sabores, así que la compra real son dos variantes
  -- distintas y una regla por línea no dispararía nunca.
  --
  -- Va como descuento y no bajando `v_subtotal`, para que el subtotal guardado
  -- siga siendo la suma de los ítems. Pero se descuenta ANTES del cupón: la
  -- promo es un precio, no una rebaja, y un 10% off sobre un precio que nadie
  -- paga sería regalar plata.
  v_promo_2x   := public.store_promo_2x_discount(v_store.org_id, v_items);
  v_base_cupon := GREATEST(0, v_subtotal - v_promo_2x);

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
      v_descuento := round(v_base_cupon * v_coupon.discount_percent / 100.0);
    ELSIF COALESCE(v_coupon.discount_fixed_ars, 0) > 0 THEN
      v_descuento := LEAST(v_coupon.discount_fixed_ars, v_base_cupon);
    END IF;

    v_coupon_code := upper(v_coupon.code);
    UPDATE public.coupons SET current_uses = current_uses + 1 WHERE id = v_coupon.id;
  END IF;

  -- ── Descuento por medio de pago ─────────────────────────────────────────
  -- Sobre lo que queda de mercadería DESPUÉS del cupón: los dos se acumulan,
  -- que es como se lee "10% off pagando por transferencia". El envío queda
  -- afuera — descontarlo sería regalar plata que se le paga al correo.
  v_base_pago := GREATEST(0, v_subtotal - v_promo_2x - v_descuento);
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

  v_total := GREATEST(0, v_subtotal - v_promo_2x - v_descuento - v_desc_pago) + v_shipping;
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
    v_items, v_subtotal, v_shipping, v_promo_2x + v_descuento + v_desc_pago, 0,
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
    'discount',       v_promo_2x + v_descuento + v_desc_pago,
    'promo_2x',             v_promo_2x,
    'coupon_discount',      v_descuento,
    'payment_discount',     v_desc_pago,
    'payment_discount_pct', v_pct_pago,
    'shipping',       v_shipping,
    'shipping_label', v_opt.label
  );
END;
$function$
;
