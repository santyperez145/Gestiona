-- Límite por IP en las escrituras públicas que no tenían (2026-11-05).
--
-- Sin sesión y sin tope, una IP podía:
--   · anotar miles de emails ajenos en «avisame cuando haya stock» (el aviso
--     sale con el remitente de la tienda);
--   · probar números de pedido contra un email en el seguimiento, la
--     devolución o el consentimiento, y leer el pedido de otro.
-- Ahora: aviso de stock y devolución 10 cada 15 minutos; consentimiento 20
-- por minuto (uno por pedido, y los pedidos ya van a 10 por minuto);
-- seguimiento 30 por minuto. Un intento que falla deshace su propio conteo,
-- así que «pedido no encontrado» deja de ser error en la devolución
-- ({ok:false}, que la tienda ya muestra) y en el consentimiento (false): esos
-- intentos quedan contados. El seguimiento pasa a VOLATILE porque el límite
-- escribe. El resto de cada función no cambia (última definición).
-- Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.request_stock_alert(
  p_slug       text,
  p_product_id uuid,
  p_email      text,
  p_variant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_store    record;
  v_email    text := lower(btrim(p_email));
  v_stock    int;
  v_customer uuid;
BEGIN
  -- Límite por IP (20261105000500).
  IF NOT public.rate_limit_publico('aviso_stock', p_slug, 10, interval '15 minutes') THEN
    RAISE EXCEPTION 'Demasiados intentos seguidos. Probá de nuevo en unos minutos.' USING ERRCODE = '53400';
  END IF;

  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Revisá el email';
  END IF;

  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores WHERE lower(slug) = lower(p_slug) AND is_active;
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'Tienda no encontrada'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND org_id = v_store.org_id) THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_stock FROM public.product_variants
    WHERE id = p_variant_id AND product_id = p_product_id;
    IF v_stock IS NULL THEN RAISE EXCEPTION 'Variante no encontrada'; END IF;
  ELSE
    SELECT stock INTO v_stock FROM public.products WHERE id = p_product_id;
  END IF;

  IF COALESCE(v_stock, 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'hay_stock');
  END IF;

  SELECT id INTO v_customer FROM public.store_customers
  WHERE store_id = v_store.id AND user_id = auth.uid();

  INSERT INTO public.store_stock_alerts
    (org_id, store_id, product_id, variant_id, email, store_customer_id)
  VALUES (v_store.org_id, v_store.id, p_product_id, p_variant_id, v_email, v_customer)
  -- Pedirlo dos veces reabre el aviso en vez de fallar: si ya se le avisó y
  -- volvió a agotarse, quiere saberlo de nuevo.
  ON CONFLICT (product_id, variant_id, email) DO UPDATE
    SET notified_at = NULL, created_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_store_marketing_consent(
  p_slug text,
  p_order_number text,
  p_email text,
  p_source text DEFAULT 'store_checkout'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_order public.ecommerce_orders%ROWTYPE;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_now timestamptz := now();
BEGIN
  -- Límite por IP (20261105000500).
  IF NOT public.rate_limit_publico('consentimiento', p_slug, 20, interval '1 minute') THEN
    RAISE EXCEPTION 'Demasiados intentos seguidos. Probá de nuevo en unos minutos.' USING ERRCODE = '53400';
  END IF;

  IF v_email = '' OR p_source <> 'store_checkout' THEN
    RAISE EXCEPTION 'Consentimiento inválido';
  END IF;

  SELECT o.* INTO v_order
  FROM public.ecommerce_orders o
  JOIN public.ecommerce_stores s ON s.id = o.store_id
  WHERE lower(s.slug) = lower(p_slug)
    AND o.order_number = p_order_number
    AND lower(btrim(o.customer_email)) = v_email
  FOR UPDATE OF o;

  -- Sin error: el intento fallido tiene que quedar contado en el límite.
  IF v_order.id IS NULL THEN RETURN false; END IF;

  UPDATE public.ecommerce_orders
     SET marketing_consent_at = COALESCE(marketing_consent_at, v_now),
         marketing_consent_source = COALESCE(marketing_consent_source, p_source)
   WHERE id = v_order.id;

  UPDATE public.store_customers
     SET accepts_marketing = true,
         marketing_consent_at = COALESCE(marketing_consent_at, v_now),
         marketing_consent_source = COALESCE(marketing_consent_source, p_source),
         marketing_opt_out_at = NULL,
         marketing_opt_out_source = NULL
   WHERE id = v_order.store_customer_id;

  UPDATE public.customers
     SET marketing_consent_at = COALESCE(marketing_consent_at, v_now),
         marketing_consent_source = COALESCE(marketing_consent_source, p_source),
         marketing_opt_out_at = NULL,
         marketing_opt_out_source = NULL,
         updated_at = now()
   WHERE org_id = v_order.org_id
     AND lower(btrim(COALESCE(email, ''))) = v_email;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_store_return(
  p_slug text,
  p_order_number text,
  p_email text,
  p_tipo text,
  p_product_id uuid DEFAULT NULL,
  p_variant_id uuid DEFAULT NULL,
  p_qty integer DEFAULT 1,
  p_motivo text DEFAULT NULL,
  p_cambio_por text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store record;
  v_order record;
  v_days integer;
  v_rma text;
  v_id uuid;
  v_item jsonb;
  v_name text;
  v_amount numeric := 0;
  v_existing integer;
  v_crm uuid;
BEGIN
  -- Límite por IP (20261105000500).
  IF NOT public.rate_limit_publico('devolucion', p_slug, 10, interval '15 minutes') THEN
    RAISE EXCEPTION 'Demasiados intentos seguidos. Probá de nuevo en unos minutos.' USING ERRCODE = '53400';
  END IF;

  IF p_tipo NOT IN ('arrepentimiento', 'falla', 'cambio') THEN
    RAISE EXCEPTION 'Tipo de pedido inválido';
  END IF;

  SELECT s.id, s.org_id, COALESCE(s.plazo_cambio_dias, 30) AS plazo_cambio_dias INTO v_store
  FROM public.ecommerce_stores s
  WHERE lower(s.slug) = lower(p_slug)
    AND s.is_active;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada';
  END IF;

  SELECT o.id, o.org_id, o.items, o.payment_status, o.order_number, o.customer_name,
         o.customer_email, o.store_customer_id, o.created_at
  INTO v_order
  FROM public.ecommerce_orders o
  WHERE o.org_id = v_store.org_id
    AND o.store_id = v_store.id
    AND upper(btrim(o.order_number)) = upper(btrim(p_order_number))
    AND lower(btrim(o.customer_email)) = lower(btrim(COALESCE(p_email, '')))
  LIMIT 1;

  IF v_order.id IS NULL THEN
    -- Sin error: el intento fallido tiene que quedar contado en el límite.
    RETURN jsonb_build_object('ok', false, 'error', 'No encontramos esa orden con ese email');
  END IF;
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Esa orden todavía no figura como pagada';
  END IF;

  IF p_tipo = 'arrepentimiento' THEN
    v_days := public.dias_para_arrepentirse(v_order.id);
    IF v_days <= 0 THEN
      RAISE EXCEPTION 'Pasaron los 10 días corridos para arrepentirte. Si el producto tiene una falla, elegí esa opción: la garantía legal es de 6 meses.';
    END IF;
  END IF;
  IF p_tipo = 'cambio' THEN
    IF v_store.plazo_cambio_dias = 0 THEN
      RAISE EXCEPTION 'Esta tienda no hace cambios online. Si el producto tiene una falla, elegí esa opción.' USING ERRCODE = '22023';
    END IF;
    IF now() > v_order.created_at + make_interval(days => v_store.plazo_cambio_dias) THEN
      RAISE EXCEPTION 'El plazo para cambios es de % días desde la compra.', v_store.plazo_cambio_dias USING ERRCODE = '22023';
    END IF;
    IF NULLIF(btrim(COALESCE(p_cambio_por, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Contanos por qué lo querés cambiar (talle, color u otro producto).' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT count(*) INTO v_existing
  FROM public.return_requests r
  WHERE r.ecommerce_order_id = v_order.id
    AND COALESCE(r.product_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_product_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND r.status IN ('pending', 'approved');
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'Ya hay un pedido en curso para ese producto de esta orden';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb)) LOOP
    IF p_product_id IS NULL OR (v_item ->> 'product_id')::uuid = p_product_id THEN
      v_name := COALESCE(v_name, v_item ->> 'name');
      v_amount := v_amount
        + COALESCE((v_item ->> 'unit_price')::numeric, 0)
        * LEAST(GREATEST(COALESCE(p_qty, 1), 1), GREATEST(COALESCE((v_item ->> 'quantity')::integer, 1), 1));
      EXIT WHEN p_product_id IS NOT NULL;
    END IF;
  END LOOP;

  IF p_product_id IS NOT NULL AND v_name IS NULL THEN
    RAISE EXCEPTION 'Ese producto no está en la orden %', v_order.order_number;
  END IF;

  SELECT c.id INTO v_crm
  FROM public.customers c
  WHERE c.org_id = v_order.org_id
    AND lower(btrim(c.email)) = lower(btrim(v_order.customer_email))
  LIMIT 1;

  v_rma := 'RMA-' || to_char(now(), 'YYYYMMDD') || '-' || lpad((floor(random() * 10000))::text, 4, '0');

  INSERT INTO public.return_requests (
    org_id, rma_number, ecommerce_order_id, tipo,
    customer_id, customer_name, customer_email,
    product_id, variant_id, product_name, quantity,
    refund_amount, status, reason_text, cambio_por
  ) VALUES (
    v_order.org_id, v_rma, v_order.id, p_tipo,
    v_crm, v_order.customer_name, v_order.customer_email,
    p_product_id, p_variant_id, COALESCE(v_name, 'Toda la orden'),
    GREATEST(COALESCE(p_qty, 1), 1),
    round(v_amount), 'pending', p_motivo,
    NULLIF(left(btrim(COALESCE(p_cambio_por, '')), 500), '')
  )
  RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.notifications (user_id, org_id, title, message, type, entity_type, entity_id)
    SELECT m.user_id, v_order.org_id,
      CASE p_tipo WHEN 'arrepentimiento' THEN 'Arrepentimiento de compra'
                  WHEN 'cambio' THEN 'Pedido de cambio'
                  ELSE 'Reclamo por falla' END,
      format('%s — orden %s', COALESCE(v_name, 'Toda la orden'), v_order.order_number),
      'ecommerce', 'return_request', v_id::text
    FROM public.memberships m
    WHERE m.org_id = v_order.org_id AND m.role = 'owner'
    ORDER BY m.joined_at
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'rma', v_rma, 'tipo', p_tipo, 'monto', round(v_amount), 'order_number', v_order.order_number);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_order_tracking(p_order_number text, p_email text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_order  record;
  v_del    record;
  v_url    text;
  v_envios jsonb;
BEGIN
  -- Límite por IP (20261105000500).
  IF NOT public.rate_limit_publico('seguimiento', btrim(p_order_number), 30, interval '1 minute') THEN
    RAISE EXCEPTION 'Demasiados intentos seguidos. Probá de nuevo en unos minutos.' USING ERRCODE = '53400';
  END IF;

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

UPDATE public.security_function_contracts sfc
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-11-05'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('request_stock_alert', 'register_store_marketing_consent', 'request_store_return', 'get_order_tracking')
   AND sfc.function_name = p.proname
   AND sfc.identity_arguments = pg_get_function_identity_arguments(p.oid);

COMMIT;
