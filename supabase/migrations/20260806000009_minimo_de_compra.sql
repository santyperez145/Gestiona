-- Las promociones con mínimo de compra dejan de aplicarse siempre.
--
-- `promotions.min_order_value` existe desde que se creó la tabla, se lee en el
-- `select` de `src/lib/promotions.ts`, y **no lo evaluaba nadie**: ni el POS ni
-- la tienda online. Verificado con grep sobre las cuatro superficies.
--
-- Efecto: una promoción de "20% off en compras mayores a $50.000" se aplicaba a
-- una compra de $1.000. Plata regalada en cada venta chica, en silencio, desde
-- que existe la tabla.
--
-- ── Por qué hacían falta dos pasadas ─────────────────────────────────────
--
-- El precio se resolvía línea por línea, y **una línea sola no sabe cuánto vale
-- la orden**. Es la misma estructura que usan Shopify y Tiendanube: un descuento
-- tiene *condiciones de orden* (mínimo de compra, primera compra, segmento) y
-- *efectos de línea* (porcentaje, monto). Se evalúa primero lo primero.
--
-- Entonces `create_store_order` arma el subtotal **sin promociones** en una
-- pasada previa, y recién con ese número resuelve los precios de verdad.
--
-- El subtotal de referencia es el de la mercadería sin promos, no el total: el
-- envío no cuenta para un mínimo de compra —sería regalar el descuento a quien
-- vive lejos— y contar el subtotal ya promocionado haría que aplicar la promo
-- desactive la promo.
--
-- ── El default protege al comercio ───────────────────────────────────────
--
-- `p_order_subtotal` es NULL por defecto, y con NULL se toman **sólo las
-- promociones sin mínimo**. Quien llame sin pasar el subtotal —una vista, el
-- catálogo— nunca va a aplicar de más. El error barato es no descontar; el caro
-- es descontar de más.
--
-- Idempotente.

