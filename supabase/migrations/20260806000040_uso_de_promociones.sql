-- A7 — las promociones registran su uso.
--
-- `promotion_usages` existe desde que se creó `promotions`, con su trigger que
-- incrementa `uses_count`, y **create_store_order no insertaba nada**
-- (verificado: cero menciones). El comercio veía cuántas veces se usó una
-- promoción sólo si venía del POS; de la tienda online, nunca.
--
-- Sin eso no se puede contestar la única pregunta que importa de una promoción:
-- **¿sirvió?**
--
-- ── Qué se guarda ────────────────────────────────────────────────────────
--
-- El ahorro atribuible a la promoción, no el descuento total de la orden. El
-- cupón y el descuento por medio de pago tienen su propio registro, y mezclarlos
-- haría que la métrica de una promo dependa de cómo pagó el comprador — dos
-- ventas idénticas con distinto medio de pago mostrarían promociones distintas.
--
-- Cuando aplica más de una promoción a la misma orden el ahorro se prorratea.
-- No es exacto —habría que atribuir por línea— pero es honesto y suma el total
-- correcto, que es lo que el comercio compara contra la facturación.
--
-- ── Por qué en un bloque que no puede fallar ─────────────────────────────
--
-- El INSERT va dentro de un `BEGIN ... EXCEPTION WHEN OTHERS THEN NULL`, y
-- **después** de crear la orden. Una métrica rota nunca puede impedir una venta,
-- y un uso registrado de una orden que falló sería peor que no registrarlo.
--
-- Regenerada desde la definición que corre en producción. Idempotente.

