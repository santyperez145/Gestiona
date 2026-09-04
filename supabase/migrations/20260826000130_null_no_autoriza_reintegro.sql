-- ═══════════════════════════════════════════════════════════════════════════
-- Un NULL no puede autorizar una devolución de plata
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `pago_reintegro_preparar` tiene un guard que existe para una sola cosa: que no
-- se reintegre al medio de pago original una solicitud que no lo pidió. Una
-- devolución puede resolverse como cambio de producto o como crédito en tienda,
-- y en esos casos la plata **no vuelve a la tarjeta**.
--
-- El guard estaba escrito así:
--
--     IF v_request.resolution <> 'refund'
--        OR v_request.refund_method <> 'original_payment' THEN
--
-- ⚠️ Con `refund_method` en NULL, `NULL <> 'original_payment'` da **NULL**, no
-- TRUE. Y `FALSE OR NULL` es NULL. Un `IF NULL THEN` no ejecuta. **El guard se
-- saltea entero.** Lo mismo con `resolution` en NULL.
--
-- Ninguna de las dos columnas tiene DEFAULT ni CHECK (medido 2026-08-26), y
-- `return_requests` se escribe **directo desde el cliente** con
-- `supabase.from("return_requests").insert(...)`. La UI del portal manda siempre
-- los dos campos, pero la UI no es la barrera: la barrera es esta función.
--
-- ── Cómo se encontró ──────────────────────────────────────────────────────
--
-- No leyendo el código. Construyendo el escenario que le faltaba a P0-04
-- —*reintegro por monto mayor al cobrado*— y probando de paso los bordes:
--
--     1  1500 sobre una orden de 1000 ... rechazado: supera el saldo   OK
--     2  refund_method en NULL ......... SE PREPARO un reintegro de $500
--     3  resolution en NULL ............ SE PREPARO un reintegro de $500
--     4  el total exacto se acepta ..... preparado $1000 is_total=true  OK
--
-- El tope por monto **sí** funcionaba: 1 y 4 pasan, y el daño máximo era
-- reintegrar hasta el total de la orden. Pero reintegrar el total de una orden
-- cuya devolución se resolvió como cambio es perder la plata igual.
--
-- 📌 Hoy hay **0 filas** en `return_requests` (medido 2026-08-26), así que no
-- hay nada que reparar hacia atrás. Es el mejor momento para cerrarlo.
--
-- ── Qué se cambia, y qué no ───────────────────────────────────────────────
--
-- Sólo la condición, de `<>` a `IS DISTINCT FROM`, más un mensaje que dice cuál
-- de los dos campos está mal — el anterior obligaba a adivinar. El resto de la
-- función se regeneró con `pg_get_functiondef` y no se tocó una línea: es una
-- función de 130 líneas, y reescribirla de memoria sería exactamente el error
-- que CONTRIBUTING.md tiene documentado.
--
-- **No se agrega un CHECK a la tabla.** Una solicitud en `pending` legítimamente
-- tiene `resolution` en NULL: el comercio todavía no decidió. La regla no es
-- "estas columnas no pueden ser NULL", es "para sacar plata tienen que estar
-- decididas", y eso pertenece a la función.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.pago_reintegro_preparar(p_return_request_id uuid, p_requested_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_request       record;
  v_order         record;
  v_refund        record;
  v_refunded      numeric := 0;
  v_remaining     numeric := 0;
  v_amount        numeric := 0;
  v_key           text;
  v_is_total      boolean := false;
