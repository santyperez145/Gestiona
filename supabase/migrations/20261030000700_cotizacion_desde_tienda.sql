-- Pedir cotización desde la tienda (2026-10-30). Venta mayorista online.
--
-- Un comprador de empresa (una obra, un comercio que revende) no compra con
-- el carrito: arma la lista y pide precio. Hasta hoy lo hacía por WhatsApp y
-- el comercio tipeaba el presupuesto a mano. Tiendanube no lo tiene nativo.
--
--   1. `solicitar_cotizacion_tienda`: en una tienda con venta mayorista
--      (mixta o sólo mayoristas), el comprador logueado manda su carrito
--      (productos publicados, cantidades libres de stock: es un pedido de
--      precio) y nace un presupuesto en el panel con su número, sus ítems a
--      su precio de hoy (su lista mayorista si la tiene) y el aviso al dueño.
--      Hasta 5 pedidos abiertos por comprador y tienda por día.
--   2. El comercio lo ajusta y lo manda con el link de pago de siempre
--      (payment_links → el webhook registra la venta).
--   3. `mis_cotizaciones_tienda`: el comprador ve en Mi cuenta cada pedido,
--      su estado y, cuando el comercio lo genera, el link para pagarlo.

BEGIN;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'panel',
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.ecommerce_stores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS solicitado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_origen_check') THEN
    ALTER TABLE public.quotes ADD CONSTRAINT quotes_origen_check CHECK (origen IN ('panel', 'tienda'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS quotes_solicitado_idx ON public.quotes(store_id, solicitado_por, created_at DESC)
  WHERE origen = 'tienda';
COMMENT ON COLUMN public.quotes.origen IS
  'panel: lo armó el comercio. tienda: lo pidió un comprador desde la tienda (solicitar_cotizacion_tienda).';

CREATE OR REPLACE FUNCTION public.solicitar_cotizacion_tienda(p_slug text, p_items jsonb, p_datos jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_store record;
  v_comprador record;
  v_email text;
  v_nombre text;
  v_telefono text;
  v_mensaje text := NULLIF(left(btrim(COALESCE(p_datos->>'mensaje', '')), 1000), '');
  v_cliente uuid;
  v_item jsonb;
  v_producto record;
  v_var_id uuid;
  v_var_nombre text;
  v_var_sku text;
  v_var_precio numeric;
  v_cant numeric;
  v_base numeric;
  v_precio numeric;
  v_linea numeric;
  v_sub numeric := 0;
  v_salida jsonb := '[]'::jsonb;
  v_numero text;
  v_id uuid;
  v_n integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Ingresá con tu cuenta para pedir una cotización' USING ERRCODE = '42501';
  END IF;
  SELECT s.id, s.org_id, s.name, COALESCE(s.mayorista_modo, 'off') AS mayorista_modo INTO v_store
    FROM public.ecommerce_stores s
   WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active LIMIT 1;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'La tienda no está disponible' USING ERRCODE = '22023';
  END IF;
  -- Lo decide la base, no el botón: sólo las tiendas con venta mayorista
  -- reciben pedidos de cotización.
  IF v_store.mayorista_modo = 'off' THEN
    RAISE EXCEPTION 'Esta tienda no recibe pedidos de cotización' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Agregá al menos un producto' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Una cotización puede tener hasta 100 productos' USING ERRCODE = '22023';
  END IF;

  -- Un pedido de precio por vez: sin cola de pedidos repetidos.
  PERFORM pg_advisory_xact_lock(hashtextextended('cotizacion_tienda:' || v_store.id::text || ':' || auth.uid()::text, 0));
  IF (SELECT count(*) FROM public.quotes q
       WHERE q.store_id = v_store.id AND q.solicitado_por = auth.uid() AND q.origen = 'tienda'
         AND q.status = 'draft' AND q.created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'Ya tenés 5 pedidos de cotización abiertos en esta tienda. Esperá la respuesta o escribinos.'
      USING ERRCODE = '22023';
  END IF;

  SELECT sc.email, sc.name, sc.phone INTO v_comprador FROM public.store_customers sc
   WHERE sc.store_id = v_store.id AND sc.user_id = auth.uid() LIMIT 1;
  v_email := lower(COALESCE(NULLIF(btrim(v_comprador.email), ''), (SELECT u.email FROM auth.users u WHERE u.id = auth.uid())));
  v_nombre := COALESCE(NULLIF(left(btrim(COALESCE(p_datos->>'nombre', '')), 200), ''), NULLIF(btrim(v_comprador.name), ''), v_email);
  v_telefono := COALESCE(NULLIF(left(btrim(COALESCE(p_datos->>'telefono', '')), 40), ''), NULLIF(btrim(v_comprador.phone), ''));
  v_cliente := public.cliente_del_comprador(v_store.id);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_n := v_n + 1;
    IF COALESCE(v_item->>'quantity', '') !~ '^\s*\d+(\.\d{1,3})?\s*$' THEN
      RAISE EXCEPTION 'Producto %: la cantidad no es válida', v_n USING ERRCODE = '22023';
    END IF;
    v_cant := (v_item->>'quantity')::numeric;
    IF v_cant <= 0 OR v_cant > 100000 THEN
      RAISE EXCEPTION 'Producto %: la cantidad no es válida', v_n USING ERRCODE = '22023';
    END IF;

    SELECT p.id, p.name, p.sku, p.unidad_medida, p.sale_price_ars, p.discount_price_ars,
           publication.price_ars AS precio_tienda
      INTO v_producto
      FROM public.products p
      LEFT JOIN public.store_product_publications publication
        ON publication.store_id = v_store.id AND publication.product_id = p.id
     WHERE p.id = NULLIF(v_item->>'product_id', '')::uuid AND p.org_id = v_store.org_id
       AND COALESCE(p.is_active, true)
       AND COALESCE(publication.visibility, 'published') = 'published';
    IF v_producto.id IS NULL THEN
      RAISE EXCEPTION 'Un producto ya no está publicado en la tienda' USING ERRCODE = '22023';
    END IF;

    v_var_id := NULL; v_var_nombre := NULL; v_var_sku := NULL; v_var_precio := NULL;
    IF NULLIF(v_item->>'variant_id', '') IS NOT NULL THEN
      SELECT v.id, v.variant_name, v.sku, v.price_override INTO v_var_id, v_var_nombre, v_var_sku, v_var_precio
        FROM public.product_variants v
       WHERE v.id = (v_item->>'variant_id')::uuid AND v.product_id = v_producto.id;
      IF v_var_id IS NULL THEN
        RAISE EXCEPTION 'La variante elegida de % ya no está disponible', v_producto.name USING ERRCODE = '22023';
      END IF;
    END IF;

    -- El precio de hoy para este comprador: su lista mayorista si la tiene,
    -- si no el de la tienda. Es un punto de partida: el comercio lo ajusta.
    v_base := COALESCE(NULLIF(v_var_precio, 0), v_producto.precio_tienda, v_producto.sale_price_ars);
    v_precio := NULL;
    IF v_var_id IS NULL THEN
      v_precio := public.precio_lista_cliente(public.cliente_mayorista_de_tienda(v_store.id), v_producto.id,
                                             GREATEST(ceil(v_cant)::integer, 1), v_base);
    END IF;
    v_precio := round(COALESCE(v_precio,
      CASE WHEN v_var_id IS NULL AND v_producto.precio_tienda IS NULL
           THEN COALESCE(NULLIF(v_producto.discount_price_ars, 0), v_producto.sale_price_ars)
           ELSE v_base END, 0), 2);

    v_linea := round(v_cant * v_precio, 2);
    v_sub := v_sub + v_linea;
    v_salida := v_salida || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'description', concat_ws(' · ', v_producto.name, v_var_nombre),
      'qty', round(v_cant, 3), 'unitPrice', v_precio, 'total', v_linea,
      'productId', v_producto.id, 'variantId', v_var_id,
      'sku', COALESCE(v_var_sku, v_producto.sku),
      'unidad', NULLIF(v_producto.unidad_medida, 'unidad'))));
  END LOOP;

  v_numero := public.next_quote_number(v_store.org_id);
  INSERT INTO public.quotes (org_id, quote_number, customer_name, customer_id, customer_email, customer_phone,
                             items, subtotal, discount_amount, total, status, valid_until, notes, created_by,
                             origen, store_id, solicitado_por)
  VALUES (v_store.org_id, v_numero, v_nombre, v_cliente, v_email, v_telefono,
          v_salida, v_sub, 0, v_sub, 'draft', NULL,
          concat_ws(E'\n', 'Pedido desde la tienda ' || v_store.name || '.', v_mensaje), NULL,
          'tienda', v_store.id, auth.uid())
  RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.notifications (user_id, org_id, title, message, type, entity_type, entity_id)
    SELECT m.user_id, v_store.org_id, 'Pedido de cotización',
           format('%s pidió precio por %s producto(s) — %s', v_nombre, v_n, v_numero),
           'ecommerce', 'quote', v_id::text
      FROM public.memberships m
     WHERE m.org_id = v_store.org_id AND m.role = 'owner'
     ORDER BY m.joined_at LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    -- El aviso no frena el pedido: el presupuesto ya quedó en el panel.
    RAISE WARNING 'solicitar_cotizacion_tienda: no se pudo avisar (%)', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'quote_number', v_numero, 'items', v_n, 'total', v_sub);
