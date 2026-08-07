-- ═══════════════════════════════════════════════════════════════════════════
-- A5 — Cupón de envío gratis
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `promotions.type` contemplaba `free_shipping` desde 20260523000016 y no se
-- aplicaba en ningún lado. Es el cupón más usado del comercio argentino: el
-- envío es de las primeras razones por las que se abandona un carrito, y
-- bonificarlo mueve la aguja más que un 10% off.
--
-- ── Dónde se descuenta ────────────────────────────────────────────────────
--
-- Del propio envío, no del subtotal. Son plata distinta: el descuento de
-- mercadería sale del margen, la bonificación de envío es plata que igual hay
-- que pagarle al correo. Mezclarlas en `discount_amount` dejaría al comercio
-- sin saber cuál de las dos le costó la venta, y además correría la base del
-- IVA — que es lo que el comprador paga.
--
-- Por eso `shipping_cost` guarda lo que el comprador paga (0 si se bonificó
-- entero) y `shipping_discount_ars` lo que absorbió el comercio. La suma de
-- los dos es la cotización real del correo, así que no se pierde nada.
--
-- ── El tope ───────────────────────────────────────────────────────────────
--
-- Un "envío gratis" sin tope a Tierra del Fuego puede costar más que la venta.
-- `free_shipping_max_ars` bonifica hasta ese monto y el resto lo paga el
-- comprador — es como lo hace MercadoLibre. Vacío = se bonifica todo.
--
-- ── Un cupón que no hace nada no se acepta ────────────────────────────────
--
-- Si el comprador eligió retiro en tienda, o ya superó el umbral de envío
-- gratis de la tienda, un cupón de envío no descuenta nada. Aceptarlo lo
-- consumiría a cambio de cero y después no lo podría usar. Se rechaza con el
-- motivo, así el comprador lo guarda para la próxima.
--
-- ── ⚠️ Un agujero de A4 que se cierra acá ─────────────────────────────────
--
-- `create_store_order` revalidaba el cupón con un SELECT propio que miraba
-- vigencia y tope global, y **no** el mínimo de compra ni el límite por
-- persona que agregó A4. El checkout los respetaba, pero el checkout no es la
-- autoridad: `create_store_order` es público para `anon`, así que una llamada
-- directa aplicaba un cupón de "mínimo $50.000" a una compra de $12.000.
--
-- La regla queda en un solo lugar: `create_store_order` llama a
-- `check_store_coupon` con los números reales y usa su veredicto. De paso el
-- comprador recibe el motivo bueno ("Te faltan $38.000") en vez de un genérico
-- "El cupón ya no es válido".
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Las dos condiciones nuevas del cupón ────────────────────────────────

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS free_shipping boolean NOT NULL DEFAULT false;

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS free_shipping_max_ars numeric;

ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_free_shipping_max_positivo;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_free_shipping_max_positivo
  CHECK (free_shipping_max_ars IS NULL OR free_shipping_max_ars > 0);

COMMENT ON COLUMN public.coupons.free_shipping IS
  'A5: el cupón bonifica el envío. Puede combinarse con descuento de mercadería.';
COMMENT ON COLUMN public.coupons.free_shipping_max_ars IS
  'Hasta cuánto se bonifica el envío. NULL = el envío completo.';

-- ── 2. Cómo queda anotado en la orden ──────────────────────────────────────
--
-- `shipping_cost` sigue siendo lo que paga el comprador. Estas dos columnas
-- son el desglose de lo que costó el cupón, que hasta ahora no se podía saber:
-- `discount_amount` mezcla la promo "llevando 2", el cupón y el descuento por
-- medio de pago.

ALTER TABLE public.ecommerce_orders
  ADD COLUMN IF NOT EXISTS shipping_discount_ars numeric NOT NULL DEFAULT 0;

ALTER TABLE public.ecommerce_orders
  ADD COLUMN IF NOT EXISTS coupon_discount_ars numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ecommerce_orders.shipping_discount_ars IS
  'A5: envío bonificado por cupón. Lo absorbe el comercio; sumado a shipping_cost da la cotización real.';
