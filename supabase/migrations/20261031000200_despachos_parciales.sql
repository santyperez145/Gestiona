-- Pedidos online: despachar en partes.
--
-- Un pedido tenía un solo envío. Con preventa (20261030001900) o con un
-- producto que se demora, el comercio esperaba a tener todo, o mandaba lo que
-- había sin poder decirlo: el pedido quedaba «en camino» entero, con un solo
-- seguimiento, y lo que faltaba no figuraba en ningún lado.
--
-- Ahora cada parte es una entrega (`deliveries`) con sus productos y su
-- seguimiento:
-- · `deliveries.items` (NULL = el pedido entero, como hasta hoy) y `parte`;
-- · `pendiente_de_despacho(pedido)`: pedido, despachado y lo que falta por
--   renglón (corre con los permisos de quien la llama);
-- · `despachar_parte_del_pedido`: despacha unidades de lo que falta (nunca
--   más), con transportista y seguimiento; usa la entrega ya preparada y sin
--   despachar si la hay; cuando sale la última parte el pedido queda «en
--   camino» con el seguimiento de esa parte;
-- · preparar, cargar el seguimiento o marcar en camino el pedido entero se
--   niegan si ya hay partes; marcar entregado alcanza a todas las partes;
-- · el aviso al comprador de cada parte (`parte_N`) es idempotente como los
--   demás;
-- · `get_order_tracking` devuelve las partes con sus productos.
-- No toca stock: un estado logístico nunca es un movimiento de inventario.
-- Idempotente. Reversible: DROP de las dos funciones nuevas y de las columnas;
-- las demás vuelven con sus migraciones anteriores.
BEGIN;

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS items jsonb,
  ADD COLUMN IF NOT EXISTS parte smallint;
ALTER TABLE public.deliveries DROP CONSTRAINT IF EXISTS deliveries_partes_validas;
ALTER TABLE public.deliveries ADD CONSTRAINT deliveries_partes_validas
  CHECK ((items IS NULL OR jsonb_typeof(items) = 'array') AND (parte IS NULL OR parte >= 1));
CREATE UNIQUE INDEX IF NOT EXISTS deliveries_parte_del_pedido_idx
  ON public.deliveries (ecommerce_order_id, parte)
  WHERE ecommerce_order_id IS NOT NULL AND parte IS NOT NULL;
COMMENT ON COLUMN public.deliveries.items IS
  'Despacho en partes: [{linea, product_id, variant_id, nombre, cantidad}] sobre ecommerce_orders.items. NULL = el pedido entero.';

-- ───────────────────────── pendiente_de_despacho ─────────────────────────
CREATE OR REPLACE FUNCTION public.pendiente_de_despacho(p_order_id uuid)
RETURNS TABLE (linea int, product_id uuid, variant_id uuid, nombre text, pedida numeric, despachada numeric, falta numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH lineas AS (
    SELECT (e.ord - 1)::int AS linea, e.item
      FROM public.ecommerce_orders o
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END)
           WITH ORDINALITY AS e(item, ord)
     WHERE o.id = p_order_id
  ), enviado AS (
    SELECT public._numero_o_nulo(x->>'linea')::int AS linea, sum(public._numero_o_nulo(x->>'cantidad')) AS cantidad
      FROM public.deliveries d
      CROSS JOIN LATERAL jsonb_array_elements(d.items) AS x
     WHERE d.ecommerce_order_id = p_order_id AND d.items IS NOT NULL
     GROUP BY 1
  )
  SELECT l.linea,
         CASE WHEN l.item->>'product_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (l.item->>'product_id')::uuid END,
         CASE WHEN l.item->>'variant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (l.item->>'variant_id')::uuid END,
         coalesce(nullif(l.item->>'name', ''), nullif(l.item->>'product_name', ''), 'Producto'),
         coalesce(public._numero_o_nulo(l.item->>'quantity'), 0),
         coalesce(en.cantidad, 0),
         greatest(coalesce(public._numero_o_nulo(l.item->>'quantity'), 0) - coalesce(en.cantidad, 0), 0)
    FROM lineas l
    LEFT JOIN enviado en ON en.linea = l.linea
   ORDER BY l.linea;
