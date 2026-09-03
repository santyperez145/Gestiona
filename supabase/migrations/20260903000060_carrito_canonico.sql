-- F4 / carrito canónico de tienda.
--
-- La composición del carrito deja de existir sólo en localStorage. El token
-- del dispositivo sigue siendo una capacidad anónima, pero la base guarda un
-- snapshot saneado con `resolve_store_line`: precio y stock nunca llegan a ser
-- autoridad del navegador. Al iniciar sesión, el carrito se vincula a la ficha
-- `store_customers` de ESA tienda y puede continuar en otro dispositivo.
--
-- La orden no se vuelve a implementar: un wrapper llama al checkout canónico e
-- idempotente y, dentro de la misma transacción, enlaza/convierten la sesión.

ALTER TABLE public.ecommerce_cart_sessions
  ADD COLUMN IF NOT EXISTS store_customer_id uuid
    REFERENCES public.store_customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS cart_sessions_store_customer_idx
  ON public.ecommerce_cart_sessions(store_id, store_customer_id, updated_at DESC)
  WHERE store_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cart_sessions_one_active_customer
  ON public.ecommerce_cart_sessions(store_id, store_customer_id)
  WHERE store_customer_id IS NOT NULL AND status = 'active';

-- Convierte referencias no confiables en líneas resueltas por el Business Core.
-- Las líneas que quedaron sin stock se conservan como no disponibles para que
-- el cliente pueda explicar el ajuste en vez de hacerlas desaparecer.
CREATE OR REPLACE FUNCTION public.normalize_store_cart_items(
  p_org_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raw jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_quantity integer;
  v_quantity_text text;
  v_product_text text;
  v_variant_text text;
  v_key text;
  v_seen text[] := ARRAY[]::text[];
  v_resolved jsonb;
  v_product record;
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'El carrito debe ser una lista' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) > 100 THEN
    RAISE EXCEPTION 'El carrito supera el máximo de 100 líneas' USING ERRCODE = '22023';
  END IF;

  FOR v_raw IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_raw) <> 'object' THEN
      RAISE EXCEPTION 'Una línea del carrito no es válida' USING ERRCODE = '22023';
    END IF;

    v_product_text := btrim(COALESCE(v_raw->>'product_id', ''));
    v_variant_text := NULLIF(btrim(COALESCE(v_raw->>'variant_id', '')), '');
    v_quantity_text := btrim(COALESCE(v_raw->>'quantity', v_raw->>'qty', ''));

    IF v_product_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR (v_variant_text IS NOT NULL AND
           v_variant_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
       OR v_quantity_text !~ '^[0-9]{1,3}$' THEN
      RAISE EXCEPTION 'Una línea del carrito no es válida' USING ERRCODE = '22023';
    END IF;

    v_product_id := v_product_text::uuid;
    v_variant_id := v_variant_text::uuid;
    v_quantity := v_quantity_text::integer;
    IF v_quantity < 1 OR v_quantity > 999 THEN
      RAISE EXCEPTION 'La cantidad debe estar entre 1 y 999' USING ERRCODE = '22023';
    END IF;

    v_key := v_product_id::text || ':' || COALESCE(v_variant_id::text, 'base');
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION 'El carrito contiene una línea duplicada' USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_key);

    v_resolved := public.resolve_store_line(
      p_org_id, v_product_id, v_variant_id, v_quantity, NULL);

    IF COALESCE((v_resolved->>'ok')::boolean, false) THEN
      v_items := v_items || jsonb_build_array(
        (v_resolved->'line') || jsonb_build_object('available', true));
      CONTINUE;
    END IF;

    SELECT
      p.name,
      p.brand,
      CASE WHEN v_variant_id IS NULL THEN p.image_url ELSE COALESCE(pv.image_url, p.image_url) END AS image_url,
      CASE WHEN v_variant_id IS NULL THEN p.stock ELSE COALESCE(pv.stock, 0) END AS stock,
      pv.variant_name
    INTO v_product
    FROM public.products p
    LEFT JOIN public.product_variants pv
      ON pv.id = v_variant_id AND pv.product_id = p.id AND pv.org_id = p.org_id AND pv.active
    WHERE p.id = v_product_id AND p.org_id = p_org_id;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'variant_id', v_variant_id,
      'name', CASE
        WHEN v_product.name IS NULL THEN 'Producto no disponible'
        WHEN v_variant_id IS NOT NULL AND v_product.variant_name IS NOT NULL
          THEN v_product.name || ' — ' || v_product.variant_name
        ELSE v_product.name
      END,
      'brand', v_product.brand,
      'quantity', v_quantity,
      'unit_price', 0,
      'total', 0,
      'image_url', v_product.image_url,
      'available', false,
      'available_quantity', COALESCE(v_product.stock, 0),
      'reason', COALESCE(v_resolved->>'error', 'El producto ya no está disponible')
    ));
  END LOOP;

  RETURN v_items;
