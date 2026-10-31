-- Preventa: vender lo que todavía no llegó (2026-10-30).
--
-- Un importador vende el contenedor antes de que llegue. La tienda frenaba la
-- compra apenas el disponible llegaba a cero («Sin stock disponible»).
--
--   · El producto declara hasta cuántas unidades se venden sin stock
--     (`preventa_cupo`). Cuándo llegan es su «Próximo ingreso»
--     (`expected_restock_at`, el mismo dato que ya cargaba): un solo dato,
--     no dos fechas que se desacomodan. Sólo productos sin variantes.
--   · Sin fecha de ingreso no hay preventa: borrar la fecha la apaga.
--   · El disponible puede bajar de cero hasta el cupo. Con stock se vende
--     primero lo que hay; el stock negativo es lo que se debe entregar cuando
--     llegue la mercadería, y al cargarla vuelve a cuadrar.
--   · La preventa vence sola pasado el día de llegada: si el contenedor se
--     atrasa, el comercio corre la fecha. Nunca se vende de más.
--   · Cada línea del pedido dice cuántas unidades son de preventa y cuándo
--     llegan (`preventa` en el ítem), y la tienda lo muestra antes de pagar.
--   · `stock_negativo` (que tiene que quedar vacía) no cuenta lo vendido en
--     una preventa vigente; vencida la fecha con faltantes, vuelve a aparecer.
--   · `get_store_preventas`: qué productos de la tienda están en preventa,
--     cuándo llegan y cuánto se puede comprar.

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS preventa_cupo numeric(12,3) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_preventa_cupo_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_preventa_cupo_check CHECK (preventa_cupo >= 0);
  END IF;
END $$;
COMMENT ON COLUMN public.products.preventa_cupo IS
  'Unidades que se pueden vender sin stock hasta el próximo ingreso (expected_restock_at); 0: sin preventa.';

-- ── Cuánto puede bajar de cero el disponible ────────────────────────────
CREATE OR REPLACE FUNCTION public.cupo_de_preventa(p_product_id uuid, p_variant_id uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE((
    SELECT p.preventa_cupo
      FROM public.products p
     WHERE p.id = p_product_id
       AND p_variant_id IS NULL
       AND p.preventa_cupo > 0
       AND p.expected_restock_at >= public.hoy_ar()
       AND NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND v.active)
  ), 0);