$$;
REVOKE ALL ON FUNCTION public.pendiente_de_despacho(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pendiente_de_despacho(uuid) TO authenticated, service_role;

-- ───────────────────────── despachar_parte_del_pedido ─────────────────────────
CREATE OR REPLACE FUNCTION public.despachar_parte_del_pedido(
  p_order_id uuid,
  p_items jsonb,
  p_carrier text DEFAULT NULL,
  p_tracking text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.ecommerce_orders;
  v_tracking text := left(nullif(btrim(coalesce(p_tracking, '')), ''), 120);
  v_carrier text;
  v_items jsonb := '[]'::jsonb;
  v_unidades numeric := 0;
  v_quedan numeric;
  v_parte int;
  v_reusar uuid;
  v_id uuid;
  v_code text;
  v_address jsonb;
  v_peso numeric;
  r record;
BEGIN
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.has_permission(v_order.org_id, 'ecommerce', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para despachar pedidos de esta tienda' USING ERRCODE = '42501';
  END IF;
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'La orden todavía no está paga' USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_order.carrier, '') = 'retiro' OR coalesce(v_order.shipping_service, '') = 'sucursal' THEN
    RAISE EXCEPTION 'Un retiro en el local no se despacha en partes' USING ERRCODE = '22023';
  END IF;
  IF v_order.fulfillment_status NOT IN ('pending', 'unfulfilled', 'processing') THEN
    RAISE EXCEPTION 'El pedido ya salió entero o está cerrado' USING ERRCODE = '22023';
  END IF;
  -- Una entrega del pedido entero que ya salió: no queda nada por despachar.
  IF EXISTS (SELECT 1 FROM public.deliveries d
              WHERE d.ecommerce_order_id = p_order_id AND d.items IS NULL AND d.status NOT IN ('pending', 'assigned')) THEN
    RAISE EXCEPTION 'El pedido ya salió entero' USING ERRCODE = '22023';
  END IF;
  v_carrier := lower(coalesce(nullif(btrim(p_carrier), ''),
    CASE WHEN v_order.carrier IN ('propio', 'oca', 'andreani', 'correo_arg', 'mercado_envios', 'otro') THEN v_order.carrier END,
    'propio'));
  IF v_carrier NOT IN ('propio', 'oca', 'andreani', 'correo_arg', 'mercado_envios', 'otro') THEN
    RAISE EXCEPTION 'Transportista desconocido: %', v_carrier USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Elegí qué productos salen en esta parte' USING ERRCODE = '22023';
  END IF;

  -- Lo pedido para esta parte por renglón (si un renglón viene dos veces, se suma).
  FOR r IN
    WITH pedido AS (
      SELECT CASE WHEN x->>'linea' ~ '^[0-9]{1,4}$' THEN (x->>'linea')::int END AS linea,
             public._numero_o_nulo(x->>'cantidad') AS cantidad
        FROM jsonb_array_elements(p_items) AS x
    ), agrupado AS (
      SELECT pe.linea, sum(pe.cantidad) AS cantidad,
             bool_or(pe.linea IS NULL OR pe.cantidad IS NULL OR pe.cantidad <= 0) AS mal
        FROM pedido pe GROUP BY pe.linea
    )
    SELECT a.linea, a.cantidad, a.mal, p.nombre, p.product_id, p.variant_id, p.falta
      FROM agrupado a
      LEFT JOIN public.pendiente_de_despacho(p_order_id) p ON p.linea = a.linea
     ORDER BY a.linea
  LOOP
    IF r.mal THEN
      RAISE EXCEPTION 'Cada producto de la parte necesita su renglón y una cantidad mayor a cero' USING ERRCODE = '22023';
    END IF;
    IF r.nombre IS NULL THEN
      RAISE EXCEPTION 'El renglón % no es de este pedido', r.linea + 1 USING ERRCODE = '22023';
    END IF;
    IF r.cantidad > r.falta THEN
      RAISE EXCEPTION 'De «%» quedan % por despachar: no pueden salir %', r.nombre, trim_scale(r.falta), trim_scale(r.cantidad)
        USING ERRCODE = '22023';
    END IF;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'linea', r.linea, 'product_id', r.product_id, 'variant_id', r.variant_id, 'nombre', r.nombre, 'cantidad', r.cantidad));
    v_unidades := v_unidades + r.cantidad;
  END LOOP;

  SELECT coalesce(sum(p.falta), 0) - v_unidades INTO v_quedan FROM public.pendiente_de_despacho(p_order_id) p;
  SELECT coalesce(max(d.parte), 0) + 1 INTO v_parte
    FROM public.deliveries d WHERE d.ecommerce_order_id = p_order_id AND d.items IS NOT NULL;
  SELECT coalesce(s.default_item_weight_kg, 0.5) * greatest(v_unidades, 1) INTO v_peso
    FROM public.ecommerce_stores s WHERE s.id = v_order.store_id;

  -- La entrega del pedido entero preparada y sin despachar pasa a ser esta parte.
  SELECT d.id INTO v_reusar FROM public.deliveries d
   WHERE d.ecommerce_order_id = p_order_id AND d.items IS NULL AND d.status IN ('pending', 'assigned')
   ORDER BY d.created_at LIMIT 1
   FOR UPDATE;
  IF v_reusar IS NOT NULL THEN
    UPDATE public.deliveries
       SET items = v_items, parte = v_parte, carrier = v_carrier, external_tracking = v_tracking,
           status = 'in_transit', picked_up_at = coalesce(picked_up_at, now()),
           weight_kg = coalesce(v_peso, weight_kg), updated_at = now()
     WHERE id = v_reusar
    RETURNING id, tracking_code INTO v_id, v_code;
  ELSE
    v_address := coalesce(v_order.shipping_address, '{}'::jsonb);
    v_code := 'ENV-' || v_order.order_number || '-' || v_parte;
    INSERT INTO public.deliveries (
      org_id, ecommerce_order_id, tracking_code,
      customer_name, customer_phone, customer_email,
      address_street, address_city, address_province, address_zip, address_notes,
      carrier, status, weight_kg, cod_amount, cod_collected, external_tracking, picked_up_at, items, parte
    ) VALUES (
      v_order.org_id, p_order_id, v_code,
      v_order.customer_name, v_order.customer_phone, v_order.customer_email,
      coalesce(nullif(v_address->>'calle', ''), nullif(v_address->>'street', ''), v_address->>'address', ''),
      coalesce(nullif(v_address->>'ciudad', ''), v_address->>'city', ''),
      coalesce(nullif(v_address->>'provincia', ''), nullif(v_address->>'province', ''), v_address->>'state', ''),
      coalesce(nullif(v_address->>'cp', ''), nullif(v_address->>'zip', ''), v_address->>'postal_code', ''),
      coalesce(nullif(v_address->>'notas', ''), nullif(v_address->>'notes', '')),
      v_carrier, 'in_transit', coalesce(v_peso, 0.5), 0, true, v_tracking, now(), v_items, v_parte
    )
    RETURNING id INTO v_id;
  END IF;

  IF v_quedan <= 0 THEN
    UPDATE public.ecommerce_orders
       SET fulfillment_status = 'shipped', carrier = v_carrier,
           tracking_number = coalesce(v_tracking, tracking_number), updated_at = now()
     WHERE id = p_order_id;
  ELSE
    UPDATE public.ecommerce_orders
       SET fulfillment_status = 'processing', updated_at = now()
     WHERE id = p_order_id AND fulfillment_status IN ('pending', 'unfulfilled');
  END IF;

  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, entity_label, details, severity, tags)
  VALUES (auth.uid(), v_order.org_id, 'update', 'ecommerce_order', p_order_id::text, 'Pedido ' || v_order.order_number,
          jsonb_build_object('parte_despachada', v_parte, 'unidades', v_unidades, 'quedan', greatest(v_quedan, 0),
                             'transportista', v_carrier, 'seguimiento', v_tracking),
          'info', ARRAY['ecommerce', 'envios']::text[]);

  RETURN jsonb_build_object('ok', true, 'delivery_id', v_id, 'parte', v_parte, 'tracking_code', v_code,
                            'unidades', v_unidades, 'quedan', greatest(v_quedan, 0), 'completo', v_quedan <= 0);
