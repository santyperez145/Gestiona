-- Stock reservado para el local en la tienda online.
--
-- El comercio que vende en el mostrador y online quiere que la tienda no se
-- lleve las últimas unidades: «dejá 2 de cada producto para el local». Hasta
-- acá la tienda ofrecía todo el disponible.
--   1. `ecommerce_stores.reserva_local`: unidades de cada producto (y de cada
--      variante) que esa tienda no ofrece. 0 = todo el disponible.
--   2. La vitrina (catálogo completo, inicio, productos y variantes) muestra
--      el stock menos la reserva, nunca negativo.
--   3. El carrito y el checkout (`resolve_store_line`, autoridad compartida,
--      y `stock_en_vitrina`) validan contra el disponible real menos la
--      reserva, sólo con contexto de tienda: el POS y el resto no cambian.
-- Cada función se redefine desde su versión vigente con el único cambio del
-- stock. Reversible: volver a esas versiones y DROP de la columna.
BEGIN;

ALTER TABLE public.ecommerce_stores ADD COLUMN IF NOT EXISTS reserva_local numeric(14,3) NOT NULL DEFAULT 0;
ALTER TABLE public.ecommerce_stores DROP CONSTRAINT IF EXISTS ecommerce_stores_reserva_local_check;
ALTER TABLE public.ecommerce_stores ADD CONSTRAINT ecommerce_stores_reserva_local_check CHECK (reserva_local >= 0 AND reserva_local <= 100000);
COMMENT ON COLUMN public.ecommerce_stores.reserva_local IS 'Unidades de cada producto que la tienda online deja para el local (20261023000300).';

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
  v_reserva numeric := 0;
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
    -- Unidades de cada producto que la tienda deja para el local (20261023000300).
    SELECT COALESCE(store.reserva_local, 0) INTO v_reserva
    FROM public.ecommerce_stores store WHERE store.id = v_store_id;

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
    v_disp := public.stock_disponible(p_product_id, NULL) - v_reserva;
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
  v_disp := public.stock_disponible(p_product_id, p_variant_id) - v_reserva;
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
  SELECT id, org_id, COALESCE(reserva_local, 0) AS reserva_local INTO v_store
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
      -- Lo que la tienda deja para el local no se vende online (20261023000300).
      v_disp := COALESCE(v_disp, 0) - v_store.reserva_local;
      v_resp := v_resp || jsonb_build_object(
        'product_id', v_pid,
        'variant_id', v_vid,
        'stock', GREATEST(COALESCE(v_fisico, 0) - v_store.reserva_local, 0),
        'available_quantity', GREATEST(COALESCE(v_disp, 0), 0),
        'reserved', v_reservado,
        'available', COALESCE(v_disp, 0) > 0
      );
    END;
  END LOOP;

  RETURN v_resp;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_store_catalog_completo(p_slug text)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH tienda AS (
    SELECT s.id, s.org_id, s.payment_discount_stacks, COALESCE(s.reserva_local, 0) AS reserva_local
    FROM public.ecommerce_stores s
    WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active
  ),
  promos AS MATERIALIZED (
    SELECT pr.type, pr.discount_value, pr.applies_to, pr.product_ids, pr.category_names
    FROM public.promotions pr
    JOIN tienda t ON t.org_id = pr.org_id
    WHERE pr.status = 'active'
      AND pr.coupon_code IS NULL
      AND pr.type IN ('percentage', 'fixed')
      AND (pr.starts_at IS NULL OR pr.starts_at <= now())
      AND (pr.ends_at IS NULL OR pr.ends_at > now())
      AND COALESCE(pr.min_order_value, 0) <= 0
  ),
  filas AS (
    SELECT
      product.id, product.name, product.brand,
      COALESCE(publication.category_slug, product.category) AS category,
      product.gender, product.description, product.image_url, product.image_urls,
      CASE WHEN publication.price_ars IS NOT NULL
        THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
        ELSE product.sale_price_ars END AS sale_price_ars,
      CASE
        WHEN publication.price_ars IS NOT NULL AND publication.compare_at_price_ars > publication.price_ars
          THEN publication.price_ars
        WHEN publication.price_ars IS NULL THEN product.discount_price_ars
        ELSE NULL::numeric
      END AS discount_price_ars,
      product.price_2x_ars, GREATEST(product.stock - t.reserva_local, 0) AS stock, product.content_ml, product.total_sold,
      COALESCE(publication.featured, product.featured, false) AS featured,
      product.created_at,
      CASE WHEN COALESCE(product.offer_stacks_payment, t.payment_discount_stacks, false)
        THEN COALESCE(
          CASE WHEN publication.price_ars IS NOT NULL THEN publication.price_ars END,
          NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
        ELSE CASE WHEN publication.price_ars IS NOT NULL
          THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
          ELSE product.sale_price_ars END
      END AS payment_base_price,
      COALESCE(publication.sort_order, 2147483647) AS orden,
      product.org_id
    FROM tienda t
    JOIN public.products product ON product.org_id = t.org_id
    LEFT JOIN public.store_product_publications publication
      ON publication.store_id = t.id AND publication.product_id = product.id
    WHERE COALESCE(product.is_active, true)
      AND COALESCE(publication.visibility, 'published') = 'published'
      AND CASE WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
        ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars) END > 0
  )
  SELECT COALESCE(json_agg(json_build_object(
      'id', f.id, 'name', f.name, 'brand', f.brand, 'category', f.category, 'gender', f.gender,
      'description', f.description, 'image_url', f.image_url, 'image_urls', f.image_urls,
      'sale_price_ars', f.sale_price_ars, 'discount_price_ars', f.discount_price_ars,
      'price_2x_ars', f.price_2x_ars, 'stock', f.stock, 'content_ml', f.content_ml,
      'total_sold', f.total_sold, 'featured', f.featured, 'created_at', f.created_at,
      'payment_base_price', f.payment_base_price,
      'promo_price', (
        SELECT min(GREATEST(0, CASE
          WHEN p.type = 'percentage' THEN round(f.sale_price_ars * (1 - p.discount_value / 100.0))
          WHEN p.type = 'fixed' THEN round(f.sale_price_ars - p.discount_value) END))
        FROM promos p
        WHERE COALESCE(f.sale_price_ars, 0) > 0
          AND (p.applies_to = 'all'
            OR (p.applies_to = 'products' AND f.id = ANY(p.product_ids))
            OR (p.applies_to = 'categories' AND f.category IS NOT NULL AND f.category = ANY(p.category_names)))
      )
    ) ORDER BY f.orden, f.featured DESC, f.name, f.id), '[]'::json)
  FROM filas f;
