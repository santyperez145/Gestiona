-- ═══════════════════════════════════════════════════════════════════════════
-- La tienda online cotiza envío por zona y registra la comisión de cada cobro
--
-- Quedaban dos cosas configuradas que la tienda nunca usaba:
--
--   1. Las zonas y tarifas de envío (20260730000027). `create_store_order`
--      cobraba `ecommerce_stores.shipping_cost`, un precio plano: lo mismo para
--      Palermo que para Ushuaia, sin importar el peso.
--   2. Los aranceles y la comisión de plataforma (20260730000028). Nadie
--      escribía en `payment_transactions`, así que el comercio no sabía cuánto
--      le quedaba de cada venta y la plataforma no sabía cuánto había facturado.
--
-- Todo el cálculo vive en la base y no en el navegador, por la misma razón que
-- el precio de los productos: es lo único que el comprador no puede manipular.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Peso del carrito
-- ───────────────────────────────────────────────────────────────────────────

-- Un producto sin peso declarado usa el estimado de la tienda: preferimos
-- cotizar con una aproximación antes que no cotizar y perder la venta.
CREATE OR REPLACE FUNCTION public.store_cart_weight_kg(
  p_org_id uuid,
  p_items  jsonb,
  p_default_weight numeric DEFAULT 0.5
)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN COALESCE(pr.weight_kg, 0) > 0 THEN pr.weight_kg
      ELSE GREATEST(p_default_weight, 0)
    END
    * GREATEST(COALESCE((it->>'quantity')::int, 1), 0)
  ), 0)::numeric(10,3)
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS it
  LEFT JOIN public.products pr
    ON pr.id = (it->>'product_id')::uuid AND pr.org_id = p_org_id;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Cotización por zona
-- ───────────────────────────────────────────────────────────────────────────