END;
$$;
REVOKE ALL ON FUNCTION public.despachar_parte_del_pedido(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.despachar_parte_del_pedido(uuid, jsonb, text, text) TO authenticated, service_role;

-- ───────────────────────── guardas en el despacho entero ─────────────────────────
CREATE OR REPLACE FUNCTION public.prepare_order_shipment(
  p_order_id uuid,
  p_carrier text DEFAULT 'propio',
  p_weight_kg numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order record;
  v_address jsonb;
  v_id uuid;
  v_code text;
  v_weight numeric;
  v_carrier text := COALESCE(NULLIF(btrim(p_carrier), ''), 'propio');
BEGIN
  SELECT * INTO v_order
  FROM public.ecommerce_orders
  WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  IF NOT public.has_permission(v_order.org_id, 'ecommerce', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para preparar envíos de esta tienda';
  END IF;
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'La orden todavía no está paga';
  END IF;
  -- Despacho en partes (20261031000200): las partes ya tienen sus productos y
  -- su seguimiento; preparar o despachar el pedido entero las pisaría.
  IF EXISTS (SELECT 1 FROM public.deliveries d WHERE d.ecommerce_order_id = p_order_id AND d.items IS NOT NULL) THEN
    RAISE EXCEPTION 'Este pedido se despacha en partes: despachá lo que falta con «Despachar una parte»' USING ERRCODE = '22023';
  END IF;
  IF v_carrier NOT IN (
    'propio', 'oca', 'andreani', 'correo_arg', 'mercado_envios', 'otro'
  ) THEN
    RAISE EXCEPTION 'Transportista desconocido: %', v_carrier;
  END IF;

  SELECT id, tracking_code INTO v_id, v_code
  FROM public.deliveries
  WHERE ecommerce_order_id = p_order_id
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'id', v_id,
      'tracking_code', v_code,
      'existing', true
    );
  END IF;

  v_address := COALESCE(v_order.shipping_address, '{}'::jsonb);
  IF p_weight_kg IS NOT NULL AND p_weight_kg > 0 THEN
    v_weight := p_weight_kg;
  ELSE
    SELECT COALESCE(s.default_item_weight_kg, 0.5)
      * GREATEST(
        1,
        (
          SELECT COALESCE(sum((item ->> 'quantity')::integer), 1)
          FROM jsonb_array_elements(v_order.items) item
        )
      )
    INTO v_weight
    FROM public.ecommerce_stores s
    WHERE s.id = v_order.store_id;
    v_weight := COALESCE(v_weight, 0.5);
  END IF;

  v_code := 'ENV-' || v_order.order_number;
  INSERT INTO public.deliveries (
    org_id, ecommerce_order_id, tracking_code,
    customer_name, customer_phone, customer_email,
    address_street, address_city, address_province, address_zip, address_notes,
    carrier, status, weight_kg, cod_amount, cod_collected
  ) VALUES (
    v_order.org_id, p_order_id, v_code,
    v_order.customer_name, v_order.customer_phone, v_order.customer_email,
    COALESCE(
      NULLIF(v_address ->> 'calle', ''),
      NULLIF(v_address ->> 'street', ''),
      v_address ->> 'address',
      ''
    ),
    COALESCE(
      NULLIF(v_address ->> 'ciudad', ''),
      v_address ->> 'city',
      ''
    ),
    COALESCE(
      NULLIF(v_address ->> 'provincia', ''),
      NULLIF(v_address ->> 'province', ''),
      v_address ->> 'state',
      ''
    ),
    COALESCE(
      NULLIF(v_address ->> 'cp', ''),
      NULLIF(v_address ->> 'zip', ''),
      v_address ->> 'postal_code',
      ''
    ),
    COALESCE(
      NULLIF(v_address ->> 'notas', ''),
      NULLIF(v_address ->> 'notes', '')
    ),
    v_carrier, 'pending', v_weight, 0, true
  )
  RETURNING id INTO v_id;

  UPDATE public.ecommerce_orders
  SET fulfillment_status = 'processing',
      updated_at = now()
  WHERE id = p_order_id
    AND fulfillment_status IN ('pending', 'unfulfilled');

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'tracking_code', v_code,
    'existing', false
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.set_order_tracking(
  p_order_id uuid,
  p_carrier text,
  p_tracking text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_tracking text := NULLIF(btrim(p_tracking), '');
  v_carrier text := NULLIF(btrim(p_carrier), '');
BEGIN
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  IF NOT public.has_permission(v_order.org_id, 'ecommerce', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para editar envíos de esta tienda';
  END IF;
  IF v_order.payment_status <> 'paid' THEN RAISE EXCEPTION 'La orden todavía no está paga'; END IF;
  -- Despacho en partes (20261031000200): las partes ya tienen sus productos y
  -- su seguimiento; preparar o despachar el pedido entero las pisaría.
  IF EXISTS (SELECT 1 FROM public.deliveries d WHERE d.ecommerce_order_id = p_order_id AND d.items IS NOT NULL) THEN
    RAISE EXCEPTION 'Este pedido se despacha en partes: despachá lo que falta con «Despachar una parte»' USING ERRCODE = '22023';
  END IF;
  IF v_order.fulfillment_status = 'delivered' THEN
    RAISE EXCEPTION 'La orden ya fue marcada como entregada';
  END IF;
  IF v_order.fulfillment_status NOT IN ('pending', 'unfulfilled', 'processing', 'shipped') THEN
    RAISE EXCEPTION 'La orden no está en un estado que se pueda despachar';
  END IF;
  IF v_tracking IS NULL THEN RAISE EXCEPTION 'Falta el número de seguimiento'; END IF;
  IF v_carrier IS NOT NULL
     AND v_carrier NOT IN ('propio','oca','andreani','correo_arg','mercado_envios','otro') THEN
    RAISE EXCEPTION 'Transportista desconocido: %', v_carrier;
  END IF;

  UPDATE public.deliveries
     SET carrier = COALESCE(v_carrier, carrier),
         external_tracking = v_tracking,
         status = CASE WHEN status IN ('pending', 'assigned') THEN 'in_transit' ELSE status END,
         picked_up_at = COALESCE(picked_up_at, now()),
         updated_at = now()
   WHERE ecommerce_order_id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Primero prepará el envío de la orden'; END IF;

  UPDATE public.ecommerce_orders
     SET tracking_number = v_tracking,
         carrier = COALESCE(v_carrier, carrier),
         fulfillment_status = 'shipped',
         updated_at = now()
   WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'tracking', v_tracking);
END;
$$;


CREATE OR REPLACE FUNCTION public.update_store_order_fulfillment(
  p_order_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_delivery_id uuid;
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_retiro boolean;
BEGIN
  IF v_status NOT IN ('shipped', 'delivered') THEN
    RAISE EXCEPTION 'Estado de entrega inválido: %', COALESCE(p_status, '');
  END IF;

  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  IF NOT public.has_permission(v_order.org_id, 'ecommerce', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para actualizar envíos de esta tienda';
  END IF;
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'La orden todavía no está paga';
  END IF;

  v_retiro := COALESCE(v_order.carrier, '') = 'retiro'
           OR COALESCE(v_order.shipping_service, '') = 'sucursal';

  IF v_order.fulfillment_status = 'delivered' THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'status', 'delivered');
  END IF;

  IF v_retiro THEN
    IF v_status = 'shipped' THEN
      RAISE EXCEPTION 'El retiro en tienda no se despacha. Marcalo como retirado.';
    END IF;
    IF v_order.fulfillment_status NOT IN ('pending', 'unfulfilled', 'processing') THEN
      RAISE EXCEPTION 'La orden no está en un estado que se pueda marcar como retirada';
    END IF;

    UPDATE public.deliveries
       SET status = 'delivered',
           delivered_at = COALESCE(delivered_at, now()),
           updated_at = now()
     WHERE ecommerce_order_id = p_order_id;

    UPDATE public.ecommerce_orders
       SET fulfillment_status = 'delivered', updated_at = now()
     WHERE id = p_order_id;

    RETURN jsonb_build_object('ok', true, 'changed', true, 'status', 'delivered');
  END IF;

  SELECT id INTO v_delivery_id
  FROM public.deliveries
  WHERE ecommerce_order_id = p_order_id
  ORDER BY created_at
  LIMIT 1;
  IF v_delivery_id IS NULL THEN
    RAISE EXCEPTION 'Primero prepará el envío de la orden';
  END IF;

  IF v_status = 'shipped' THEN
    IF v_order.fulfillment_status = 'shipped' THEN
      RETURN jsonb_build_object('ok', true, 'changed', false, 'status', 'shipped');
    END IF;
    -- Despacho en partes (20261031000200): las partes ya tienen sus productos y
    -- su seguimiento; preparar o despachar el pedido entero las pisaría.
    IF EXISTS (SELECT 1 FROM public.deliveries d WHERE d.ecommerce_order_id = p_order_id AND d.items IS NOT NULL) THEN
      RAISE EXCEPTION 'Este pedido se despacha en partes: despachá lo que falta con «Despachar una parte»' USING ERRCODE = '22023';
    END IF;
    IF v_order.fulfillment_status NOT IN ('pending', 'unfulfilled', 'processing') THEN
      RAISE EXCEPTION 'La orden no está en un estado que se pueda despachar';
    END IF;

    UPDATE public.deliveries
       SET status = CASE WHEN status IN ('pending', 'assigned') THEN 'in_transit' ELSE status END,
           picked_up_at = COALESCE(picked_up_at, now()),
           updated_at = now()
     WHERE id = v_delivery_id;

    UPDATE public.ecommerce_orders
       SET fulfillment_status = 'shipped', updated_at = now()
     WHERE id = p_order_id;
  ELSE
    IF v_order.fulfillment_status <> 'shipped' THEN
      RAISE EXCEPTION 'La orden tiene que estar en camino antes de marcarse entregada';
    END IF;

    UPDATE public.deliveries
       SET status = 'delivered', delivered_at = COALESCE(delivered_at, now()), updated_at = now()
     WHERE ecommerce_order_id = p_order_id;

    UPDATE public.ecommerce_orders
       SET fulfillment_status = 'delivered', updated_at = now()
     WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'changed', true, 'status', v_status);
END;
$$;


-- ───────────────────────── avisos por parte ─────────────────────────
ALTER TABLE public.store_order_status_email_log DROP CONSTRAINT IF EXISTS store_order_status_email_log_event_check;
ALTER TABLE public.store_order_status_email_log ADD CONSTRAINT store_order_status_email_log_event_check
  CHECK (event IN ('order_created', 'payment_confirmed', 'shipped', 'delivered') OR event ~ '^parte_[0-9]{1,3}$');

CREATE OR REPLACE FUNCTION public.claim_store_order_email(
  p_order_id uuid,
  p_audience text,
  p_event text,
  p_recipient_email text,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_delivery public.store_order_status_email_log%ROWTYPE;
  v_claim_token uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 300), 30), 900);
  v_inserted boolean := false;
BEGIN
  IF p_order_id IS NULL
     OR p_audience NOT IN ('buyer', 'merchant')
     OR (p_event NOT IN ('order_created', 'payment_confirmed', 'shipped', 'delivered') AND p_event !~ '^parte_[0-9]{1,3}$')
     OR NULLIF(btrim(p_recipient_email), '') IS NULL THEN
    RAISE EXCEPTION 'Parámetros de entrega de email inválidos' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.store_order_status_email_log (
    ecommerce_order_id,
    audience,
    event,
    recipient_email,
    status,
    attempt_count,
    claim_token,
    claimed_at,
    updated_at
  ) VALUES (
    p_order_id,
    p_audience,
    p_event,
    lower(btrim(p_recipient_email)),
    'pending',
    1,
    v_claim_token,
    v_now,
    v_now
  )
  ON CONFLICT (ecommerce_order_id, audience, event) DO NOTHING
  RETURNING * INTO v_delivery;

  v_inserted := FOUND;
  IF NOT v_inserted THEN
    SELECT *
    INTO v_delivery
    FROM public.store_order_status_email_log
    WHERE ecommerce_order_id = p_order_id
      AND audience = p_audience
      AND event = p_event
    FOR UPDATE;

    IF v_delivery.status = 'sent' THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'duplicate', true,
        'inProgress', false,
        'deliveryId', v_delivery.id
      );
    END IF;

    IF v_delivery.status = 'pending'
       AND v_delivery.claimed_at IS NOT NULL
       AND v_delivery.claimed_at > v_now - make_interval(secs => v_lease_seconds) THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'duplicate', false,
        'inProgress', true,
        'deliveryId', v_delivery.id
      );
    END IF;

    UPDATE public.store_order_status_email_log
    SET recipient_email = lower(btrim(p_recipient_email)),
        status = 'pending',
        provider = NULL,
        provider_message_id = NULL,
        last_error = NULL,
        attempt_count = attempt_count + 1,
        claim_token = v_claim_token,
        claimed_at = v_now,
        updated_at = v_now
    WHERE id = v_delivery.id
    RETURNING * INTO v_delivery;
  END IF;

  RETURN jsonb_build_object(
    'claimed', true,
    'duplicate', false,
    'inProgress', false,
    'deliveryId', v_delivery.id,
    'claimToken', v_claim_token,
    'idempotencyKey', concat(
      'gestiona-order-email/', p_order_id::text, '/', p_audience, '/', p_event
    ),
    'attempt', v_delivery.attempt_count
  );