$$;

CREATE OR REPLACE FUNCTION public.get_store_catalog_inicio(p_slug text, p_limite integer DEFAULT 48)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH tienda AS (
    SELECT s.id, s.org_id, s.payment_discount_stacks, COALESCE(s.reserva_local, 0) AS reserva_local
    FROM public.ecommerce_stores s
    WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active
  ),
  promos AS MATERIALIZED (
    SELECT pr.type, pr.discount_value, pr.applies_to, pr.product_ids, pr.category_names
    FROM public.promotions pr
    JOIN tienda t ON t.org_id = pr.org_id
    WHERE pr.status = 'active'
      AND pr.coupon_code IS NULL
      AND pr.type IN ('percentage', 'fixed')
      AND (pr.starts_at IS NULL OR pr.starts_at <= now())
      AND (pr.ends_at IS NULL OR pr.ends_at > now())
      AND COALESCE(pr.min_order_value, 0) <= 0
  ),
  filas AS (
    SELECT
      product.id, product.name, product.brand,
      COALESCE(publication.category_slug, product.category) AS category,
      product.gender, product.description, product.image_url, product.image_urls,
      CASE WHEN publication.price_ars IS NOT NULL
        THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
        ELSE product.sale_price_ars END AS sale_price_ars,
      CASE
        WHEN publication.price_ars IS NOT NULL AND publication.compare_at_price_ars > publication.price_ars
          THEN publication.price_ars
        WHEN publication.price_ars IS NULL THEN product.discount_price_ars
        ELSE NULL::numeric
      END AS discount_price_ars,
      product.price_2x_ars, GREATEST(product.stock - t.reserva_local, 0) AS stock, product.content_ml, product.total_sold,
      COALESCE(publication.featured, product.featured, false) AS featured,
      product.created_at,
      CASE WHEN COALESCE(product.offer_stacks_payment, t.payment_discount_stacks, false)
        THEN COALESCE(
          CASE WHEN publication.price_ars IS NOT NULL THEN publication.price_ars END,
          NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
        ELSE CASE WHEN publication.price_ars IS NOT NULL
          THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
          ELSE product.sale_price_ars END
      END AS payment_base_price,
      COALESCE(publication.sort_order, 2147483647) AS orden,
      product.org_id
    FROM tienda t
    JOIN public.products product ON product.org_id = t.org_id
    LEFT JOIN public.store_product_publications publication
      ON publication.store_id = t.id AND publication.product_id = product.id
    WHERE COALESCE(product.is_active, true)
      AND COALESCE(publication.visibility, 'published') = 'published'
      AND CASE WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
        ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars) END > 0
  ),
  primeros AS (
    SELECT * FROM filas
    ORDER BY (stock <= 0), orden, featured DESC, name, id
    LIMIT LEAST(GREATEST(COALESCE(p_limite, 48), 1), 200)
  )
  SELECT json_build_object('total', (SELECT count(*) FROM filas), 'productos', COALESCE(json_agg(json_build_object(
      'id', f.id, 'name', f.name, 'brand', f.brand, 'category', f.category, 'gender', f.gender,
      'description', f.description, 'image_url', f.image_url, 'image_urls', f.image_urls,
      'sale_price_ars', f.sale_price_ars, 'discount_price_ars', f.discount_price_ars,
      'price_2x_ars', f.price_2x_ars, 'stock', f.stock, 'content_ml', f.content_ml,
      'total_sold', f.total_sold, 'featured', f.featured, 'created_at', f.created_at,
      'payment_base_price', f.payment_base_price,
      'promo_price', (
        SELECT min(GREATEST(0, CASE
          WHEN p.type = 'percentage' THEN round(f.sale_price_ars * (1 - p.discount_value / 100.0))
          WHEN p.type = 'fixed' THEN round(f.sale_price_ars - p.discount_value) END))
        FROM promos p
        WHERE COALESCE(f.sale_price_ars, 0) > 0
          AND (p.applies_to = 'all'
            OR (p.applies_to = 'products' AND f.id = ANY(p.product_ids))
            OR (p.applies_to = 'categories' AND f.category IS NOT NULL AND f.category = ANY(p.category_names)))
      )
    ) ORDER BY (f.stock <= 0), f.orden, f.featured DESC, f.name, f.id), '[]'::json))
  FROM primeros f;