BEGIN
  IF p_return_request_id IS NULL THEN
    RAISE EXCEPTION 'Falta la solicitud de devolución';
  END IF;

  SELECT r.* INTO v_request
  FROM public.return_requests r
  WHERE r.id = p_return_request_id
  FOR UPDATE;
  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud de devolución no encontrada';
  END IF;

  IF v_request.ecommerce_order_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud no está vinculada a una orden online';
  END IF;
  -- ⚠️ `IS DISTINCT FROM`, no `<>`. Con NULL, `x <> 'literal'` da NULL y
  -- `FALSE OR NULL` es NULL, así que el IF no dispara y el guard se saltea
  -- entero. Ver la cabecera de 20260826000130.
  IF v_request.resolution IS DISTINCT FROM 'refund'
     OR v_request.refund_method IS DISTINCT FROM 'original_payment' THEN
    RAISE EXCEPTION 'La solicitud no está configurada para reintegrar al medio original (resolución %, medio %)',
      COALESCE(v_request.resolution, 'sin definir'),
      COALESCE(v_request.refund_method, 'sin definir');
  END IF;
  IF v_request.status NOT IN ('approved', 'processing') THEN
    RAISE EXCEPTION 'La solicitud tiene estado % y no puede reintegrarse', v_request.status;
  END IF;

  SELECT o.id, o.org_id, o.order_number, o.payment_id, o.payment_status,
         round(COALESCE(o.total, 0), 2) AS total
    INTO v_order
  FROM public.ecommerce_orders o
  WHERE o.id = v_request.ecommerce_order_id
  FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'La orden online no existe';
  END IF;
  IF v_order.payment_status NOT IN ('paid', 'partial') THEN
    RAISE EXCEPTION 'La orden % no tiene un pago reintegrable (estado %)',
      v_order.order_number, v_order.payment_status;
  END IF;
  IF NULLIF(btrim(v_order.payment_id), '') IS NULL THEN
    RAISE EXCEPTION 'La orden % no tiene el identificador de pago de MercadoPago', v_order.order_number;
  END IF;

  SELECT * INTO v_refund
  FROM public.payment_refunds pr
  WHERE pr.return_request_id = v_request.id
    AND pr.org_id = v_request.org_id
  FOR UPDATE;

  IF v_refund.id IS NOT NULL AND v_refund.status = 'refunded' THEN
    RETURN jsonb_build_object(
      'ok', true, 'refund_id', v_refund.id, 'status', v_refund.status,
      'reused', true, 'already_refunded', true,
      'org_id', v_refund.org_id, 'order_id', v_refund.ecommerce_order_id,
      'payment_id', v_refund.provider_payment_id, 'amount', v_refund.amount,
      'client_key', v_refund.client_key, 'currency', v_refund.currency,
      'is_total', false
    );
  END IF;

  v_amount := round(COALESCE(v_request.refund_amount, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'La solicitud no tiene un monto de reintegro válido';
  END IF;
  IF v_order.total <= 0 THEN
    RAISE EXCEPTION 'La orden no tiene un total válido';
  END IF;

  SELECT round(COALESCE(sum(pr.amount), 0), 2) INTO v_refunded
  FROM public.payment_refunds pr
  WHERE pr.org_id = v_order.org_id
    AND pr.ecommerce_order_id = v_order.id
    AND pr.status = 'refunded'
    AND (v_refund.id IS NULL OR pr.id <> v_refund.id);

  v_remaining := round(v_order.total - v_refunded, 2);
  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'La orden % ya tiene reintegrado todo su total', v_order.order_number;
  END IF;
  IF v_amount > v_remaining THEN
    RAISE EXCEPTION 'El reintegro de % supera el saldo disponible de % en la orden %',
      v_amount, v_remaining, v_order.order_number;
  END IF;
  v_is_total := v_amount >= v_remaining;
  v_key := COALESCE(v_refund.client_key, 'refund:return-request:' || v_request.id::text);

  IF v_refund.id IS NULL THEN
    INSERT INTO public.payment_refunds (
      org_id, return_request_id, ecommerce_order_id, provider,
      provider_payment_id, amount, currency, client_key, status,
      requested_by, requested_at, last_attempt_at
    ) VALUES (
      v_order.org_id, v_request.id, v_order.id, 'mercadopago',
      btrim(v_order.payment_id), v_amount, 'ARS', v_key, 'processing',
      COALESCE(p_requested_by, auth.uid()), now(), now()
    )
    RETURNING * INTO v_refund;
  ELSE
    UPDATE public.payment_refunds
       SET status = 'processing',
           attempt_count = v_refund.attempt_count + 1,
           failure_reason = NULL,
           requested_by = COALESCE(p_requested_by, auth.uid(), requested_by),
           last_attempt_at = now()
     WHERE id = v_refund.id
     RETURNING * INTO v_refund;
  END IF;

  UPDATE public.return_requests
     SET status = 'processing', updated_at = now()
   WHERE id = v_request.id;

  RETURN jsonb_build_object(
    'ok', true, 'refund_id', v_refund.id, 'status', v_refund.status,
    'reused', v_refund.attempt_count > 1, 'already_refunded', false,
    'org_id', v_refund.org_id, 'order_id', v_refund.ecommerce_order_id,
    'payment_id', v_refund.provider_payment_id, 'amount', v_refund.amount,
    'client_key', v_refund.client_key, 'currency', v_refund.currency,
    'is_total', v_is_total
  );
END;
$function$
;

-- ── Verificación: los cuatro bordes, con datos ZZ y limpieza ───────────────
DO $verif$
DECLARE
  v_org uuid; v_store uuid; v_user uuid; v_prod uuid; v_order uuid; v_rma uuid;
  v_sufijo text := 'verif' || substr(md5(clock_timestamp()::text), 1, 8);
  v_fallo text; v_res jsonb;
BEGIN
  SELECT s.org_id, s.id INTO v_org, v_store
    FROM public.ecommerce_stores s WHERE s.slug = 'exentryimports';
  SELECT user_id INTO v_user FROM public.memberships WHERE org_id = v_org LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'sin tienda para verificar; se omite';
    RETURN;
  END IF;

  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, total_cost_usd, stock, is_active)
  VALUES (v_org, v_user, 'ZZ verif reintegro', 1000, 0.25, 5, true) RETURNING id INTO v_prod;

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_name, customer_email,
    items, subtotal, total, payment_method, payment_status, payment_id
  ) VALUES (
    v_org, v_store, 'ZZVERIF-' || v_sufijo, 'ZZ comprador', 'zz@invalid.test',
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'name', 'ZZ', 'quantity', 1, 'unit_price', 1000, 'total', 1000)),
    1000, 1000, 'mercadopago', 'paid', 'zz-mp-' || v_sufijo
  ) RETURNING id INTO v_order;

  -- 1. El monto mayor al total se rechaza, y por el motivo del monto.
  INSERT INTO public.return_requests (org_id, rma_number, ecommerce_order_id,
    customer_name, customer_email, product_name, quantity, status, resolution,
    refund_amount, refund_method, reason_text)
  VALUES (v_org, 'ZZ-A-' || v_sufijo, v_order, 'ZZ', 'zz@invalid.test', 'ZZ', 1,
    'approved', 'refund', 1500, 'original_payment', 'ZZ monto mayor')
  RETURNING id INTO v_rma;
  v_fallo := NULL;
  BEGIN v_res := public.pago_reintegro_preparar(v_rma, v_user);
  EXCEPTION WHEN others THEN v_fallo := SQLERRM; END;
  ASSERT v_fallo LIKE '%supera el saldo disponible%',
    'un reintegro de 1500 sobre una orden de 1000 no se rechazo por monto: ' || COALESCE(v_fallo, '(se preparo)');

  -- 2. refund_method en NULL ya no pasa.
  INSERT INTO public.return_requests (org_id, rma_number, ecommerce_order_id,
    customer_name, customer_email, product_name, quantity, status, resolution,
    refund_amount, reason_text)
  VALUES (v_org, 'ZZ-B-' || v_sufijo, v_order, 'ZZ', 'zz@invalid.test', 'ZZ', 1,
    'approved', 'refund', 500, 'ZZ sin metodo')
  RETURNING id INTO v_rma;
  v_fallo := NULL;
  BEGIN v_res := public.pago_reintegro_preparar(v_rma, v_user);
  EXCEPTION WHEN others THEN v_fallo := SQLERRM; END;
  ASSERT v_fallo LIKE '%medio original%',
    'refund_method en NULL preparo un reintegro: ' || COALESCE(v_fallo, '(se preparo)');

  -- 3. resolution en NULL tampoco.
  INSERT INTO public.return_requests (org_id, rma_number, ecommerce_order_id,
    customer_name, customer_email, product_name, quantity, status,
    refund_amount, refund_method, reason_text)
  VALUES (v_org, 'ZZ-C-' || v_sufijo, v_order, 'ZZ', 'zz@invalid.test', 'ZZ', 1,
    'approved', 500, 'original_payment', 'ZZ sin resolucion')
  RETURNING id INTO v_rma;
  v_fallo := NULL;
  BEGIN v_res := public.pago_reintegro_preparar(v_rma, v_user);
  EXCEPTION WHEN others THEN v_fallo := SQLERRM; END;
  ASSERT v_fallo LIKE '%medio original%',
    'resolution en NULL preparo un reintegro: ' || COALESCE(v_fallo, '(se preparo)');

  -- 4. ⚠️ Y en el otro sentido: lo que SÍ corresponde se sigue aceptando. Un
  --    guard que rechaza todo también "pasa" un test que sólo prueba rechazos.
  INSERT INTO public.return_requests (org_id, rma_number, ecommerce_order_id,
    customer_name, customer_email, product_name, quantity, status, resolution,
    refund_amount, refund_method, reason_text)
  VALUES (v_org, 'ZZ-D-' || v_sufijo, v_order, 'ZZ', 'zz@invalid.test', 'ZZ', 1,
    'approved', 'refund', 1000, 'original_payment', 'ZZ monto exacto')
  RETURNING id INTO v_rma;
  v_fallo := NULL;
  BEGIN v_res := public.pago_reintegro_preparar(v_rma, v_user);
  EXCEPTION WHEN others THEN v_fallo := SQLERRM; END;
  ASSERT v_fallo IS NULL AND (v_res->>'is_total')::boolean,
    'el reintegro del total exacto dejo de aceptarse: ' || COALESCE(v_fallo, v_res::text);

  -- ── Limpieza: no se deja un solo resto ─────────────────────────────────
  DELETE FROM public.payment_refunds WHERE ecommerce_order_id = v_order;
  DELETE FROM public.return_requests WHERE ecommerce_order_id = v_order;
  DELETE FROM public.ecommerce_orders WHERE id = v_order;
  DELETE FROM public.stock_movements WHERE product_id = v_prod;
  DELETE FROM public.products WHERE id = v_prod;

  ASSERT (SELECT count(*) FROM public.products WHERE name = 'ZZ verif reintegro') = 0,
    'quedaron restos ZZ en products';
  ASSERT (SELECT count(*) FROM public.return_requests WHERE rma_number LIKE 'ZZ-%') = 0,
    'quedaron restos ZZ en return_requests';

  RAISE NOTICE 'OK 4/4: monto mayor rechazado, NULL ya no autoriza, y el total exacto sigue aceptandose';
END $verif$;