COMMENT ON COLUMN public.ecommerce_orders.coupon_discount_ars IS
  'A5: lo que descontó el cupón de mercadería. discount_amount incluye además promo y medio de pago.';

ALTER TABLE public.coupon_usages
  ADD COLUMN IF NOT EXISTS shipping_discount_ars numeric NOT NULL DEFAULT 0;

-- ── 3. La validación, con el envío a la vista ──────────────────────────────
--
-- ⚠️ Se dropea la firma anterior antes de crear la nueva. Agregar un parámetro
-- crea una SOBRECARGA, no un reemplazo, y con las dos vivas una llamada vieja
-- podía caer en la versión sin las validaciones nuevas. Ya pasó con
-- `record_stock_movement` y con esta misma función en A4.

DROP FUNCTION IF EXISTS public.check_store_coupon(text, text, numeric, text);

CREATE OR REPLACE FUNCTION public.check_store_coupon(
  p_slug     text,
  p_code     text,
  p_subtotal numeric,
  p_email    text DEFAULT NULL,
  p_shipping numeric DEFAULT NULL   -- NULL = todavía no se cotizó el envío
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_org   uuid;
  v_c     record;
  v_desc  numeric := 0;
  v_bonif numeric := 0;
  v_usos  int := 0;
BEGIN
  SELECT s.org_id INTO v_org FROM public.ecommerce_stores s
   WHERE lower(s.slug) = lower(p_slug) AND s.is_active;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Tienda no encontrada');
  END IF;

  SELECT * INTO v_c FROM public.coupons
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

  -- El mínimo va PRIMERO: es lo único que el comprador puede resolver
  -- agregando productos. Decirle "alcanzaste el límite" a quien además no llega
  -- al mínimo lo manda a un callejón sin salida.
  --
  -- Se mide sobre la mercadería y NO sobre el total con envío: si no, un cupón
  -- de "mínimo $50.000" se activaría con $38.000 de productos más $12.000 de
  -- flete, y el comercio estaría subsidiando el envío para llegar a su piso.
  IF COALESCE(v_c.min_order_value, 0) > 0
     AND COALESCE(p_subtotal, 0) < v_c.min_order_value THEN
    RETURN jsonb_build_object(
      'valid', false,
      -- El separador de miles va con punto. `to_char` usa el del locale de la
      -- base, que devuelve coma: al comprador le llegaba "Te faltan $40,000",
      -- que en Argentina se lee como cuarenta pesos con cero centavos.
      'reason', format('Te faltan $%s para poder usar este cupón',
                       replace(to_char(v_c.min_order_value - COALESCE(p_subtotal, 0),
                                       'FM999G999G999'), ',', '.')),
      'min_order_value', v_c.min_order_value,
      'faltan', v_c.min_order_value - COALESCE(p_subtotal, 0));
  END IF;

  IF v_c.max_uses_per_customer IS NOT NULL AND v_c.max_uses_per_customer > 0 THEN
    -- Sin email no se puede evaluar el límite. Se rechaza en vez de dejar
    -- pasar: un cupón "una vez por persona" sin saber quién es no cumple su
    -- condición, y dejarlo pasar lo vuelve ilimitado en la práctica.
    IF lower(btrim(COALESCE(p_email, ''))) = '' THEN
      RETURN jsonb_build_object('valid', false,
        'reason', 'Ingresá tu email para poder validar este cupón');
    END IF;

    v_usos := public.usos_de_cupon_por_persona(v_c.id, p_email);
    IF v_usos >= v_c.max_uses_per_customer THEN
      RETURN jsonb_build_object('valid', false,
        'reason', 'Ya usaste este cupón el máximo de veces');
    END IF;
  END IF;

  IF v_c.max_uses IS NOT NULL AND COALESCE(v_c.current_uses, 0) >= v_c.max_uses THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón alcanzó su límite de usos');
  END IF;

  -- ── Cuánto hace el cupón ────────────────────────────────────────────────
  -- Espejo de `calcularEfecto` en src/lib/couponRules.ts.
  IF COALESCE(v_c.discount_percent, 0) > 0 THEN
    v_desc := round(COALESCE(p_subtotal, 0) * v_c.discount_percent / 100.0);
  ELSIF COALESCE(v_c.discount_fixed_ars, 0) > 0 THEN
    v_desc := LEAST(v_c.discount_fixed_ars, COALESCE(p_subtotal, 0));
  END IF;

  IF v_c.free_shipping AND COALESCE(p_shipping, 0) > 0 THEN
    v_bonif := LEAST(p_shipping, COALESCE(v_c.free_shipping_max_ars, p_shipping));
  END IF;

  -- Un cupón sin porcentaje ni monto fijo y sin envío gratis no descuenta
  -- nada: está mal cargado.
  IF v_desc <= 0 AND NOT v_c.free_shipping THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'El cupón no aplica a este pedido');
  END IF;

  -- Envío gratis sobre un pedido cuyo envío ya vale cero —retiro en tienda, o
  -- el umbral de la tienda ya alcanzado—. Aceptarlo lo consumiría a cambio de
  -- nada. Sólo se decide cuando el envío ya se cotizó: con `p_shipping` NULL
  -- todavía no se sabe y no se bloquea.
  IF v_desc <= 0 AND v_c.free_shipping
     AND p_shipping IS NOT NULL AND v_bonif <= 0 THEN
    RETURN jsonb_build_object('valid', false, 'reason',
      'Este cupón bonifica el envío y tu pedido no tiene costo de envío');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code', upper(v_c.code),
    'discount', v_desc,
    'free_shipping', v_c.free_shipping,
    'shipping_discount', v_bonif,
    'free_shipping_max', v_c.free_shipping_max_ars,
    'min_order_value', v_c.min_order_value);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.check_store_coupon(text, text, numeric, text, numeric)
  TO anon, authenticated;