END;
$$;


-- ───────────────────────── seguimiento del comprador ─────────────────────────
-- Igual que en 20260902000130 más las partes; la entrega que describe el
-- pedido es la última que salió.
CREATE OR REPLACE FUNCTION public.get_order_tracking(p_order_number text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order  record;
  v_del    record;
  v_url    text;
  v_envios jsonb;
BEGIN
  SELECT o.id, o.fulfillment_status, o.tracking_number, o.created_at, o.org_id,
         o.carrier, o.shipping_service
    INTO v_order
  FROM public.ecommerce_orders o
  WHERE upper(o.order_number) = upper(btrim(p_order_number))
    AND lower(o.customer_email) = lower(btrim(p_email));

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT d.carrier, d.external_tracking, d.status, d.picked_up_at, d.delivered_at
    INTO v_del
  FROM public.deliveries d WHERE d.ecommerce_order_id = v_order.id
  ORDER BY coalesce(d.parte, 0) DESC, d.created_at DESC
  LIMIT 1;

  SELECT replace(c.tracking_url, '{tracking_number}', COALESCE(v_del.external_tracking, ''))
    INTO v_url
  FROM public.carriers c
  WHERE c.org_id = v_order.org_id
    AND lower(c.code) = lower(COALESCE(v_del.carrier, ''))
    AND c.tracking_url IS NOT NULL
  LIMIT 1;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'parte', d.parte,
           'carrier', d.carrier,
           'tracking', d.external_tracking,
           'estado', d.status,
           'salio', d.picked_up_at,
           'entregado', d.delivered_at,
           'tracking_url', (SELECT nullif(replace(c.tracking_url, '{tracking_number}', d.external_tracking), '')
                              FROM public.carriers c
                             WHERE c.org_id = v_order.org_id AND lower(c.code) = lower(coalesce(d.carrier, ''))
                               AND c.tracking_url IS NOT NULL AND d.external_tracking IS NOT NULL
                             LIMIT 1),
           'productos', (SELECT coalesce(jsonb_agg(jsonb_build_object('nombre', x->>'nombre', 'cantidad', x->'cantidad')), '[]'::jsonb)
                           FROM jsonb_array_elements(d.items) AS x)
         ) ORDER BY d.parte), '[]'::jsonb)
    INTO v_envios
  FROM public.deliveries d
  WHERE d.ecommerce_order_id = v_order.id AND d.items IS NOT NULL;

  RETURN jsonb_build_object(
    'found', true,
    'fulfillment_status', v_order.fulfillment_status,
    'tracking_number', v_order.tracking_number,
    -- Preferir el de la etiqueta; si no hay delivery (retiro), el de la orden.
    'carrier', COALESCE(v_del.carrier, v_order.carrier),
    'shipping_service', v_order.shipping_service,
    'shipment_status', v_del.status,
    'picked_up_at', v_del.picked_up_at,
    'delivered_at', v_del.delivered_at,
    'tracking_url', NULLIF(v_url, ''),
    'ordered_at', v_order.created_at,
    'envios', v_envios
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_order_tracking(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_tracking(text, text) TO anon, authenticated;

-- Tenía contrato (public_token): misma audiencia, huella nueva.
UPDATE public.security_function_contracts sc
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-10-31'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
 WHERE sc.function_name = p.proname
   AND sc.identity_arguments = pg_get_function_identity_arguments(p.oid)
   AND p.proname = 'get_order_tracking';

COMMIT;
