-- Ofertas reales: cuándo el descuento por medio de pago se suma.
--
-- La migración anterior frenó el descuento doble, y estaba bien para el caso
-- que reportó el dueño: sus productos tienen "20% off" que **es** el precio con
-- transferencia, así que aplicarle otro 20% daba 36% real.
--
-- Pero deja afuera la otra mitad del problema, y es la pregunta que siguió:
-- **en una liquidación de verdad el descuento por transferencia sí
-- corresponde.** Un producto rebajado de 100.000 a 70.000 por fin de temporada
-- sigue teniendo el 20% de transferencia encima: son dos cosas distintas, una
-- es el precio y la otra es cómo se paga.
--
-- **Eso no se puede deducir del número.** `discount_price_ars` significa las
-- dos cosas según qué quiso hacer el comercio, así que lo decide él:
--
--   `products.offer_stacks_payment`  — por producto. NULL = usa la política.
--   `ecommerce_stores.payment_discount_stacks` — la política, por defecto false.
--
-- El default es `false` a propósito: es el comportamiento que el dueño acaba de
-- pedir, y equivocarse hacia "no acumula" cobra de más al comprador —que se
-- queja— mientras que equivocarse hacia "acumula" regala margen en silencio.
--
-- La mecánica no cambia: el descuento del medio se calcula contra
-- `list_price`, que ahora es el precio de oferta cuando acumula y el de lista
-- cuando no. Se sigue cobrando **el mejor de los dos, nunca la suma**, así que
-- una oferta más agresiva que el medio de pago sigue ganando.
--
-- Idempotente.

ALTER TABLE public.ecommerce_stores
  ADD COLUMN IF NOT EXISTS payment_discount_stacks boolean NOT NULL DEFAULT false;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS offer_stacks_payment boolean;

COMMENT ON COLUMN public.ecommerce_stores.payment_discount_stacks IS
  'Politica por defecto: si el descuento por medio de pago se suma a la oferta '
  'del producto. false = la oferta ya es el precio con descuento.';

COMMENT ON COLUMN public.products.offer_stacks_payment IS
  'Override por producto de ecommerce_stores.payment_discount_stacks. '
  'NULL = usa la politica de la tienda.';

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
BEGIN
  SELECT id, name, brand, stock, sale_price_ars, discount_price_ars, image_url,
         offer_stacks_payment
  INTO v_prod
  FROM public.products
  WHERE id = p_product_id AND org_id = p_org_id;

  IF v_prod.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Un producto del carrito ya no está disponible');
  END IF;

  -- Precio base del producto: el de oferta si lo hay.
  v_unit := COALESCE(NULLIF(v_prod.discount_price_ars, 0), v_prod.sale_price_ars);

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
$function$;