-- ── 4. La orden ────────────────────────────────────────────────────────────
--
-- Cambios respecto de la versión anterior:
--   a) el envío se cotiza ANTES del cupón, porque ahora el cupón puede tocarlo;
--   b) el cupón se valida llamando a `check_store_coupon` en vez de con un
--      SELECT propio a medias — así el mínimo y el límite por persona valen
--      también para quien llame al RPC directo;
--   c) `current_uses` se incrementa recién cuando el cupón quedó aplicado.

CREATE OR REPLACE FUNCTION public.create_store_order(
  p_slug text, p_items jsonb, p_customer_name text, p_customer_email text,
  p_customer_phone text, p_shipping jsonb, p_payment_method text,
  p_notes text DEFAULT NULL, p_coupon text DEFAULT NULL,
  p_shipping_option text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
$function$;

-- ── 5. El libro de usos, con el costo real del cupón ───────────────────────

CREATE OR REPLACE FUNCTION public.trg_registrar_uso_de_cupon()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_cid uuid;
BEGIN
  IF NEW.coupon_code IS NULL OR btrim(NEW.coupon_code) = '' THEN RETURN NEW; END IF;

  SELECT c.id INTO v_cid FROM public.coupons c
   WHERE c.org_id = NEW.org_id AND upper(c.code) = upper(btrim(NEW.coupon_code))
   LIMIT 1;

  IF v_cid IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.coupon_usages (
    org_id, coupon_id, order_id, customer_email, store_customer_id,
    discount_ars, shipping_discount_ars
  ) VALUES (
    NEW.org_id, v_cid, NEW.id,
    NULLIF(lower(btrim(COALESCE(NEW.customer_email, ''))), ''),
    NEW.store_customer_id,
    -- Lo que costó el cupón: su descuento de mercadería más el envío que
    -- bonificó. `discount_amount` no sirve para esto porque además mezcla la
    -- promo "llevando 2" y el descuento por medio de pago. Para una orden
    -- anterior a A5 —sin desglose— se cae a `discount_amount`, que era lo que
    -- se anotaba antes.
    COALESCE(NULLIF(NEW.coupon_discount_ars, 0), NEW.discount_amount, 0)
      + COALESCE(NEW.shipping_discount_ars, 0),
    COALESCE(NEW.shipping_discount_ars, 0)
  );

  RETURN NEW;
END;
$function$;