END;
$fn$;
REVOKE ALL ON FUNCTION public.solicitar_cotizacion_tienda(text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_cotizacion_tienda(text, jsonb, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mis_cotizaciones_tienda(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(jsonb_agg(fila ORDER BY (fila->>'created_at') DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'quote_number', q.quote_number,
        'estado', CASE
          WHEN q.converted_at IS NOT NULL OR EXISTS (SELECT 1 FROM public.payment_links l WHERE l.quote_id = q.id AND l.status = 'paid') THEN 'pagada'
          WHEN q.status = 'rejected' THEN 'rechazada'
          WHEN q.valid_until IS NOT NULL AND q.valid_until < (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date THEN 'vencida'
          WHEN q.status IN ('sent', 'accepted') THEN 'respondida'
          ELSE 'pendiente' END,
        -- El importe recién cuando el comercio respondió: el borrador nace con
        -- el precio de la tienda, que en una tienda «sólo mayoristas» no se le
        -- muestra a quien no está aprobado.
        'total', CASE WHEN q.status IN ('sent', 'accepted') OR q.converted_at IS NOT NULL THEN q.total END,
        'items', jsonb_array_length(q.items),
        'valid_until', q.valid_until,
        'created_at', q.created_at,
        -- El link de pago sólo cuando el comercio respondió y sigue vigente.
        'pago_id', (SELECT l.id FROM public.payment_links l
                     WHERE l.quote_id = q.id AND l.status = 'pending' AND q.status IN ('sent', 'accepted')
                       AND (l.expires_at IS NULL OR l.expires_at >= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)
                     ORDER BY l.created_at DESC LIMIT 1)
      ) AS fila
        FROM public.quotes q
        JOIN public.ecommerce_stores s ON s.id = q.store_id
       WHERE lower(s.slug) = lower(btrim(p_slug))
         AND q.origen = 'tienda' AND q.solicitado_por = auth.uid() AND auth.uid() IS NOT NULL
       ORDER BY q.created_at DESC
       LIMIT 50
    ) t;
$fn$;
REVOKE ALL ON FUNCTION public.mis_cotizaciones_tienda(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_cotizaciones_tienda(text) TO authenticated;

WITH c(function_name, audience, rationale) AS (VALUES
  ('solicitar_cotizacion_tienda', 'public_token', 'El comprador logueado pide precio por productos publicados; crea un presupuesto en borrador, con tope de pedidos abiertos.'),
  ('mis_cotizaciones_tienda', 'public_token', 'Devuelve sólo los pedidos de cotización del comprador de la sesión, con su estado y link de pago.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