-- Espejo en SQL de `quoteShipping()` en src/lib/shippingCalc.ts, que está
-- testeado con 40 casos. Si cambia la regla, cambian los dos.
--
-- Reglas que importan:
--   · Los tramos de peso son [min, max): 1 kg exacto cae en el tramo de arriba.
--   · Por encima del techo más alto se cobra el excedente por kg ENTERO
--     (`ceil`), que es como cobran los correos: por kg o fracción.
--   · El umbral de envío gratis de la tarifa pisa el de la tienda.
--   · El retiro en tienda va primero: es gratis y le conviene a los dos lados.
CREATE OR REPLACE FUNCTION public.quote_store_shipping(
  p_slug          text,
  p_province      text,
  p_postal_code   text DEFAULT NULL,
  p_items         jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  option_id   text,
  carrier     text,
  service     text,
  label       text,
  price       numeric,
  is_free     boolean,
  days_min    int,
  days_max    int,
  zone_id     uuid,
  zone_name   text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store    record;
  v_zone     record;
  v_weight   numeric;
  v_subtotal numeric := 0;
  v_it       jsonb;
  v_unit     numeric;
BEGIN
  SELECT s.id, s.org_id, s.shipping_mode, s.shipping_cost, s.free_shipping_above,
         s.pickup_enabled, s.default_item_weight_kg
  INTO v_store
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug) AND s.is_active;

  IF v_store.id IS NULL THEN
    RETURN;  -- tienda inexistente: sin opciones, el checkout lo informa
  END IF;

  -- Subtotal autoritativo, para evaluar el umbral de envío gratis con los
  -- precios de la base y no con lo que diga el cliente.
  FOR v_it IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    SELECT COALESCE(NULLIF(pr.discount_price_ars, 0), pr.sale_price_ars)
    INTO v_unit
    FROM public.products pr
    WHERE pr.id = (v_it->>'product_id')::uuid AND pr.org_id = v_store.org_id;
    v_subtotal := v_subtotal + COALESCE(v_unit, 0)
                  * GREATEST(COALESCE((v_it->>'quantity')::int, 1), 0);
  END LOOP;

  -- Retiro en tienda: no depende de zona ni de peso
  IF v_store.pickup_enabled THEN
    RETURN QUERY SELECT
      'retiro'::text, 'retiro'::text, 'sucursal'::text, 'Retiro en tienda'::text,
      0::numeric, true, 0, 0, NULL::uuid, NULL::text;
  END IF;

  -- Envío gratis como política de la tienda
  IF v_store.shipping_mode = 'free' THEN
    RETURN QUERY SELECT
      'gratis'::text, 'propio'::text, 'domicilio'::text, 'Envío gratis'::text,
      0::numeric, true, NULL::int, NULL::int, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Precio plano (comportamiento anterior, sigue disponible)
  IF v_store.shipping_mode = 'flat' OR v_store.shipping_mode IS NULL THEN
    RETURN QUERY SELECT
      'flat'::text, 'propio'::text, 'domicilio'::text, 'Envío a domicilio'::text,
      CASE
        WHEN v_store.free_shipping_above IS NOT NULL
         AND v_store.free_shipping_above > 0
         AND v_subtotal >= v_store.free_shipping_above THEN 0
        ELSE COALESCE(v_store.shipping_cost, 0)
      END::numeric,
      (v_store.free_shipping_above IS NOT NULL
        AND v_store.free_shipping_above > 0
        AND v_subtotal >= v_store.free_shipping_above),
      NULL::int, NULL::int, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- ── Modo zonas ──────────────────────────────────────────────────────────
  IF p_province IS NULL OR btrim(p_province) = '' THEN
    RETURN;  -- sin provincia no se puede resolver la zona
  END IF;

  SELECT z.id, z.name INTO v_zone
  FROM public.shipping_zones z
  WHERE z.org_id = v_store.org_id
    AND z.is_active
    AND p_province = ANY(z.provinces)
  ORDER BY z.sort_order
  LIMIT 1;

  IF v_zone.id IS NULL THEN
    RETURN;  -- provincia sin cobertura; sólo queda el retiro si estaba activo
  END IF;

  v_weight := public.store_cart_weight_kg(
    v_store.org_id, p_items, COALESCE(v_store.default_item_weight_kg, 0.5));

  RETURN QUERY
  WITH activos AS (
    SELECT r.*
    FROM public.shipping_rates r
    LEFT JOIN public.shipping_carriers c
      ON c.org_id = r.org_id AND c.carrier = r.carrier
    WHERE r.zone_id = v_zone.id
      AND r.is_active
      -- Un transportista configurado y deshabilitado no se ofrece. Si no está
      -- configurado se ofrece igual: el tarifario alcanza.
      AND COALESCE(c.is_enabled, true)
  ),
  -- Un tramo por (transportista, servicio): el que contiene el peso, o el más
  -- pesado si el carrito supera todos los techos.
  elegidos AS (
    SELECT DISTINCT ON (a.carrier, a.service)
      a.*,
      COALESCE(c.markup_pct, 0)   AS markup_pct,
      COALESCE(c.markup_fixed, 0) AS markup_fixed
    FROM activos a
    LEFT JOIN public.shipping_carriers c
      ON c.org_id = a.org_id AND c.carrier = a.carrier
    ORDER BY
      a.carrier, a.service,
      -- Primero el tramo que contiene el peso...
      (v_weight >= a.min_weight_kg
        AND (a.max_weight_kg IS NULL OR v_weight < a.max_weight_kg)) DESC,
      -- ...si ninguno, el de techo más alto
      COALESCE(a.max_weight_kg, 1e9) DESC
  ),
  calculados AS (
    SELECT
      e.carrier, e.service, e.delivery_days_min, e.delivery_days_max,
      e.free_above,
      -- Excedente por kg entero sobre el techo del tramo
      (
        e.price + CASE
          WHEN e.max_weight_kg IS NOT NULL AND v_weight > e.max_weight_kg
          THEN ceil(v_weight - e.max_weight_kg) * COALESCE(e.price_per_extra_kg, 0)
          ELSE 0
        END
      ) * (1 + e.markup_pct / 100.0) + e.markup_fixed AS bruto
    FROM elegidos e
  )
  SELECT
    (c.carrier || ':' || c.service)::text,
    c.carrier::text,
    c.service::text,
    (CASE c.carrier
       WHEN 'correo_argentino' THEN 'Correo Argentino'
       WHEN 'andreani'         THEN 'Andreani'
       WHEN 'oca'              THEN 'OCA'
       WHEN 'propio'           THEN 'Envío propio'
       ELSE c.carrier
     END
     || ' · ' ||
     CASE c.service
       WHEN 'domicilio'   THEN 'A domicilio'
       WHEN 'sucursal'    THEN 'Retiro en sucursal'
       WHEN 'express'     THEN 'Express'
       WHEN 'prioritario' THEN 'Prioritario'
       ELSE c.service
     END)::text,
    CASE WHEN gratis.si THEN 0 ELSE round(c.bruto, 2) END,
    gratis.si,
    c.delivery_days_min,
    c.delivery_days_max,
    v_zone.id,
    v_zone.name
  FROM calculados c
  CROSS JOIN LATERAL (
    SELECT (
      COALESCE(c.free_above, v_store.free_shipping_above) IS NOT NULL
      AND COALESCE(c.free_above, v_store.free_shipping_above) > 0
      AND v_subtotal >= COALESCE(c.free_above, v_store.free_shipping_above)
    ) AS si
  ) gratis
  ORDER BY 5;  -- de más barato a más caro
