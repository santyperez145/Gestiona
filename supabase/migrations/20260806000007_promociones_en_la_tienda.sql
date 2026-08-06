-- Las promociones se aplican también en la tienda online.
--
-- La tabla `promotions` existe desde hace tiempo, tiene su ABM en /promociones,
-- y **ya se aplica al cobrar en el POS y se muestra en los dos catálogos**
-- (`src/lib/promotions.ts`). La tienda online era la única superficie que no la
-- miraba: el comercio creaba "20% off en Perfume Árabe", se descontaba en el
-- mostrador, y online se cobraba el precio pleno.
--
-- Es exactamente el mismo caso que `price_2x_ars` en la sesión 94: un dato que
-- el comercio ya cargó, que la plataforma ya muestra en otro lado, y que una
-- superficie ignora en silencio.
--
-- ── Cómo compone ─────────────────────────────────────────────────────────
--
-- **Gana el mejor precio, nunca la suma.** La promoción se resuelve dentro del
-- precio de la línea, no como un descuento aparte, porque una promoción *es* un
-- precio. Así el descuento por volumen, el cupón y el medio de pago trabajan
-- después sobre el número correcto sin necesitar saber que hubo una promo.
--
-- ── Qué se toma y qué no ─────────────────────────────────────────────────
--
-- Espejo exacto de `bestPromoPrice` en `src/lib/promotions.ts`, que es lo que
-- ya usa el POS. Si se toca una, se toca la otra.
--
--   * Sólo `status = 'active'` y **sin `coupon_code`**: las que tienen código se
--     manejan por el flujo de cupones, que ya existe y se valida aparte.
--   * Sólo `percentage` y `fixed`. `buy_x_get_y`, `bundle` y `free_shipping`
--     necesitan lógica de carrito y quedan afuera a propósito en vez de
--     aplicarse a medias.
--   * `applies_to = 'customers'` **no** aplica: es de orden, no de línea, y
--     tratarla como de línea le daría el descuento a cualquiera.
--   * El descuento se calcula sobre el precio de **lista**, igual que en el POS.
--
-- Idempotente.

-- ── El mejor precio de promoción para un producto ──────────────────────────
-- `NULL` cuando ninguna promoción aplica: es distinto de "da el mismo precio",
-- y quien llama decide qué hacer con eso.
CREATE OR REPLACE FUNCTION public.store_promo_price(
  p_org_id     uuid,
  p_product_id uuid,
  p_category   text,
  p_list_price numeric
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
      AND (
        pr.applies_to = 'all'
        OR (pr.applies_to = 'products'   AND p_product_id = ANY(pr.product_ids))
        OR (pr.applies_to = 'categories' AND p_category IS NOT NULL
                                         AND p_category = ANY(pr.category_names))
      )
  ) x;
$fn$;

REVOKE ALL ON FUNCTION public.store_promo_price(uuid, uuid, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_promo_price(uuid, uuid, text, numeric) TO anon, authenticated;

COMMENT ON FUNCTION public.store_promo_price(uuid, uuid, text, numeric) IS
  'Mejor precio de las promociones auto-aplicables para un producto, o NULL si '
  'ninguna aplica. Espejo de bestPromoPrice en src/lib/promotions.ts.';

-- ── resolve_store_line, con la promoción adentro del precio ────────────────
-- Regenerada desde la definición que corre en producción. Idempotente.
CREATE OR REPLACE FUNCTION public.resolve_store_line(p_org_id uuid, p_product_id uuid, p_variant_id uuid, p_qty integer)
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
  v_promo := public.store_promo_price(
    p_org_id, v_prod.id, v_prod.category, v_prod.sale_price_ars);
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
