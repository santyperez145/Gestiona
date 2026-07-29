-- Tienda online: acceso público a lo que necesita un comprador anónimo.
--
-- `products` ya tiene lectura pública (la usa el catálogo), pero
-- `ecommerce_categories`, `product_perfume_details` y `ecommerce_orders` son
-- solo para miembros de la organización: un visitante no podía navegar la
-- tienda ni comprar.
--
-- En vez de abrir esas tablas con policies permisivas, se exponen RPCs
-- security-definer acotados a una tienda ACTIVA. Idempotente.

-- ── Categorías de la tienda ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_store_categories(p_slug text)
RETURNS TABLE (id uuid, name text, slug text, description text, image_url text, sort_order int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.id, c.name, c.slug, c.description, c.image_url, c.sort_order
  FROM public.ecommerce_categories c
  JOIN public.ecommerce_stores s ON s.id = c.store_id
  WHERE lower(s.slug) = lower(p_slug) AND s.is_active AND c.is_active
  ORDER BY c.sort_order, c.name;
$$;

-- ── Ficha olfativa para la página de producto ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_store_perfume_details(p_slug text)
RETURNS TABLE (
  product_id uuid, familia_olfativa text, duracion text, proyeccion text,
  notas_salida text[], notas_corazon text[], notas_fondo text[],
  estacion text[], ocasion text[], inspiracion text, modelo text, edad_recomendada text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT d.product_id, d.familia_olfativa, d.duracion, d.proyeccion,
         d.notas_salida, d.notas_corazon, d.notas_fondo,
         d.estacion, d.ocasion, d.inspiracion, d.modelo, d.edad_recomendada
  FROM public.product_perfume_details d
  JOIN public.ecommerce_stores s ON s.org_id = d.org_id
  WHERE lower(s.slug) = lower(p_slug) AND s.is_active;
$$;

-- ── Alta de orden desde la tienda ─────────────────────────────────────────
--
-- El precio NUNCA se toma del navegador: se relee de `products` por cada ítem.
-- Si no, cualquiera podría mandar un precio de $1 desde la consola.
CREATE OR REPLACE FUNCTION public.create_store_order(
  p_slug           text,
  p_items          jsonb,   -- [{product_id, quantity}]
  p_customer_name  text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping       jsonb,   -- {calle, ciudad, provincia, cp, notas}
  p_payment_method text,
  p_notes          text DEFAULT NULL
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
BEGIN
  SELECT s.id, s.org_id, s.name, s.shipping_cost, s.free_shipping_above, s.payment_methods
  INTO v_store
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug) AND s.is_active;

  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada o inactiva';
  END IF;

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

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::int, 1));

    SELECT id, name, brand, stock, sale_price_ars, discount_price_ars, image_url
    INTO v_prod
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid AND org_id = v_store.org_id;

    IF v_prod.id IS NULL THEN
      RAISE EXCEPTION 'Un producto del carrito ya no está disponible';
    END IF;
    IF v_prod.stock < v_qty THEN
      RAISE EXCEPTION 'Sin stock suficiente de %  (quedan %)', v_prod.name, v_prod.stock;
    END IF;

    -- Precio autoritativo del servidor.
    v_unit := COALESCE(NULLIF(v_prod.discount_price_ars, 0), v_prod.sale_price_ars);
    v_subtotal := v_subtotal + v_unit * v_qty;

    v_items := v_items || jsonb_build_object(
      'product_id', v_prod.id, 'name', v_prod.name, 'brand', v_prod.brand,
      'quantity', v_qty, 'unit_price', v_unit, 'total', v_unit * v_qty,
      'image_url', v_prod.image_url
    );
  END LOOP;

  v_shipping := COALESCE(v_store.shipping_cost, 0);
  IF v_store.free_shipping_above IS NOT NULL
     AND v_store.free_shipping_above > 0
     AND v_subtotal >= v_store.free_shipping_above THEN
    v_shipping := 0;
  END IF;

  v_order_number := 'TN-' || to_char(now(), 'YYYYMMDD') || '-' ||
                    lpad((floor(random() * 10000))::text, 4, '0');

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_name, customer_email, customer_phone,
    items, subtotal, shipping_cost, discount_amount, tax_amount, total,
    payment_method, payment_status, fulfillment_status,
    shipping_address, billing_address, notes
  ) VALUES (
    v_store.org_id, v_store.id, v_order_number,
    btrim(p_customer_name), lower(btrim(p_customer_email)), p_customer_phone,
    v_items, v_subtotal, v_shipping, 0, 0, v_subtotal + v_shipping,
    p_payment_method, 'pending', 'pending',
    COALESCE(p_shipping, '{}'::jsonb), COALESCE(p_shipping, '{}'::jsonb), p_notes
  )
  RETURNING id INTO v_order_id;

  -- El stock se descuenta recién cuando el pago se confirma desde el panel:
  -- reservarlo acá dejaría productos bloqueados por carritos abandonados.

  RETURN jsonb_build_object(
    'order_number', v_order_number,
    'total', v_subtotal + v_shipping,
    'subtotal', v_subtotal,
    'shipping', v_shipping
  );
END;
$$;

-- ── Consulta de una orden por su número (página de confirmación) ───────────
CREATE OR REPLACE FUNCTION public.get_store_order(p_slug text, p_order_number text)
RETURNS TABLE (
  order_number text, customer_name text, customer_email text,
  items jsonb, subtotal numeric, shipping_cost numeric, total numeric,
  payment_method text, payment_status text, fulfillment_status text,
  shipping_address jsonb, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT o.order_number, o.customer_name, o.customer_email,
         o.items, o.subtotal, o.shipping_cost, o.total,
         o.payment_method, o.payment_status, o.fulfillment_status,
         o.shipping_address, o.created_at
  FROM public.ecommerce_orders o
  JOIN public.ecommerce_stores s ON s.id = o.store_id
  WHERE lower(s.slug) = lower(p_slug)
    AND o.order_number = p_order_number
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_store_categories(text)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_store_perfume_details(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_store_order(text, jsonb, text, text, text, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_store_order(text, text)     FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_store_categories(text)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_store_perfume_details(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_store_order(text, jsonb, text, text, text, jsonb, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_store_order(text, text)     TO anon, authenticated;