$$;

CREATE OR REPLACE FUNCTION public.get_store_catalog_products(p_slug text)
 RETURNS SETOF store_catalog_products
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    product.id,
    product.org_id,
    product.user_id,
    product.name,
    product.brand,
    COALESCE(publication.category_slug, product.category),
    product.gender,
    product.description,
    product.image_url,
    product.image_urls,
    CASE
      WHEN publication.price_ars IS NOT NULL
        THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
      ELSE product.sale_price_ars
    END,
    CASE
      WHEN publication.price_ars IS NOT NULL
        AND publication.compare_at_price_ars > publication.price_ars
        THEN publication.price_ars
      WHEN publication.price_ars IS NULL THEN product.discount_price_ars
      ELSE NULL::numeric
    END,
    product.price_2x_ars,
    GREATEST(product.stock - COALESCE(store.reserva_local, 0), 0),
    product.content_ml,
    product.total_sold,
    COALESCE(publication.featured, product.featured, false),
    product.offer_expires_at,
    product.created_at,
    CASE WHEN COALESCE(product.content_ml, 0) > 0 THEN round(
      COALESCE(product.total_cost_usd, product.cost_usd, 0) / product.content_ml * 10
      * COALESCE(settings.exchange_rate, 0)
      * (1 + COALESCE(settings.decant_margin_10ml, 250) / 100.0)
    ) END,
    CASE WHEN COALESCE(product.content_ml, 0) > 0 THEN round(
      COALESCE(product.total_cost_usd, product.cost_usd, 0) / product.content_ml * 5
      * COALESCE(settings.exchange_rate, 0)
      * (1 + COALESCE(settings.decant_margin_5ml, 350) / 100.0)
    ) END,
    CASE WHEN COALESCE(product.content_ml, 0) > 0 THEN round(
      COALESCE(product.total_cost_usd, product.cost_usd, 0) / product.content_ml * 2.5
      * COALESCE(settings.exchange_rate, 0)
      * (1 + COALESCE(settings.decant_margin_2_5ml, 500) / 100.0)
    ) END,
    CASE
      WHEN COALESCE(product.offer_stacks_payment, store.payment_discount_stacks, false)
        THEN COALESCE(
          CASE WHEN publication.price_ars IS NOT NULL
            THEN publication.price_ars END,
          NULLIF(product.discount_price_ars, 0), product.sale_price_ars
        )
      ELSE CASE
        WHEN publication.price_ars IS NOT NULL
          THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
        ELSE product.sale_price_ars
      END
    END,
    public.store_promo_price(
      product.org_id,
      product.id,
      COALESCE(publication.category_slug, product.category),
      CASE
        WHEN publication.price_ars IS NOT NULL
          THEN COALESCE(publication.compare_at_price_ars, publication.price_ars)
        ELSE product.sale_price_ars
      END,
      NULL::numeric
    )
  FROM public.ecommerce_stores store
  JOIN public.products product ON product.org_id = store.org_id
  LEFT JOIN public.store_product_publications publication
    ON publication.store_id = store.id
   AND publication.product_id = product.id
  LEFT JOIN public.settings settings ON settings.org_id = product.org_id
  WHERE lower(store.slug) = lower(btrim(p_slug))
    AND store.is_active
    AND COALESCE(product.is_active, true)
    AND COALESCE(publication.visibility, 'published') = 'published'
    AND CASE
      WHEN publication.price_ars IS NOT NULL THEN publication.price_ars
      ELSE COALESCE(NULLIF(product.discount_price_ars, 0), product.sale_price_ars)
    END > 0
  ORDER BY
    COALESCE(publication.sort_order, 2147483647),
    COALESCE(publication.featured, product.featured, false) DESC,
    product.name ASC;