END;
$$;

GRANT EXECUTE ON FUNCTION public.quote_store_shipping(text, text, text, jsonb)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_cart_weight_kg(uuid, jsonb, numeric)
  TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Liquidación de un cobro
-- ───────────────────────────────────────────────────────────────────────────

-- Espejo en SQL de `computeSettlement()` en src/lib/paymentFees.ts (37 tests).
-- Idempotente por (provider, external_id): los webhooks reintentan y una
-- comisión contada dos veces es plata mal facturada.
CREATE OR REPLACE FUNCTION public.record_payment_settlement(
  p_org_id       uuid,
  p_source       text,
  p_source_id    uuid,
  p_provider     text,
  p_method       text,
  p_installments int,
  p_gross        numeric,
  p_external_id  text DEFAULT NULL,
  p_actual_fee   numeric DEFAULT NULL,
  p_currency     text DEFAULT 'ARS',
  p_status       text DEFAULT 'approved'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fee      record;
  v_rule     record;
  v_plan     uuid;
  v_channel  text;
  v_provfee  numeric := 0;
  v_iva      numeric := 0;
  v_platform numeric := 0;
  v_net      numeric;
  v_release  int := 0;
  v_id       uuid;
BEGIN
  IF p_gross IS NULL OR p_gross <= 0 THEN RETURN NULL; END IF;

  v_channel := CASE WHEN p_source = 'pos' THEN 'pos' ELSE 'online' END;

  -- Arancel del procesador, de más específico a más general
  SELECT f.percent_fee, f.fixed_fee, f.iva_on_fee_pct, f.release_days
  INTO v_fee
  FROM public.payment_provider_fees f
  WHERE f.provider = p_provider
    AND f.currency = p_currency
    AND f.effective_from <= CURRENT_DATE
    AND (
      (f.method = p_method AND f.installments = COALESCE(p_installments, 0))
      OR (f.method = p_method AND f.installments = 0)
      OR f.method = 'default'
    )
  ORDER BY
    (f.method = p_method AND f.installments = COALESCE(p_installments, 0)) DESC,
    (f.method = p_method) DESC,
    f.effective_from DESC
  LIMIT 1;

  -- Si el procesador informó lo que cobró de verdad, ese número gana sobre el
  -- tarifario: es el que efectivamente salió de la cuenta.
  IF p_actual_fee IS NOT NULL AND p_actual_fee >= 0 THEN
    v_provfee := round(p_actual_fee, 2);
  ELSE
    v_provfee := round(p_gross * COALESCE(v_fee.percent_fee, 0) / 100.0
                       + COALESCE(v_fee.fixed_fee, 0), 2);
  END IF;
  v_iva     := round(v_provfee * COALESCE(v_fee.iva_on_fee_pct, 0) / 100.0, 2);
  v_release := COALESCE(v_fee.release_days, 0);

  -- Comisión de plataforma: org > plan > base
  SELECT o.plan_id INTO v_plan FROM public.organizations o WHERE o.id = p_org_id;

  SELECT r.percent, r.fixed, r.max_per_transaction, r.min_per_transaction
  INTO v_rule
  FROM public.platform_commission_rules r
  WHERE r.is_active
    AND (r.applies_to = 'all' OR r.applies_to = v_channel)
    AND (r.org_id IS NULL OR r.org_id = p_org_id)
    AND (r.plan_id IS NULL OR r.plan_id = v_plan)
  ORDER BY
    (r.org_id IS NOT NULL)::int * 4
    + (r.plan_id IS NOT NULL)::int * 2
    + (r.applies_to <> 'all')::int DESC
  LIMIT 1;

  IF v_rule.percent IS NOT NULL OR v_rule.fixed IS NOT NULL THEN
    v_platform := p_gross * COALESCE(v_rule.percent, 0) / 100.0
                  + COALESCE(v_rule.fixed, 0);
    IF v_rule.max_per_transaction IS NOT NULL THEN
      v_platform := LEAST(v_platform, v_rule.max_per_transaction);
    END IF;
    IF COALESCE(v_rule.min_per_transaction, 0) > 0 THEN
      v_platform := GREATEST(v_platform, v_rule.min_per_transaction);
    END IF;
    v_platform := round(LEAST(v_platform, p_gross), 2);
  END IF;

  -- Nunca un neto negativo: sería un dato inventado que descuadra la contabilidad
  v_net := round(GREATEST(0, p_gross - v_provfee - v_iva - v_platform), 2);

  INSERT INTO public.payment_transactions (
    org_id, source, source_id, provider, method, installments,
    gross_amount, provider_fee, provider_fee_iva, platform_fee, net_amount,
    currency, status, external_id, expected_release_at, released_at
  ) VALUES (
    p_org_id, p_source, p_source_id, p_provider, COALESCE(p_method, 'default'),
    COALESCE(p_installments, 0),
    round(p_gross, 2), v_provfee, v_iva, v_platform, v_net,
    p_currency, p_status, p_external_id,
    CURRENT_DATE + v_release,
    CASE WHEN p_status = 'approved' AND v_release = 0 THEN now() ELSE NULL END
  )
  ON CONFLICT (provider, external_id) DO UPDATE
    SET status = EXCLUDED.status, updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_payment_settlement(
  uuid, text, uuid, text, text, int, numeric, text, numeric, text, text) FROM PUBLIC;
-- Solo service_role: la liquidación la registra el webhook, nunca el navegador.

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Números de pedido sin colisión
-- ───────────────────────────────────────────────────────────────────────────

-- `create_store_order` armaba el número con 4 dígitos al azar por día. Con ~120
-- pedidos diarios la probabilidad de repetir pasa el 50% (paradoja del
-- cumpleaños), y dos pedidos con el mismo número rompen el seguimiento y la
-- página de confirmación, que busca por número.
CREATE SEQUENCE IF NOT EXISTS public.store_order_seq;

CREATE OR REPLACE FUNCTION public.next_store_order_number()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT 'TN-' || to_char(now(), 'YYYYMMDD') || '-' ||
         lpad((nextval('public.store_order_seq') % 100000)::text, 5, '0');
$$;

-- Índice único por org: si algo vuelve a generar un duplicado, falla al insertar
-- en vez de convivir con dos pedidos indistinguibles.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ecom_orders_number
  ON public.ecommerce_orders(org_id, order_number);

-- ───────────────────────────────────────────────────────────────────────────
-- 5. La tienda necesita saber en qué modo cotiza
-- ───────────────────────────────────────────────────────────────────────────

-- `get_store_by_slug` no devolvía `shipping_mode`, así que el checkout no tenía
-- forma de saber que debía pedir provincia y cotizar por zona: siempre se
-- comportaba como precio plano, por más que la tienda tuviera zonas cargadas.
-- Agregar columnas a un RETURNS TABLE exige recrear la función.
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
  shipping_cost    numeric,
  free_shipping_above numeric,
  shipping_mode    text,
  pickup_enabled   boolean,
  pickup_address   text,
  meta_title       text,
  meta_description text,
  social_links     jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    s.org_id,
    -- El catálogo público consulta por user_id, así que se resuelve el dueño
    -- de la organización.
    (SELECT m.user_id FROM public.memberships m
      WHERE m.org_id = s.org_id AND m.role = 'owner'
      ORDER BY m.joined_at LIMIT 1) AS owner_user_id,
    s.name, s.description, s.slug, s.theme, s.primary_color,
    s.logo_url, s.banner_url, s.currency, s.payment_methods,
    s.shipping_cost, s.free_shipping_above,
    s.shipping_mode, s.pickup_enabled, s.pickup_address,
    s.meta_title, s.meta_description, s.social_links
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_store_by_slug(text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. create_store_order con envío por zona
-- ───────────────────────────────────────────────────────────────────────────

-- Sumar un parámetro deja dos funciones con el mismo nombre y PostgREST no
-- sabría cuál llamar, así que se dropea la firma anterior primero (mismo
-- problema que resolvió 20260730000023 al agregar el cupón).
DROP FUNCTION IF EXISTS public.create_store_order(
  text, jsonb, text, text, text, jsonb, text, text, text);

CREATE OR REPLACE FUNCTION public.create_store_order(
  p_slug            text,
  p_items           jsonb,
  p_customer_name   text,
  p_customer_email  text,
  p_customer_phone  text,
  p_shipping        jsonb,
  p_payment_method  text,
  p_notes           text DEFAULT NULL,
  p_coupon          text DEFAULT NULL,
  -- id de opción devuelto por `quote_store_shipping` ("andreani:domicilio").
  -- NULL = la tienda cotiza plano, o se toma la opción más barata disponible.
  p_shipping_option text DEFAULT NULL
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
$$;

REVOKE ALL ON FUNCTION public.create_store_order(
  text, jsonb, text, text, text, jsonb, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_store_order(
  text, jsonb, text, text, text, jsonb, text, text, text, text) TO anon, authenticated;