CREATE OR REPLACE FUNCTION public.create_store_order(p_slug text, p_items jsonb, p_customer_name text, p_customer_email text, p_customer_phone text, p_shipping jsonb, p_payment_method text, p_notes text DEFAULT NULL::text, p_coupon text DEFAULT NULL::text, p_shipping_option text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store        record;
  v_item         jsonb;
  v_qty          int;
  v_subtotal     numeric := 0;
  v_items        jsonb := '[]'::jsonb;
  v_shipping     numeric := 0;   -- cotización del correo, antes del cupón
  v_envio_neto   numeric := 0;   -- lo que paga el comprador
  v_bonif_envio  numeric := 0;   -- lo que absorbe el comercio
  v_order_number text;
  v_order_id     uuid;
  v_customer_id  uuid;
  v_linea        jsonb;
  v_cupon_chk    jsonb;
  v_coupon_id    uuid;
  v_descuento    numeric := 0;
  v_promo_2x     numeric := 0;
  v_subtotal_base numeric := 0;
  v_promo_ahorro numeric := 0;
  v_item_b       jsonb;
  v_linea_b      jsonb;
  v_base_cupon   numeric;
  v_desc_pago    numeric := 0;
  v_pct_pago     numeric := 0;
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
    -- Lo que la promoción bajó respecto de lo que se habría cobrado sin ella.
    -- `list_price` es el precio de lista de la línea, así que la diferencia
    -- incluye la oferta manual; se descuenta abajo para aislar la promo.
    v_promo_ahorro := v_promo_ahorro + GREATEST(0,
      COALESCE((v_linea->'line'->>'list_price')::numeric, 0)
        * GREATEST(COALESCE((v_linea->'line'->>'quantity')::int, 1), 0)
      - (v_linea->'line'->>'total')::numeric);
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

  -- ── Envío ───────────────────────────────────────────────────────────────
  -- El precio se RECALCULA acá: el cliente manda cuál opción eligió, no cuánto
  -- cuesta. El envío gratis por umbral se evalúa sobre el subtotal ANTES del
  -- cupón — si no, un descuento podría hacer perder el beneficio y eso se
  -- siente como un castigo por usar el cupón.
  --
  -- A5: va antes del cupón porque ahora el cupón puede bonificarlo, y para
  -- saber si un cupón de envío gratis hace algo hay que saber cuánto vale el
  -- envío.
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

  v_envio_neto := v_shipping;

  -- ── Cupón, revalidado acá ───────────────────────────────────────────────
  --
  -- No alcanza con haberlo chequeado al escribirlo: entre eso y el checkout
  -- puede haberse agotado o vencido.
  --
  -- ⚠️ Se llama a `check_store_coupon` en vez de repetir la validación. Antes
  -- había un SELECT propio que sólo miraba vigencia y tope global, así que el
  -- mínimo de compra y el límite por persona de A4 valían únicamente para
  -- quien pasara por el checkout. Este RPC es público: una llamada directa los
  -- salteaba.
  IF p_coupon IS NOT NULL AND btrim(p_coupon) <> '' THEN
    v_cupon_chk := public.check_store_coupon(
      p_slug, p_coupon, v_base_cupon, p_customer_email, v_shipping);

    IF NOT COALESCE((v_cupon_chk->>'valid')::boolean, false) THEN
      -- El motivo bueno, no un genérico: "Te faltan $38.000" le dice al
      -- comprador qué hacer.
      RAISE EXCEPTION '%', COALESCE(v_cupon_chk->>'reason', 'El cupón ya no es válido');
    END IF;

    v_descuento   := COALESCE((v_cupon_chk->>'discount')::numeric, 0);
    v_bonif_envio := LEAST(
      COALESCE((v_cupon_chk->>'shipping_discount')::numeric, 0),
      v_shipping);
    v_envio_neto  := v_shipping - v_bonif_envio;
    v_coupon_code := v_cupon_chk->>'code';

    SELECT id INTO v_coupon_id FROM public.coupons
     WHERE org_id = v_store.org_id AND upper(code) = v_coupon_code LIMIT 1;

    -- Recién acá se consume: si algo de arriba hubiera fallado, el cupón
    -- seguiría disponible.
    UPDATE public.coupons SET current_uses = COALESCE(current_uses, 0) + 1
     WHERE id = v_coupon_id;
  END IF;

  -- ── Descuento por medio de pago ─────────────────────────────────────────
  -- Sobre lo que queda de mercadería DESPUÉS del cupón. El envío queda afuera
  -- — descontarlo sería regalar plata que se le paga al correo.
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
  -- deja el precio por debajo de eso, no descuenta nada más.
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

  v_total := GREATEST(0, v_subtotal - v_promo_2x - v_descuento - v_desc_pago) + v_envio_neto;
  v_order_number := public.next_store_order_number();

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, store_customer_id, order_number,
    customer_name, customer_email, customer_phone,
    items, subtotal, shipping_cost, discount_amount, tax_amount, total,
    coupon_code, coupon_discount_ars, shipping_discount_ars,
    payment_method, payment_status, fulfillment_status,
    shipping_address, billing_address, notes,
    carrier, shipping_service, shipping_label, shipping_zone_id,
    delivery_days_min, delivery_days_max, shipping_quoted_at
  ) VALUES (
    v_store.org_id, v_store.id, v_customer_id, v_order_number,
    btrim(p_customer_name), lower(btrim(p_customer_email)), p_customer_phone,
    v_items, v_subtotal, v_envio_neto, v_promo_2x + v_descuento + v_desc_pago, 0,
    v_total,
    v_coupon_code, v_descuento, v_bonif_envio,
    p_payment_method, 'pending', 'pending',
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

  -- ── Registrar el uso de las promociones ────────────────────────────────
  --
  -- `promotion_usages` existía con su trigger de conteo y nadie insertaba nada,
  -- así que el comercio no podía saber si una promoción sirvió. Se registra
  -- **después** de crear la orden: si la orden falla, no queda un uso fantasma.
  --
  -- El ahorro que se guarda es el de la promoción sobre el precio que se habría
  -- cobrado sin ella, prorrateado por promoción cuando aplica más de una. No se
  -- reparte el cupón ni el descuento por medio de pago: esos tienen su propio
  -- registro y mezclarlos haría que la métrica de una promo dependa de cómo
  -- pagó el comprador.
  --
  -- Va en un bloque que no puede tumbar la orden: una métrica rota nunca puede
  -- impedir una venta.
  BEGIN
    INSERT INTO public.promotion_usages (
      promotion_id, org_id, customer_id, customer_name, order_value, discount_applied
    )
    SELECT pr.id, v_store.org_id, v_customer_id, btrim(p_customer_name),
           v_subtotal, v_promo_ahorro / GREATEST(1, count(*) OVER ())
    FROM public.promotions pr
    WHERE pr.org_id = v_store.org_id
      AND pr.status = 'active'
      AND pr.coupon_code IS NULL
      AND pr.type IN ('percentage', 'fixed')
      AND (pr.starts_at IS NULL OR pr.starts_at <= now())
      AND (pr.ends_at   IS NULL OR pr.ends_at   >  now())
      AND COALESCE(pr.min_order_value, 0) <= v_subtotal_base
      AND v_promo_ahorro > 0;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'order_number',   v_order_number,
    'total',          v_total,
    'subtotal',       v_subtotal,
    'discount',       v_promo_2x + v_descuento + v_desc_pago,
    'promo_2x',             v_promo_2x,
    'coupon_discount',      v_descuento,
    'payment_discount',     v_desc_pago,
    'payment_discount_pct', v_pct_pago,
    'shipping',       v_envio_neto,
    'shipping_gross',   v_shipping,
    'shipping_discount', v_bonif_envio,
    'shipping_label', v_opt.label
  );
END;
$function$
;
