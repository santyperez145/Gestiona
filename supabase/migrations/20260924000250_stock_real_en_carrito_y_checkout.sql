-- ═══════════════════════════════════════════════════════════════════════════
-- P0 Commerce — El carrito mide el mismo stock que el checkout
--
-- ── El bug que este repo tenía a la vista ────────────────────────────────
--
-- `resolve_store_line` validaba contra `products.stock` crudo: el mismo número
-- que incluye mercadería con dueño. La reserva atómica de
-- `20260806000030_reserva_de_stock.sql` aparta stock entre orden y pago con
-- `stock_disponible()`, pero el carrito canónico la ignoraba. Resultado: dos
-- compradores veían "Última unidad" al mismo tiempo, ambos confirmaban, y el
-- segundo se enteraba recién al confirmar con "Sin stock disponible".
--
-- ── La decisión: una sola moneda ─────────────────────────────────────────
--
-- `stock_disponible(product_id, variant_id)` ES la definición de "cuánto hay
-- para vender": físico menos reservas vigentes. Cualquier camino que valide
-- una venta contra otra cosa mide dos monedas distintas. Acá se usa en:
--
--   1. `resolve_store_line` — autoridad compartida de carrito y checkout.
--   2. `stock_en_vitrina` — nuevo RPC público para el "en vivo" del carrito.
--
-- No se toca el descuento de stock: sigue siendo `mark_store_order_paid` vía
-- `trg_sale_stock_movement`, y `trg_soltar_reserva_de_orden` sigue soltando
-- (no descontando) al pagar. Descontar en más de un lugar es el error que este
-- repo ya cometió en ventas, compras y transferencias.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. resolve_store_line valida contra el disponible real ───────────────
CREATE OR REPLACE FUNCTION public.resolve_store_line(
  p_org_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_qty integer,
  p_order_subtotal numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product record;
  v_variant record;
  v_publication public.store_product_publications%ROWTYPE;
  v_store_id uuid;
  v_unit numeric;
  v_list numeric;
  v_offer numeric;
  v_stacks boolean;
  v_promo numeric;
  v_disp numeric;
BEGIN
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 999 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La cantidad no es válida');
  END IF;

  BEGIN
    v_store_id := NULLIF(current_setting('nerqia.store_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_store_id := NULL;
  END;

  SELECT
    product.id, product.name, product.brand, product.category, product.stock,
    product.sale_price_ars, product.discount_price_ars, product.image_url,
    product.offer_stacks_payment, COALESCE(product.is_active, true) AS active
  INTO v_product
  FROM public.products product
  WHERE product.id = p_product_id AND product.org_id = p_org_id;

  IF v_product.id IS NULL OR NOT v_product.active THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'Un producto del carrito ya no está disponible'
    );
  END IF;

  IF v_store_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ecommerce_stores store
      WHERE store.id = v_store_id AND store.org_id = p_org_id AND store.is_active
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'La tienda ya no está disponible');
    END IF;

    SELECT publication.* INTO v_publication
    FROM public.store_product_publications publication
    WHERE publication.store_id = v_store_id
      AND publication.product_id = p_product_id;

    IF COALESCE(v_publication.visibility, 'published') <> 'published' THEN
      RETURN jsonb_build_object(
        'ok', false, 'error', 'Este producto ya no está publicado en la tienda'
      );
    END IF;
  END IF;

  v_product.category := COALESCE(v_publication.category_slug, v_product.category);
  v_list := CASE
    WHEN v_publication.price_ars IS NOT NULL
      THEN COALESCE(v_publication.compare_at_price_ars, v_publication.price_ars)
    ELSE v_product.sale_price_ars
  END;
  v_offer := CASE
    WHEN v_publication.price_ars IS NOT NULL THEN v_publication.price_ars
    ELSE COALESCE(NULLIF(v_product.discount_price_ars, 0), v_product.sale_price_ars)
  END;

  IF COALESCE(v_offer, 0) <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'Un producto del carrito ya no tiene precio disponible'
    );
  END IF;

  v_unit := v_offer;
  v_promo := public.store_promo_price(
    p_org_id, v_product.id, v_product.category, v_list, p_order_subtotal
  );
  IF v_promo IS NOT NULL AND v_promo < v_unit THEN
    v_unit := v_promo;
  END IF;

  v_stacks := COALESCE(
    v_product.offer_stacks_payment,
    (SELECT store.payment_discount_stacks
     FROM public.ecommerce_stores store
     WHERE store.id = v_store_id),
    (SELECT store.payment_discount_stacks
     FROM public.ecommerce_stores store
     WHERE store.org_id = p_org_id
     ORDER BY store.is_primary DESC, store.created_at ASC
     LIMIT 1),
    false
  );

  -- El stock real: físico menos reservas activas. Se lee sin lock —esta
  -- función es STABLE y sólo consulta—; el lock exclusivo lo toma el trigger
  -- al crear la orden, que es donde una carrera puede sobre-vender.
  IF p_variant_id IS NULL THEN
    v_disp := public.stock_disponible(p_product_id, NULL);
    IF v_disp < p_qty THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', format(
          'Sin stock disponible de %s: quedan %s y se piden %s',
          v_product.name, GREATEST(v_disp, 0), p_qty
        ),
        'available_quantity', GREATEST(v_disp, 0)
      );
    END IF;
    RETURN jsonb_build_object('ok', true, 'line', jsonb_build_object(
      'product_id', v_product.id,
      'variant_id', NULL,
      'name', v_product.name,
      'brand', v_product.brand,
      'quantity', p_qty,
      'unit_price', v_unit,
      'list_price', CASE WHEN v_stacks THEN v_unit ELSE v_list END,
      'total', v_unit * p_qty,
      'image_url', v_product.image_url,
      'available_quantity', GREATEST(v_disp, 0)
    ));
  END IF;

  SELECT
    variant.id, variant.variant_name, variant.stock,
    variant.price_override, variant.image_url
  INTO v_variant
  FROM public.product_variants variant
  WHERE variant.id = p_variant_id
    AND variant.product_id = p_product_id
    AND variant.org_id = p_org_id
    AND variant.active;

  IF v_variant.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esa variante ya no está disponible');
  END IF;
  v_disp := public.stock_disponible(p_product_id, p_variant_id);
  IF v_disp < p_qty THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', format(
        'Sin stock disponible de %s %s: quedan %s y se piden %s',
        v_product.name, v_variant.variant_name, GREATEST(v_disp, 0), p_qty
      ),
      'available_quantity', GREATEST(v_disp, 0)
    );
  END IF;
  IF COALESCE(v_variant.price_override, 0) > 0 THEN
    v_unit := v_variant.price_override;
  END IF;

  RETURN jsonb_build_object('ok', true, 'line', jsonb_build_object(
    'product_id', v_product.id,
    'variant_id', v_variant.id,
    'name', v_product.name || ' — ' || v_variant.variant_name,
    'brand', v_product.brand,
    'quantity', p_qty,
    'unit_price', v_unit,
    'list_price', CASE
      WHEN COALESCE(v_variant.price_override, 0) > 0 THEN v_variant.price_override
      WHEN v_stacks THEN v_unit
      ELSE v_list
    END,
    'total', v_unit * p_qty,
    'image_url', COALESCE(v_variant.image_url, v_product.image_url),
    'available_quantity', GREATEST(v_disp, 0)
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_store_line(uuid, uuid, uuid, integer, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_store_line(uuid, uuid, uuid, integer, numeric)
  TO anon, authenticated;

-- ── 2. Disponibilidad en vivo para el carrito y el checkout ──────────────
--
-- El comprador no debería enterarse del stock que ya tiene dueño recién al
-- confirmar: el carrito consulta este RPC y ajusta cantidades y avisos antes
-- de llegar a confirmar. Una sola función, la misma medida del checkout.
CREATE OR REPLACE FUNCTION public.stock_en_vitrina(
  p_slug  text,
  p_items jsonb  -- [{product_id, variant_id}]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store record;
  v_line  jsonb;
  v_resp  jsonb := '[]'::jsonb;
  v_disp  numeric;
  v_reservado numeric;
BEGIN
  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores
  WHERE lower(slug) = lower(btrim(p_slug)) AND is_active
  LIMIT 1;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada o inactiva' USING ERRCODE = '22023';
  END IF;

  -- Rate limit propio: un bot no debe poder sondear el catálogo entero
  -- consumiendo la cuota del carrito.
  IF NOT public.rate_limit_publico('store_stock', p_slug, 60, interval '1 minute') THEN
    RAISE EXCEPTION 'Demasiadas consultas. Esperá un momento.'
      USING ERRCODE = '53400';
  END IF;

  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'El carrito debe ser una lista' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) > 100 THEN
    RAISE EXCEPTION 'El carrito supera el máximo de 100 líneas' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN
    SELECT item.value
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS item(value)
  LOOP
    DECLARE
      v_pid uuid := NULLIF(btrim(COALESCE(v_line->>'product_id', '')), '')::uuid;
      v_vid uuid := NULLIF(btrim(COALESCE(v_line->>'variant_id', '')), '')::uuid;
      v_fisico integer;
      v_nombre text;
    BEGIN
      IF v_pid IS NULL THEN
        RAISE EXCEPTION 'Una línea del carrito no es válida' USING ERRCODE = '22023';
      END IF;

      -- La publicación de la tienda filtra qué producto se puede mirar. Si no
      -- está publicado no se revela si existe: mismo criterio que la vitrina.
      SELECT p.name, p.stock INTO v_nombre, v_fisico
      FROM public.products p
      LEFT JOIN public.store_product_publications pub
        ON pub.store_id = v_store.id AND pub.product_id = p.id
      WHERE p.id = v_pid AND p.org_id = v_store.org_id
        AND COALESCE(p.is_active, true)
        AND COALESCE(pub.visibility, 'published') = 'published';

      IF v_nombre IS NULL THEN
        v_resp := v_resp || jsonb_build_object(
          'product_id', v_pid, 'variant_id', v_vid,
          'stock', 0, 'available_quantity', 0,
          'reserved', 0, 'available', false);
        CONTINUE;
      END IF;

      -- Para variantes el físico es el de la variante, no el del padre.
      IF v_vid IS NOT NULL THEN
        SELECT variant.stock INTO v_fisico
        FROM public.product_variants variant
        WHERE variant.id = v_vid
          AND variant.product_id = v_pid
          AND variant.org_id = v_store.org_id
          AND variant.active;
        v_fisico := COALESCE(v_fisico, 0);
      END IF;

      v_disp := public.stock_disponible(v_pid, v_vid);
      v_reservado := GREATEST(COALESCE(v_fisico, 0) - COALESCE(v_disp, 0), 0);
      v_resp := v_resp || jsonb_build_object(
        'product_id', v_pid,
        'variant_id', v_vid,
        'stock', COALESCE(v_fisico, 0),
        'available_quantity', GREATEST(COALESCE(v_disp, 0), 0),
        'reserved', v_reservado,
        'available', COALESCE(v_disp, 0) > 0
      );
    END;
  END LOOP;

  RETURN v_resp;
END;
$$;

REVOKE ALL ON FUNCTION public.stock_en_vitrina(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_en_vitrina(text, jsonb) TO anon, authenticated;

COMMENT ON FUNCTION public.stock_en_vitrina(text, jsonb) IS
  'Disponibilidad real (físico menos reservas vigentes) por línea de carrito. La vitrina la consulta en vivo para no prometer unidades con dueño.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════
DO $verif$
DECLARE
  v_slug   text;
  v_org    uuid;
  v_prod   uuid;
  v_fisico integer;
  v_r      jsonb;
  v_disp   numeric;
BEGIN
  SELECT s.slug, s.org_id INTO v_slug, v_org
  FROM public.ecommerce_stores s WHERE s.is_active LIMIT 1;
  IF v_slug IS NULL THEN
    RAISE NOTICE 'P0 stock: sin tienda activa, no se puede verificar'; RETURN;
  END IF;

  SELECT p.id, p.stock INTO v_prod, v_fisico
  FROM public.products p
  WHERE p.org_id = v_org AND COALESCE(p.is_active, true) AND p.stock > 0
  LIMIT 1;
  IF v_prod IS NULL THEN
    RAISE NOTICE 'P0 stock: sin producto, no se puede verificar'; RETURN;
  END IF;

  -- stock_en_vitrina debe devolver una entrada por línea pedida, y sin
  -- reservas el disponible coincide con el físico (puede haber reservas
  -- legítimas de producción: se verifica el límite, no la igualdad).
  v_r := public.stock_en_vitrina(
    v_slug, jsonb_build_array(jsonb_build_object('product_id', v_prod)));
  ASSERT jsonb_array_length(v_r) = 1, 'stock_en_vitrina debe devolver una entrada';
  ASSERT (v_r->0->>'product_id') = v_prod::text, 'la entrada debe ser el producto pedido';
  v_disp := (v_r->0->>'available_quantity')::numeric;
  ASSERT v_disp <= v_fisico,
    format('el disponible no puede superar el fisico: %s vs %s', v_disp, v_fisico);
  ASSERT v_disp >= 0, 'el disponible no puede ser negativo';

  RAISE NOTICE 'P0 stock OK: % producto % fisico % disponible %',
    v_slug, v_prod, v_fisico, v_disp;
END;
$verif$;