$fn$;
REVOKE ALL ON FUNCTION public.cupo_de_preventa(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── Lo vendido en preventa vigente no es un faltante ────────────────────
CREATE OR REPLACE VIEW public.stock_negativo WITH (security_invoker=true) AS
 SELECT org_id,
    id AS product_id,
    name,
    stock
   FROM products p
  WHERE stock < 0
    AND NOT (p.preventa_cupo > 0 AND p.expected_restock_at >= public.hoy_ar() AND -p.stock <= p.preventa_cupo);
COMMENT ON VIEW public.stock_negativo IS
  'Productos con stock negativo. Tiene que estar vacía: una fila es un movimiento de más o una venta sin respaldo. Lo vendido en una preventa vigente (dentro del cupo) no cuenta (20261030001900).';

-- ── La tienda sabe qué está en preventa ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_store_preventas(p_slug text)
RETURNS TABLE(product_id uuid, llega date, vendible numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH tienda AS (
    SELECT s.id, s.org_id, COALESCE(s.reserva_local, 0) AS reserva_local
      FROM public.ecommerce_stores s
     WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active
  )
  SELECT p.id, p.expected_restock_at,
         GREATEST(public.stock_disponible(p.id, NULL) - t.reserva_local + p.preventa_cupo, 0)
    FROM tienda t
    JOIN public.products p ON p.org_id = t.org_id
    LEFT JOIN public.store_product_publications publication
      ON publication.store_id = t.id AND publication.product_id = p.id
   WHERE COALESCE(p.is_active, true)
     AND COALESCE(publication.visibility, 'published') = 'published'
     AND p.preventa_cupo > 0
     AND p.expected_restock_at >= public.hoy_ar()
     AND NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND v.active);
$fn$;
REVOKE ALL ON FUNCTION public.get_store_preventas(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_preventas(text) TO anon, authenticated;

-- ── El pedido acepta la preventa, en la línea y en la reserva ───────────

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
  v_mayorista numeric;
  v_base_mayorista numeric;
  v_cupo numeric := 0;
  v_preventa numeric := 0;
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
    product.offer_stacks_payment, COALESCE(product.is_active, true) AS active,
    product.expected_restock_at AS preventa_llega
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
    -- Venta mayorista (20261023000600): el comprador aprobado paga su lista.
    -- NULL si la lista no cambia el precio: rige el minorista con sus promos.
    IF v_store_id IS NOT NULL THEN
      v_base_mayorista := COALESCE(v_publication.price_ars, v_product.sale_price_ars);
      v_mayorista := public.precio_lista_cliente(
        public.cliente_mayorista_de_tienda(v_store_id), p_product_id, p_qty, v_base_mayorista
      );
      IF v_mayorista IS NOT NULL THEN
        v_unit := v_mayorista;
      END IF;
    END IF;
    v_disp := public.stock_disponible(p_product_id, NULL) - v_reserva;
    -- Preventa (20261030001900): el disponible puede bajar de cero hasta el cupo.
    v_cupo := public.cupo_de_preventa(p_product_id, NULL);
    IF v_disp + v_cupo < p_qty THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', format(
          'Sin stock disponible de %s: quedan %s y se piden %s',
          v_product.name, GREATEST(v_disp + v_cupo, 0), p_qty
        ),
        'available_quantity', GREATEST(v_disp + v_cupo, 0)
      );
    END IF;
    -- Con stock se vende primero lo que hay; el resto es preventa.
    v_preventa := GREATEST(p_qty - GREATEST(v_disp, 0), 0);
    RETURN jsonb_build_object('ok', true, 'line', jsonb_build_object(
      'product_id', v_product.id,
      'variant_id', NULL,
      'name', v_product.name,
      'brand', v_product.brand,
      'quantity', p_qty,
      'unit_price', v_unit,
      'list_price', CASE
        WHEN v_mayorista IS NOT NULL THEN v_base_mayorista
        WHEN v_stacks THEN v_unit
        ELSE v_list
      END,
      'mayorista', v_mayorista IS NOT NULL,
      'total', v_unit * p_qty,
      'image_url', v_product.image_url,
      'available_quantity', GREATEST(v_disp + v_cupo, 0)
    ) || CASE WHEN v_preventa > 0
         THEN jsonb_build_object('preventa', jsonb_build_object(
           'cantidad', v_preventa, 'llega', v_product.preventa_llega))
         ELSE '{}'::jsonb END);
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
  IF v_store_id IS NOT NULL THEN
    v_base_mayorista := COALESCE(NULLIF(v_variant.price_override, 0), v_publication.price_ars, v_product.sale_price_ars);
    v_mayorista := public.precio_lista_cliente(
      public.cliente_mayorista_de_tienda(v_store_id), p_product_id, p_qty, v_base_mayorista
    );
    IF v_mayorista IS NOT NULL THEN
      v_unit := v_mayorista;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'line', jsonb_build_object(
    'product_id', v_product.id,
    'variant_id', v_variant.id,
    'name', v_product.name || ' — ' || v_variant.variant_name,
    'brand', v_product.brand,
    'quantity', p_qty,
    'unit_price', v_unit,
    'mayorista', v_mayorista IS NOT NULL,
    'list_price', CASE
      WHEN v_mayorista IS NOT NULL THEN v_base_mayorista
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

CREATE OR REPLACE FUNCTION public.trg_reservar_stock_de_orden()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item      jsonb;
  v_pid       uuid;
  v_vid       uuid;
  v_qty       numeric;
  v_disp      numeric;
  v_nombre    text;
  v_minutos   int := 30;
BEGIN
  IF NEW.payment_status = 'paid' THEN RETURN NEW; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) LOOP
    v_pid := NULLIF(v_item->>'product_id', '')::uuid;
    v_vid := NULLIF(v_item->>'variant_id', '')::uuid;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
    IF v_pid IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    -- Serializa el producto aunque cada tienda despache desde una sucursal
    -- distinta: una reserva global histórica puede competir con cualquiera.
    PERFORM 1 FROM public.products WHERE id = v_pid FOR UPDATE;

    v_disp := public.stock_disponible(v_pid, v_vid, NEW.fulfillment_location_id);
    -- Preventa (20261030001900): el disponible puede bajar de cero hasta el cupo.
    IF v_disp + public.cupo_de_preventa(v_pid, v_vid) < v_qty THEN
      SELECT name INTO v_nombre FROM public.products WHERE id = v_pid;
      RAISE EXCEPTION 'Sin stock disponible de % en el depósito de despacho: quedan % y se piden %',
        COALESCE(v_nombre, 'el producto'), GREATEST(v_disp, 0), v_qty
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    INSERT INTO public.stock_reservations (
      org_id, order_id, product_id, variant_id, location_id, quantity,
      status, expires_at, customer_name, notes
    ) VALUES (
      NEW.org_id, NEW.id, v_pid, v_vid, NEW.fulfillment_location_id, v_qty,
      'active', now() + (v_minutos || ' minutes')::interval,
      NULLIF(NEW.customer_name, ''),
      format('Orden %s', NEW.order_number)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

WITH c(function_name, audience, rationale) AS (VALUES
  ('cupo_de_preventa', 'security_helper', 'Interna: cuántas unidades puede bajar de cero el disponible de un producto en preventa vigente.'),
  ('get_store_preventas', 'public_storefront', 'Expone qué productos publicados de la tienda están en preventa, cuándo llegan y cuánto se puede comprar.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

-- Las redefinidas que ya tenían contrato: misma audiencia, huella nueva.
UPDATE public.security_function_contracts sc
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
 WHERE sc.function_name = p.proname
   AND sc.identity_arguments = pg_get_function_identity_arguments(p.oid)
   AND p.proname IN ('resolve_store_line', 'trg_reservar_stock_de_orden');

COMMIT;