-- ── store_promo_price, ahora con el mínimo ────────────────────────────────
CREATE OR REPLACE FUNCTION public.store_promo_price(
  p_org_id        uuid,
  p_product_id    uuid,
  p_category      text,
  p_list_price    numeric,
  p_order_subtotal numeric DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT MIN(precio)
  FROM (
    SELECT GREATEST(0, CASE
             WHEN pr.type = 'percentage'
               THEN round(p_list_price * (1 - pr.discount_value / 100.0))
             WHEN pr.type = 'fixed'
               THEN round(p_list_price - pr.discount_value)
           END) AS precio
    FROM public.promotions pr
    WHERE pr.org_id = p_org_id
      AND pr.status = 'active'
      AND pr.coupon_code IS NULL
      AND pr.type IN ('percentage', 'fixed')
      AND (pr.starts_at IS NULL OR pr.starts_at <= now())
      AND (pr.ends_at   IS NULL OR pr.ends_at   >  now())
      AND COALESCE(p_list_price, 0) > 0
      -- El mínimo de compra. Sin subtotal conocido sólo entran las que no
      -- tienen mínimo: no descontar es el error barato.
      AND COALESCE(pr.min_order_value, 0) <= COALESCE(p_order_subtotal, 0)
      AND (
        pr.applies_to = 'all'
        OR (pr.applies_to = 'products'   AND p_product_id = ANY(pr.product_ids))
        OR (pr.applies_to = 'categories' AND p_category IS NOT NULL
                                         AND p_category = ANY(pr.category_names))
      )
  ) x;
$fn$;

REVOKE ALL ON FUNCTION public.store_promo_price(uuid, uuid, text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_promo_price(uuid, uuid, text, numeric, numeric) TO anon, authenticated;


-- ── La vista pasa a la firma nueva ────────────────────────────────────────
--
-- Se le pasa NULL a propósito: en el catálogo **no se sabe cuánto va a valer la
-- orden**, así que sólo se muestran las promociones sin mínimo. Anunciar en la
-- tarjeta un precio que depende de gastar $50.000 sería prometer algo que el
-- comprador puede no alcanzar, y el precio del checkout lo desmentiría.
CREATE OR REPLACE VIEW public.store_catalog_products AS
 SELECT p.id,
    p.org_id,
    p.user_id,
    p.name,
    p.brand,
    p.category,
    p.gender,
    p.description,
    p.image_url,
    p.image_urls,
    p.sale_price_ars,
    p.discount_price_ars,
    p.price_2x_ars,
    p.stock,
    p.content_ml,
    p.total_sold,
    p.featured,
    p.offer_expires_at,
    p.created_at,
        CASE
            WHEN COALESCE(p.content_ml, 0) > 0 THEN round(COALESCE(p.total_cost_usd, p.cost_usd, 0::numeric) / p.content_ml::numeric * 10::numeric * COALESCE(s.exchange_rate, 0::numeric) * (1::numeric + COALESCE(s.decant_margin_10ml, 250::numeric) / 100.0))
            ELSE NULL::numeric
        END AS decant_price_10ml,
        CASE
            WHEN COALESCE(p.content_ml, 0) > 0 THEN round(COALESCE(p.total_cost_usd, p.cost_usd, 0::numeric) / p.content_ml::numeric * 5::numeric * COALESCE(s.exchange_rate, 0::numeric) * (1::numeric + COALESCE(s.decant_margin_5ml, 350::numeric) / 100.0))
            ELSE NULL::numeric
        END AS decant_price_5ml,
        CASE
            WHEN COALESCE(p.content_ml, 0) > 0 THEN round(COALESCE(p.total_cost_usd, p.cost_usd, 0::numeric) / p.content_ml::numeric * 2.5 * COALESCE(s.exchange_rate, 0::numeric) * (1::numeric + COALESCE(s.decant_margin_2_5ml, 500::numeric) / 100.0))
            ELSE NULL::numeric
        END AS decant_price_2_5ml,
        CASE
            WHEN COALESCE(p.offer_stacks_payment, es.payment_discount_stacks, false) THEN COALESCE(NULLIF(p.discount_price_ars, 0::numeric), p.sale_price_ars)
            ELSE p.sale_price_ars
        END AS payment_base_price,
    store_promo_price(p.org_id, p.id, p.category, p.sale_price_ars, NULL::numeric) AS promo_price
   FROM products p
     LEFT JOIN settings s ON s.org_id = p.org_id
     LEFT JOIN ecommerce_stores es ON es.org_id = p.org_id
  WHERE COALESCE(p.sale_price_ars, 0::numeric) > 0::numeric AND COALESCE(p.is_active, true) = true;

-- La firma vieja de 4 argumentos queda huérfana: la vista y cualquier llamada
-- pasan por la nueva, que tiene el quinto con default.
DROP FUNCTION IF EXISTS public.store_promo_price(uuid, uuid, text, numeric);

CREATE OR REPLACE FUNCTION public.resolve_store_line(p_org_id uuid, p_product_id uuid, p_variant_id uuid, p_qty integer, p_order_subtotal numeric DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prod record;
  v_var  record;
  v_unit numeric;
  v_acumula boolean;
  v_promo numeric;
BEGIN
  SELECT id, name, brand, category, stock, sale_price_ars, discount_price_ars, image_url,
         offer_stacks_payment
  INTO v_prod
  FROM public.products
  WHERE id = p_product_id AND org_id = p_org_id;

  IF v_prod.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Un producto del carrito ya no está disponible');
  END IF;

  -- Precio base del producto: el de oferta si lo hay.
  v_unit := COALESCE(NULLIF(v_prod.discount_price_ars, 0), v_prod.sale_price_ars);

  -- Promociones auto-aplicables (las que no tienen cupón). Compiten contra el
  -- precio vigente y ganan sólo si son mejores: es la misma regla que el resto
  -- de los precios de esta base — **el mejor, nunca la suma**.
  --
  -- Se resuelve acá, en el precio de la línea, y no como un descuento aparte:
  -- una promoción *es* un precio, así que todo lo que viene después —volumen,
  -- cupón, medio de pago— trabaja sobre el número correcto sin saber que hubo
  -- una promo.
  -- `p_order_subtotal` es el subtotal de la mercadería SIN promociones, que es
  -- contra lo que se evalúa `min_order_value`. Viene de una primera pasada:
  -- una promoción con mínimo no se puede resolver mirando una línea sola.
  --
  -- Con NULL se toman sólo las que no tienen mínimo. Es el default a propósito:
  -- quien llame sin pasar el subtotal —el catálogo, una vista— nunca va a
  -- aplicar de más.
  v_promo := public.store_promo_price(
    p_org_id, v_prod.id, v_prod.category, v_prod.sale_price_ars, p_order_subtotal);
  IF v_promo IS NOT NULL AND v_promo < v_unit THEN
    v_unit := v_promo;
  END IF;

  -- ¿El descuento por medio de pago se suma a esta oferta?
  --
  -- Lo decide el producto; si no dice nada, la política de la organización. No
  -- se puede deducir del precio: un 20% off puede ser "este es el precio con
  -- transferencia" o una liquidación real sobre la que el 20% de transferencia
  -- todavía corresponde. Son la misma columna y significan cosas distintas.
  v_acumula := COALESCE(
    v_prod.offer_stacks_payment,
    (SELECT s.payment_discount_stacks FROM public.ecommerce_stores s
      WHERE s.org_id = p_org_id ORDER BY s.created_at LIMIT 1),
    false
  );

  IF p_variant_id IS NULL THEN
    IF v_prod.stock < p_qty THEN
      RETURN jsonb_build_object('ok', false,
        'error', format('Sin stock suficiente de %s (quedan %s)', v_prod.name, v_prod.stock));
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'line', jsonb_build_object(
        'product_id', v_prod.id, 'variant_id', NULL,
        'name', v_prod.name, 'brand', v_prod.brand,
        'quantity', p_qty, 'unit_price', v_unit,
        -- Base sobre la que se calcula el descuento por medio de pago. Con la
        -- oferta acumulable es el precio de oferta —el descuento se suma
        -- encima—; si no, el de lista, y entonces la oferta ya lo contenía.
        'list_price', CASE WHEN v_acumula THEN v_unit ELSE v_prod.sale_price_ars END,
        'total', v_unit * p_qty, 'image_url', v_prod.image_url));
  END IF;

  SELECT id, variant_name, stock, price_override, image_url
  INTO v_var
  FROM public.product_variants
  WHERE id = p_variant_id AND product_id = p_product_id AND org_id = p_org_id AND active;

  IF v_var.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esa variante ya no está disponible');
  END IF;
  IF v_var.stock < p_qty THEN
    RETURN jsonb_build_object('ok', false,
      'error', format('Sin stock suficiente de %s %s (quedan %s)',
                      v_prod.name, v_var.variant_name, v_var.stock));
  END IF;

  -- `price_override` pisa el precio del padre cuando está cargado.
  IF COALESCE(v_var.price_override, 0) > 0 THEN
    v_unit := v_var.price_override;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'line', jsonb_build_object(
      'product_id', v_prod.id, 'variant_id', v_var.id,
      'name', v_prod.name || ' — ' || v_var.variant_name,
      'brand', v_prod.brand,
      'quantity', p_qty, 'unit_price', v_unit,
      -- Con `price_override` la variante tiene precio propio y ése es su base.
      'list_price', CASE
        WHEN COALESCE(v_var.price_override, 0) > 0 THEN v_var.price_override
        WHEN v_acumula                             THEN v_unit
        ELSE v_prod.sale_price_ars END,
      'total', v_unit * p_qty,
      'image_url', COALESCE(v_var.image_url, v_prod.image_url)));
END;
$function$
;

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
  v_subtotal_base numeric := 0;
  v_item_b       jsonb;
  v_linea_b      jsonb;
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

  -- ── Primera pasada: el subtotal SIN promociones ─────────────────────────
  --
  -- Hace falta para poder evaluar `min_order_value`: una promo de "20% off en
  -- compras mayores a $50.000" no se puede decidir mirando una línea sola. Es
  -- como lo resuelve cualquier plataforma seria — primero las condiciones de
  -- orden, después los efectos de línea.
  --
  -- No valida stock ni corta: de eso se encarga la pasada real de abajo. Acá
  -- sólo se suma, y una línea que no resuelve se ignora porque igual va a
  -- hacer fallar la segunda.
  FOR v_item_b IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_linea_b := public.resolve_store_line(
      v_store.org_id,
      (v_item_b->>'product_id')::uuid,
      NULLIF(v_item_b->>'variant_id', '')::uuid,
      GREATEST(1, COALESCE((v_item_b->>'quantity')::int, 1))
    );
    IF (v_linea_b->>'ok')::boolean THEN
      v_subtotal_base := v_subtotal_base + (v_linea_b->'line'->>'total')::numeric;
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));

    -- Resolver producto o variante en un solo lugar: el precio y el stock de
    -- una variante son propios, y hasta ahora se cobraba el del padre.
    v_linea := public.resolve_store_line(
      v_store.org_id,
      (v_item->>'product_id')::uuid,
      NULLIF(v_item->>'variant_id', '')::uuid,
      v_qty,
      v_subtotal_base
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
  v_promo_2x   := public.store_volume_discount(v_store.org_id, v_items);
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
  v_pct_pago := public.store_payment_discount_pct(v_store.payment_discounts, p_payment_method);

  -- **Los dos descuentos NO se acumulan: se cobra el mejor, nunca la suma.**
  --
  -- Antes el porcentaje del medio de pago se aplicaba sobre el subtotal, que ya
  -- venía con el precio de oferta: un producto con 20% off pagado por
  -- transferencia con 20% terminaba con 36% de descuento. El comprador veía un
  -- precio de lista tachado que no correspondía a nada.
  --
  -- Ahora se calcula por línea contra el precio de LISTA: el descuento del medio
  -- de pago es lo que falta para llegar a `lista × (1 - pct)`, y si la oferta ya
  -- deja el precio por debajo de eso, no descuenta nada más. Así una oferta del
  -- 30% con transferencia del 20% sigue cobrando el 30% —no se le rompe la
  -- promesa al comprador— y una del 10% con transferencia del 20% llega al 20%.
  IF v_pct_pago > 0 THEN
    SELECT COALESCE(SUM(
      GREATEST(0,
        (it->>'unit_price')::numeric
        - round(COALESCE((it->>'list_price')::numeric, (it->>'unit_price')::numeric)
                * (100 - v_pct_pago) / 100.0)
      ) * GREATEST(COALESCE((it->>'quantity')::int, 1), 0)
    ), 0)
    INTO v_desc_pago
    FROM jsonb_array_elements(v_items) AS it;

    -- Nunca más que la mercadería que queda después de promo y cupón.
    v_desc_pago := LEAST(
      round(v_desc_pago),
      GREATEST(0, round(v_subtotal - v_promo_2x - v_descuento))
    );
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

-- ⚠️  con un parámetro nuevo **no reemplaza: crea una
-- sobrecarga**. Sin este DROP quedan dos  conviviendo, y la
-- de cuatro argumentos —que no conoce el mínimo de compra— sigue siendo la que
-- gana ante cualquier llamada con cuatro. Un descuento que se aplica o no según
-- cuál de las dos resolvió Postgres es el peor de los bugs posibles acá.
DROP FUNCTION IF EXISTS public.resolve_store_line(uuid, uuid, uuid, integer);