END;
$$;

-- Devuelve sólo referencias y cantidad. El navegador reconstruye la vista con
-- el catálogo actual; nunca recibe email ni otro PII por conocer el token.
CREATE OR REPLACE FUNCTION public.get_store_cart(p_slug text, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store record;
  v_store_customer uuid;
  v_device record;
  v_account record;
  v_items jsonb := '[]'::jsonb;
  v_merged boolean := false;
BEGIN
  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores
  WHERE lower(slug) = lower(p_slug) AND is_active
  LIMIT 1;
  IF v_store.id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'items', '[]'::jsonb);
  END IF;

  -- Un `record` cuya rama SELECT no corre queda sin estructura en PL/pgSQL;
  -- inicializarlo evita que el comprador anónimo falle al leer `.id`.
  SELECT NULL::uuid AS id, '[]'::jsonb AS items, NULL::timestamptz AS updated_at
  INTO v_account;

  IF auth.uid() IS NOT NULL THEN
    SELECT id INTO v_store_customer
    FROM public.store_customers
    WHERE store_id = v_store.id AND user_id = auth.uid()
    LIMIT 1;
  END IF;

  SELECT cs.id, cs.items, cs.updated_at
  INTO v_device
  FROM public.ecommerce_cart_sessions cs
  WHERE cs.store_id = v_store.id
    AND cs.session_token = p_token
    AND cs.status IN ('active', 'abandoned')
    AND cs.expires_at > now()
    AND (cs.store_customer_id IS NULL OR cs.store_customer_id = v_store_customer)
  LIMIT 1;

  IF v_store_customer IS NOT NULL THEN
    SELECT cs.id, cs.items, cs.updated_at
    INTO v_account
    FROM public.ecommerce_cart_sessions cs
    WHERE cs.store_id = v_store.id
      AND cs.store_customer_id = v_store_customer
      AND cs.status = 'active'
      AND cs.expires_at > now()
    ORDER BY cs.updated_at DESC
    LIMIT 1;
  END IF;

  IF v_device.id IS NULL AND v_account.id IS NULL THEN
    RETURN jsonb_build_object('found', false, 'items', '[]'::jsonb);
  END IF;

  v_merged := v_device.id IS NOT NULL AND v_account.id IS NOT NULL
    AND v_device.id <> v_account.id;

  WITH raw AS (
    SELECT value AS item
    FROM jsonb_array_elements(COALESCE(v_device.items, '[]'::jsonb))
    UNION ALL
    SELECT value AS item
    FROM jsonb_array_elements(COALESCE(v_account.items, '[]'::jsonb))
    WHERE v_account.id IS DISTINCT FROM v_device.id
  ), valid AS (
    SELECT
      item->>'product_id' AS product_id,
      NULLIF(item->>'variant_id', '') AS variant_id,
      CASE
        WHEN COALESCE(item->>'quantity', item->>'qty', '') ~ '^[0-9]{1,3}$'
          THEN COALESCE(item->>'quantity', item->>'qty')::integer
        ELSE NULL
      END AS quantity
    FROM raw
    WHERE jsonb_typeof(item) = 'object'
  ), grouped AS (
    SELECT product_id, variant_id, greatest(1, least(999, max(quantity))) AS quantity
    FROM valid
    WHERE product_id IS NOT NULL AND quantity IS NOT NULL
    GROUP BY product_id, variant_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'product_id', product_id,
    'variant_id', variant_id,
    'quantity', quantity
  ) ORDER BY product_id, variant_id), '[]'::jsonb)
  INTO v_items
  FROM grouped;

  RETURN jsonb_build_object(
    'found', true,
    'items', v_items,
    'updated_at', greatest(v_device.updated_at, v_account.updated_at),
    'merged', v_merged,
    'source', CASE
      WHEN v_merged THEN 'merged'
      WHEN v_account.id IS NOT NULL THEN 'account'
      ELSE 'device'
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_store_cart_v2(
  p_slug text,
  p_token text,
  p_items jsonb,
  p_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store record;
  v_store_customer uuid;
  v_account_email text;
  v_email text;
  v_items jsonb;
  v_subtotal numeric := 0;
  v_device record;
  v_account record;
  v_target uuid;
  v_revision bigint;
  v_updated_at timestamptz;
  v_recovery text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 OR length(p_token) > 128
     OR p_token !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Token de carrito inválido' USING ERRCODE = '22023';
  END IF;

  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores
  WHERE lower(slug) = lower(p_slug) AND is_active
  LIMIT 1;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada o inactiva';
  END IF;

  SELECT NULL::uuid AS id INTO v_account;

  IF NOT public.rate_limit_publico('store_cart', p_slug, 120, interval '1 minute') THEN
    RAISE EXCEPTION 'Demasiadas actualizaciones de carrito. Esperá un minuto.'
      USING ERRCODE = '53400';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT id, email INTO v_store_customer, v_account_email
    FROM public.store_customers
    WHERE store_id = v_store.id AND user_id = auth.uid()
    LIMIT 1;
  END IF;
  IF v_store_customer IS NOT NULL THEN
    -- Serializa dos dispositivos de la misma cuenta sin un lock global.
    PERFORM id FROM public.store_customers WHERE id = v_store_customer FOR UPDATE;
  END IF;

  v_email := NULLIF(lower(btrim(COALESCE(p_email, v_account_email, ''))), '');
  IF v_email IS NOT NULL AND (length(v_email) > 254 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
    v_email := NULL;
  END IF;

  v_items := public.normalize_store_cart_items(v_store.org_id, p_items);
  SELECT COALESCE(sum((line->>'total')::numeric), 0)
  INTO v_subtotal
  FROM jsonb_array_elements(v_items) line
  WHERE COALESCE((line->>'available')::boolean, false);

  SELECT cs.id, cs.status, cs.store_customer_id
  INTO v_device
  FROM public.ecommerce_cart_sessions cs
  WHERE cs.store_id = v_store.id AND cs.session_token = p_token
  LIMIT 1
  FOR UPDATE;

  IF v_device.id IS NOT NULL AND v_device.store_customer_id IS NOT NULL
     AND v_device.store_customer_id IS DISTINCT FROM v_store_customer THEN
    RAISE EXCEPTION 'La sesión de carrito pertenece a otra cuenta' USING ERRCODE = '42501';
  END IF;

  IF v_store_customer IS NOT NULL THEN
    SELECT cs.id INTO v_account
    FROM public.ecommerce_cart_sessions cs
    WHERE cs.store_id = v_store.id
      AND cs.store_customer_id = v_store_customer
      AND cs.status = 'active'
    ORDER BY cs.updated_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  -- Vaciar el carrito vacía también el carrito activo de la cuenta. Una orden
  -- convertida nunca vuelve a abandoned por un efecto tardío del navegador.
  IF jsonb_array_length(v_items) = 0 THEN
    UPDATE public.ecommerce_cart_sessions
    SET status = 'abandoned', items = '[]'::jsonb, subtotal = 0, total = 0,
        abandoned_email_sent = false, revision = revision + 1, updated_at = now()
    WHERE store_id = v_store.id
      AND status <> 'converted'
      AND (id = v_device.id OR id = v_account.id);
    RETURN jsonb_build_object('ok', true, 'empty', true, 'items', '[]'::jsonb);
  END IF;

  -- El token puede haber cerrado una compra anterior. Se preserva esa sesión
  -- para el embudo y se libera el token para el nuevo carrito.
  IF v_device.id IS NOT NULL AND v_device.status = 'converted' THEN
    UPDATE public.ecommerce_cart_sessions
    SET session_token = 'closed-' || id::text
    WHERE id = v_device.id;
    v_device.id := NULL;
  END IF;

  v_recovery := replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '');

  IF v_device.id IS NOT NULL THEN
    IF v_account.id IS NOT NULL AND v_account.id <> v_device.id THEN
      UPDATE public.ecommerce_cart_sessions
      SET status = 'abandoned', updated_at = now()
      WHERE id = v_account.id;
    END IF;

    UPDATE public.ecommerce_cart_sessions
    SET store_customer_id = COALESCE(v_store_customer, store_customer_id),
        customer_email = COALESCE(v_email, customer_email),
        items = v_items,
        subtotal = v_subtotal,
        total = v_subtotal,
        status = 'active',
        recovery_token = COALESCE(recovery_token, v_recovery),
        abandoned_email_sent = false,
        expires_at = now() + interval '30 days',
        revision = revision + 1,
        updated_at = now()
    WHERE id = v_device.id
    RETURNING id, revision, updated_at INTO v_target, v_revision, v_updated_at;
  ELSIF v_account.id IS NOT NULL THEN
    UPDATE public.ecommerce_cart_sessions
    SET session_token = p_token,
        customer_email = COALESCE(v_email, customer_email),
        items = v_items,
        subtotal = v_subtotal,
        total = v_subtotal,
        recovery_token = COALESCE(recovery_token, v_recovery),
        abandoned_email_sent = false,
        expires_at = now() + interval '30 days',
        revision = revision + 1,
        updated_at = now()
    WHERE id = v_account.id
    RETURNING id, revision, updated_at INTO v_target, v_revision, v_updated_at;
  ELSE
    INSERT INTO public.ecommerce_cart_sessions (
      org_id, store_id, session_token, store_customer_id, customer_email,
      items, subtotal, total, status, recovery_token, expires_at, revision)
    VALUES (
      v_store.org_id, v_store.id, p_token, v_store_customer, v_email,
      v_items, v_subtotal, v_subtotal, 'active', v_recovery,
      now() + interval '30 days', 1)
    RETURNING id, revision, updated_at INTO v_target, v_revision, v_updated_at;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_target,
    'items', v_items,
    'subtotal', v_subtotal,
    'revision', v_revision,
    'updated_at', v_updated_at,
    'account_cart', v_store_customer IS NOT NULL
  );
END;
$$;

-- Checkout canónico + vínculo de carrito, sin duplicar la lógica de orden.
CREATE OR REPLACE FUNCTION public.create_store_order_from_cart_idem(
  p_slug text,
  p_items jsonb,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text DEFAULT NULL,
  p_shipping jsonb DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_coupon text DEFAULT NULL,
  p_shipping_option text DEFAULT NULL,
  p_fiscal jsonb DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_cart_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_store record;
  v_store_customer uuid;
  v_cart uuid;
  v_order_number text;
BEGIN
  v_result := public.create_store_order_idem(
    p_slug, p_items, p_customer_name, p_customer_email, p_customer_phone,
    p_shipping, p_payment_method, p_notes, p_coupon, p_shipping_option,
    p_fiscal, p_idempotency_key);

  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores
  WHERE lower(slug) = lower(p_slug) AND is_active
  LIMIT 1;

  IF auth.uid() IS NOT NULL THEN
    SELECT id INTO v_store_customer
    FROM public.store_customers
    WHERE store_id = v_store.id AND user_id = auth.uid()
    LIMIT 1;
  END IF;

  SELECT cs.id INTO v_cart
  FROM public.ecommerce_cart_sessions cs
  WHERE cs.store_id = v_store.id
    AND cs.status <> 'converted'
    AND (
      (p_cart_token IS NOT NULL AND cs.session_token = p_cart_token
        AND (cs.store_customer_id IS NULL OR cs.store_customer_id = v_store_customer)
        AND (cs.customer_email IS NULL OR
             lower(cs.customer_email) = lower(btrim(COALESCE(p_customer_email, '')))))
      OR (v_store_customer IS NOT NULL AND cs.store_customer_id = v_store_customer)
    )
  ORDER BY (cs.session_token = p_cart_token) DESC, cs.updated_at DESC
  LIMIT 1
  FOR UPDATE;

  v_order_number := v_result->>'order_number';
  IF v_cart IS NOT NULL AND v_order_number IS NOT NULL THEN
    UPDATE public.ecommerce_cart_sessions
    SET status = 'converted', converted_at = now(), revision = revision + 1,
        updated_at = now()
    WHERE id = v_cart;

    UPDATE public.ecommerce_orders
    SET cart_session_id = v_cart
    WHERE store_id = v_store.id
      AND order_number = v_order_number
      AND (cart_session_id IS NULL OR cart_session_id = v_cart);
  END IF;

  RETURN v_result || jsonb_build_object('cart_linked', v_cart IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_store_cart_items(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_store_cart(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_store_cart_v2(text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_store_order_from_cart_idem(
  text, jsonb, text, text, text, jsonb, text, text, text, text, jsonb, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_store_cart(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_store_cart_v2(text, text, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_store_order_from_cart_idem(
  text, jsonb, text, text, text, jsonb, text, text, text, text, jsonb, text, text
) TO anon, authenticated;

COMMENT ON FUNCTION public.get_store_cart(text, text) IS
  'Carrito activo por capacidad de dispositivo o cuenta de comprador, sin PII.';
COMMENT ON FUNCTION public.save_store_cart_v2(text, text, jsonb, text) IS
  'Persiste referencias del carrito y resuelve el snapshot contra precio/stock del Business Core.';
COMMENT ON FUNCTION public.create_store_order_from_cart_idem(
  text, jsonb, text, text, text, jsonb, text, text, text, text, jsonb, text, text
) IS
  'Delega en el checkout idempotente y enlaza la sesión de carrito a la orden en la misma transacción.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ecommerce_cart_sessions'
      AND column_name = 'store_customer_id'
  ) THEN
    RAISE EXCEPTION 'Verificación falló: falta ecommerce_cart_sessions.store_customer_id';
  END IF;
  IF to_regprocedure('public.get_store_cart(text,text)') IS NULL
     OR to_regprocedure('public.save_store_cart_v2(text,text,jsonb,text)') IS NULL
     OR to_regprocedure('public.create_store_order_from_cart_idem(text,jsonb,text,text,text,jsonb,text,text,text,text,jsonb,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Verificación falló: faltan RPCs del carrito canónico';
  END IF;
END;
$$;
