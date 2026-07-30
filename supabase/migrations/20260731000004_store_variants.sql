-- Variantes en la tienda online.
--
-- `product_variants` existe desde hace tiempo y la organización ya tiene 26
-- cargadas (talles, sabores, mililitrajes), pero la vitrina las ignoraba por
-- completo: mostraba el producto padre con un solo precio y un stock agregado.
-- El comprador no podía elegir cuál quería, y la orden no registraba cuál se
-- había vendido — así que el comercio no sabía qué reponer.
--
-- Para una perfumería es central: 50ml y 100ml son productos distintos con
-- precio y stock distintos.
--
-- Igual que el resto de la superficie pública, se expone por RPC
-- security-definer con columnas saneadas: nada de costos ni de márgenes.
-- Idempotente.

CREATE OR REPLACE FUNCTION public.get_store_variants(p_slug text)
RETURNS TABLE (
  id             uuid,
  product_id     uuid,
  variant_name   text,
  variant_type   text,
  stock          int,
  price_override numeric,
  image_url      text,
  sku            text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT v.id, v.product_id, v.variant_name, v.variant_type,
         v.stock, v.price_override, v.image_url, v.sku
  FROM public.product_variants v
  JOIN public.ecommerce_stores s ON s.org_id = v.org_id
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active
    AND v.active
    AND v.stock > 0
  ORDER BY v.product_id, v.variant_name;
$$;

REVOKE ALL ON FUNCTION public.get_store_variants(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_variants(text) TO anon, authenticated;

-- ── La orden recuerda qué variante se vendió ──────────────────────────────
-- Sin esto, un pedido de "LATTAFA 100ML" no distingue del de 50ml y el
-- comercio no sabe cuál preparar ni cuál reponer.
CREATE OR REPLACE FUNCTION public.resolve_store_line(
  p_org_id     uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_qty        int
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prod record;
  v_var  record;
  v_unit numeric;
BEGIN
  SELECT id, name, brand, stock, sale_price_ars, discount_price_ars, image_url
  INTO v_prod
  FROM public.products
  WHERE id = p_product_id AND org_id = p_org_id;

  IF v_prod.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Un producto del carrito ya no está disponible');
  END IF;

  -- Precio base del producto: el de oferta si lo hay.
  v_unit := COALESCE(NULLIF(v_prod.discount_price_ars, 0), v_prod.sale_price_ars);

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
      'total', v_unit * p_qty,
      'image_url', COALESCE(v_var.image_url, v_prod.image_url)));
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_store_line(uuid, uuid, uuid, int) FROM PUBLIC;