$function$;

CREATE OR REPLACE FUNCTION public.get_store_variants(p_slug text)
RETURNS TABLE (
  id uuid,
  product_id uuid,
  variant_name text,
  variant_type text,
  stock integer,
  price_override numeric,
  image_url text,
  sku text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    variant.id, variant.product_id, variant.variant_name, variant.variant_type,
    GREATEST(variant.stock - COALESCE(store.reserva_local, 0), 0), variant.price_override, variant.image_url, variant.sku
  FROM public.ecommerce_stores store
  JOIN public.product_variants variant ON variant.org_id = store.org_id
  JOIN public.products product ON product.id = variant.product_id
  LEFT JOIN public.store_product_publications publication
    ON publication.store_id = store.id
   AND publication.product_id = product.id
  WHERE lower(store.slug) = lower(btrim(p_slug))
    AND store.is_active
    AND variant.active
    AND COALESCE(product.is_active, true)
    AND COALESCE(publication.visibility, 'published') = 'published'
  ORDER BY variant.product_id, (variant.stock - COALESCE(store.reserva_local, 0) > 0) DESC, variant.variant_name;
$$;

-- 20260925002200 la dejó VOLATILE (llama al limitador de consultas, que escribe).
ALTER FUNCTION public.stock_en_vitrina(text, jsonb) VOLATILE;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-23'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN public.security_function_contracts c ON c.function_name = p.proname AND c.identity_arguments = pg_get_function_identity_arguments(p.oid)
 WHERE n.nspname = 'public'
   AND p.proname IN ('resolve_store_line', 'stock_en_vitrina', 'get_store_catalog_completo', 'get_store_catalog_inicio', 'get_store_catalog_products', 'get_store_variants')
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
