-- Saldo a favor combinado con Nerqia Pay (Mercado Pago) (2026-10-30).
--
-- Hasta 20261030001500 el saldo a favor parcial se combinaba sólo con
-- transferencia o efectivo: quien pagaba online tenía que usar el saldo
-- entero o no usarlo. Ahora también con Nerqia Pay:
--
--   · `aplicar_saldo_a_pedido` acepta pedidos de Nerqia Pay. Si el comprador
--     ya abrió un pago vigente con Mercado Pago (preparado por el total), no
--     aplica: dos cobros vivos para un pedido es lo que el orquestador evita.
--     Vencido ese intento (24 h), sí.
--   · La intención de pago registra lo que se cobra: el total menos el saldo
--     (disparador sobre payment_intents; store-pay cobra ese mismo importe).
--   · `acreditar_pago_de_pedido` reemplaza a mark_store_order_paid en el
--     webhook y en el pago con tarjeta, con el importe que informa Mercado
--     Pago. En un pedido con saldo:
--       - lo que resta: se acredita y la venta reparte saldo y Mercado Pago;
--       - el total (un pago abierto antes de aplicar el saldo): se acredita y
--         el saldo vuelve al cliente, porque no hizo falta;
--       - otro importe: no se acredita solo; avisa al dueño y a los
--         administradores.
--     Un pedido sin saldo se acredita como siempre.
--   · Al cancelarse sin pagar o al liberarse el saldo a los 7 días, los
--     intentos de pago vigentes del pedido vencen: el próximo pago se prepara
--     de cero por el importe nuevo, con otra clave ante Mercado Pago. La
--     liberación a los 7 días espera si hay un pago en curso.
--   · Reintegros: Mercado Pago cobró sólo lo que restaba. Por Mercado Pago se
--     reintegra la devolución completa (lo que cobró, y el saldo vuelve como
--     saldo); una devolución parcial se resuelve con saldo a favor. El pedido
--     queda reintegrado cuando se devolvió todo lo que cobró Mercado Pago.

BEGIN;

-- ── La intención de pago registra lo que se cobra ───────────────────────
-- pago_intento_preparar está parcheada en caliente (20260821000057): no se
-- reescribe. El importe se corrige al insertar la intención.
CREATE OR REPLACE FUNCTION public.trg_intento_cobra_lo_que_resta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_cobrar numeric;
BEGIN
  IF NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT round(COALESCE(o.total, 0) - COALESCE(o.saldo_aplicado_ars, 0), 2) INTO v_cobrar
    FROM public.ecommerce_orders o WHERE o.id = NEW.order_id;
  IF v_cobrar > 0 AND v_cobrar < NEW.monto THEN
    NEW.monto := v_cobrar;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.trg_intento_cobra_lo_que_resta() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_intento_cobra_lo_que_resta ON public.payment_intents;
CREATE TRIGGER trg_intento_cobra_lo_que_resta
  BEFORE INSERT ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.trg_intento_cobra_lo_que_resta();

-- ── Cuando cambia lo que hay que cobrar, los pagos abiertos vencen ──────
CREATE OR REPLACE FUNCTION public.vencer_intentos_de_pago_del_pedido(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.payment_intents
     SET estado = 'expirado', updated_at = now()
   WHERE order_id = p_order_id AND estado IN ('pendiente', 'procesando');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.vencer_intentos_de_pago_del_pedido(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_pedido_devuelve_saldo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.payment_status = 'refunded' AND OLD.payment_status IS DISTINCT FROM 'refunded' THEN
    PERFORM public.devolver_saldo_usado_en_pedido(NEW.id,
      format('Devolución del saldo del pedido %s: se reintegró', NEW.order_number));
    RETURN NEW;
  END IF;
  IF NEW.fulfillment_status = 'cancelled'
     AND NEW.payment_status IN ('pending', 'failed')
     AND COALESCE(NEW.saldo_aplicado_ars, 0) > 0 THEN
    PERFORM public.devolver_saldo_usado_en_pedido(NEW.id,
      format('Devolución del saldo del pedido %s: se canceló sin pagar', NEW.order_number));
    -- Un pago abierto se preparó por lo que restaba: ya no vale.
    PERFORM public.vencer_intentos_de_pago_del_pedido(NEW.id);
    NEW.saldo_aplicado_ars := 0;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.trg_pedido_devuelve_saldo() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.liberar_saldo_de_pedidos_impagos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_o record;
  v_n integer := 0;
BEGIN
  FOR v_o IN
    SELECT o.id, o.order_number
      FROM public.ecommerce_orders o
     WHERE o.saldo_aplicado_ars > 0
       AND o.payment_status IN ('pending', 'failed')
       AND o.fulfillment_status IS DISTINCT FROM 'cancelled'
       AND EXISTS (SELECT 1 FROM public.saldo_a_favor_movimientos m
                    WHERE m.ecommerce_order_id = o.id AND m.monto_ars < 0
                      AND m.created_at < now() - interval '7 days')
       -- Con un pago de Mercado Pago en curso se espera: el comprador está pagando.
       AND NOT EXISTS (SELECT 1 FROM public.payment_intents i
                        WHERE i.order_id = o.id AND i.estado IN ('pendiente', 'procesando')
                          AND i.expira_at > now())
     ORDER BY o.created_at
     LIMIT 500
     FOR UPDATE OF o SKIP LOCKED
  LOOP
    PERFORM public.devolver_saldo_usado_en_pedido(v_o.id,
      format('Devolución del saldo del pedido %s: no se pagó en 7 días', v_o.order_number));
    PERFORM public.vencer_intentos_de_pago_del_pedido(v_o.id);
    UPDATE public.ecommerce_orders SET saldo_aplicado_ars = 0, updated_at = now() WHERE id = v_o.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.liberar_saldo_de_pedidos_impagos() FROM PUBLIC, anon, authenticated;

-- ── El comprador aplica su saldo también a un pedido de Nerqia Pay ──────
CREATE OR REPLACE FUNCTION public.aplicar_saldo_a_pedido(p_slug text, p_order_number text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_store record;
  v_order public.ecommerce_orders%ROWTYPE;
  v_cliente uuid;
  v_saldo numeric;
  v_aplicar numeric;
  v_total numeric;
  v_nombre text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Ingresá con tu cuenta para usar tu saldo a favor' USING ERRCODE = '42501';
  END IF;
  SELECT s.id, s.org_id INTO v_store FROM public.ecommerce_stores s
   WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active LIMIT 1;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'La tienda no está disponible' USING ERRCODE = '22023';
  END IF;
  v_cliente := public.cliente_del_comprador(v_store.id);
  IF v_cliente IS NULL THEN
    RAISE EXCEPTION 'No tenés saldo a favor en esta tienda' USING ERRCODE = '22023';
  END IF;
  -- La misma cerradura que el checkout: dos pedidos no usan el mismo saldo.
  PERFORM pg_advisory_xact_lock(hashtextextended('saldo_a_favor:' || v_cliente::text, 0));

  SELECT * INTO v_order FROM public.ecommerce_orders
   WHERE store_id = v_store.id AND order_number = btrim(COALESCE(p_order_number, '')) FOR UPDATE;
  -- El pedido tiene que ser suyo: por su cuenta de la tienda o por su email.
  -- Mismo mensaje si no existe o es ajeno: no se averigua qué compró otro.
  IF v_order.id IS NULL OR NOT (
       EXISTS (SELECT 1 FROM public.store_customers sc WHERE sc.id = v_order.store_customer_id AND sc.user_id = auth.uid())
       OR lower(btrim(COALESCE(v_order.customer_email, ''))) = lower(btrim(COALESCE((SELECT u.email FROM auth.users u WHERE u.id = auth.uid()), '-')))) THEN
    RAISE EXCEPTION 'No encontramos ese pedido en tu cuenta' USING ERRCODE = '22023';
  END IF;
  IF v_order.payment_status <> 'pending' THEN
    RAISE EXCEPTION 'El pedido ya no está pendiente de pago' USING ERRCODE = '22023';
  END IF;
  IF v_order.fulfillment_status = 'cancelled' THEN
    RAISE EXCEPTION 'El pedido está cancelado' USING ERRCODE = '22023';
  END IF;
  IF lower(btrim(COALESCE(v_order.payment_method, ''))) NOT IN ('transferencia', 'efectivo', 'gestiona_pay', 'mercadopago') THEN
    RAISE EXCEPTION 'El saldo a favor se combina con transferencia, efectivo o Nerqia Pay' USING ERRCODE = '22023';
  END IF;
  v_total := round(COALESCE(v_order.total, 0), 2);
  IF COALESCE(v_order.saldo_aplicado_ars, 0) > 0 THEN
    RETURN jsonb_build_object('ok', true, 'aplicado', v_order.saldo_aplicado_ars,
                              'resta', v_total - v_order.saldo_aplicado_ars, 'ya_aplicado', true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.saldo_a_favor_movimientos m
              WHERE m.ecommerce_order_id = v_order.id AND m.monto_ars < 0) THEN
    RAISE EXCEPTION 'Este pedido ya usó tu saldo a favor y te lo devolvimos. Para usarlo de nuevo, hacé un pedido nuevo.'
      USING ERRCODE = '22023';
  END IF;
  -- Un pago con Mercado Pago ya abierto se preparó por el total: con el saldo
  -- aplicado habría dos cobros posibles para el mismo pedido.
  IF EXISTS (SELECT 1 FROM public.payment_intents i
              WHERE i.order_id = v_order.id AND i.estado IN ('pendiente', 'procesando')
                AND i.expira_at > now()) THEN
    RAISE EXCEPTION 'Ya abriste el pago de este pedido con Mercado Pago. Si no lo completaste, vas a poder usar tu saldo cuando venza ese pago (24 horas) o en un pedido nuevo.'
      USING ERRCODE = '22023';
  END IF;
  -- Los vencidos que siguen figurando vivos se cierran: el próximo pago se
  -- prepara por lo que resta.
  PERFORM public.vencer_intentos_de_pago_del_pedido(v_order.id);

  SELECT COALESCE(sum(m.monto_ars), 0) INTO v_saldo FROM public.saldo_a_favor_movimientos m
   WHERE m.org_id = v_store.org_id AND m.customer_id = v_cliente;
  v_aplicar := LEAST(round(v_saldo, 2), v_total);
  IF v_aplicar <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'aplicado', 0, 'resta', v_total);
  END IF;

  SELECT c.name INTO v_nombre FROM public.customers c WHERE c.id = v_cliente;
  INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por, ecommerce_order_id)
  VALUES (v_store.org_id, v_cliente, COALESCE(v_nombre, v_order.customer_name), -v_aplicar,
          format('Aplicado al pedido %s', v_order.order_number), auth.uid(), v_order.id);
  UPDATE public.ecommerce_orders SET saldo_aplicado_ars = v_aplicar, updated_at = now() WHERE id = v_order.id;

  -- El saldo cubrió todo: pagado en el acto, como el checkout con saldo.
  IF v_aplicar >= v_total THEN
    PERFORM public.mark_store_order_paid(v_order.id, 'saldo-' || v_order.order_number, 'saldo_a_favor');
  END IF;
  RETURN jsonb_build_object('ok', true, 'aplicado', v_aplicar, 'resta', v_total - v_aplicar, 'pagado', v_aplicar >= v_total);
END;
$fn$;
REVOKE ALL ON FUNCTION public.aplicar_saldo_a_pedido(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aplicar_saldo_a_pedido(text, text) TO authenticated;

-- ── Acreditar con el importe que informó Mercado Pago ───────────────────
CREATE OR REPLACE FUNCTION public.acreditar_pago_de_pedido(
  p_order_id uuid,
  p_payment_id text,
  p_monto numeric,
  p_method text DEFAULT 'mercado_pago'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order record;
  v_total numeric;
  v_saldo numeric;
  v_cobrar numeric;
  v_devuelto numeric;
  v_r jsonb;
BEGIN
  SELECT o.id, o.org_id, o.order_number, o.total, o.saldo_aplicado_ars, o.payment_status INTO v_order
    FROM public.ecommerce_orders o WHERE o.id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;
  v_total := round(COALESCE(v_order.total, 0), 2);
  v_saldo := round(COALESCE(v_order.saldo_aplicado_ars, 0), 2);

  -- Ya pagado, sin importe informado o sin saldo de por medio: el camino de
  -- siempre (idempotente).
  IF v_order.payment_status = 'paid' OR p_monto IS NULL
     OR (v_saldo = 0 AND NOT EXISTS (SELECT 1 FROM public.saldo_a_favor_movimientos m
                                     WHERE m.ecommerce_order_id = v_order.id)) THEN
    RETURN public.mark_store_order_paid(p_order_id, p_payment_id, p_method);
  END IF;

  v_cobrar := round(v_total - v_saldo, 2);
  IF abs(round(p_monto, 2) - v_cobrar) <= 0.01 THEN
    RETURN public.mark_store_order_paid(p_order_id, p_payment_id, p_method);
  END IF;

  -- Mercado Pago cobró el total (un pago abierto antes de aplicar el saldo):
  -- el saldo no hizo falta y vuelve; la venta queda entera por Mercado Pago.
  IF v_saldo > 0 AND abs(round(p_monto, 2) - v_total) <= 0.01 THEN
    v_devuelto := public.devolver_saldo_usado_en_pedido(v_order.id,
      format('Devolución del saldo del pedido %s: Mercado Pago cobró el total', v_order.order_number));
    UPDATE public.ecommerce_orders SET saldo_aplicado_ars = 0, updated_at = now() WHERE id = v_order.id;
    v_r := public.mark_store_order_paid(p_order_id, p_payment_id, p_method);
    RETURN v_r || jsonb_build_object('saldo_devuelto', v_devuelto);
  END IF;

  -- Ni lo que resta ni el total: no se acredita solo.
  BEGIN
    INSERT INTO public.notifications (user_id, org_id, title, message, type, entity_type, entity_id)
    SELECT m.user_id, v_order.org_id, 'Cobro con un importe distinto',
           format('Pedido %s: Mercado Pago acreditó %s y el pedido espera %s. No se marcó como pagado: revisalo antes de despacharlo.',
                  v_order.order_number, to_char(p_monto, 'FM$999G999G999D00'), to_char(v_cobrar, 'FM$999G999G999D00')),
           'ecommerce', 'ecommerce_order', v_order.id::text
      FROM public.memberships m
     WHERE m.org_id = v_order.org_id AND m.role IN ('owner', 'admin');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'acreditar_pago_de_pedido: no se pudo avisar del importe distinto del pedido %: %',
      v_order.order_number, SQLERRM;
  END;
  RETURN jsonb_build_object('ok', false, 'acreditado', false, 'motivo', 'monto_distinto',
                            'esperado', v_cobrar, 'cobrado', round(p_monto, 2));
END;
$fn$;
REVOKE ALL ON FUNCTION public.acreditar_pago_de_pedido(uuid, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acreditar_pago_de_pedido(uuid, text, numeric, text) TO service_role;

-- ── Reintegros de un pedido pagado en parte con saldo ───────────────────

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
         round(COALESCE(o.total, 0), 2) AS total,
         round(COALESCE(o.saldo_aplicado_ars, 0), 2) AS saldo
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

  IF v_order.saldo > 0 THEN
    -- Pagado en parte con saldo a favor (20261030001700): Mercado Pago cobró
    -- sólo el resto. Por Mercado Pago se reintegra la devolución completa;
    -- el saldo vuelve como saldo cuando el pedido queda reintegrado.
    v_remaining := round(v_order.total - v_order.saldo - v_refunded, 2);
    IF v_remaining <= 0 THEN
      RAISE EXCEPTION 'La orden % ya tiene reintegrado todo lo que cobró Mercado Pago', v_order.order_number;
    END IF;
    IF v_amount < round(v_order.total - v_refunded, 2) THEN
      RAISE EXCEPTION 'La orden % se pagó en parte con saldo a favor: una devolución parcial se resuelve con saldo a favor. Por Mercado Pago se reintegra sólo la devolución completa.',
        v_order.order_number;
    END IF;
    IF v_amount > round(v_order.total - v_refunded, 2) THEN
      RAISE EXCEPTION 'El reintegro de % supera el total de % de la orden %',
        v_amount, round(v_order.total - v_refunded, 2), v_order.order_number;
    END IF;
    v_amount := v_remaining;
    v_is_total := true;
  ELSE
    v_remaining := round(v_order.total - v_refunded, 2);
    IF v_remaining <= 0 THEN
      RAISE EXCEPTION 'La orden % ya tiene reintegrado todo su total', v_order.order_number;
    END IF;
    IF v_amount > v_remaining THEN
      RAISE EXCEPTION 'El reintegro de % supera el saldo disponible de % en la orden %',
        v_amount, v_remaining, v_order.order_number;
    END IF;
    v_is_total := v_amount >= v_remaining;
  END IF;
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

CREATE OR REPLACE FUNCTION public.pago_reintegro_resultado(
  p_refund_id       uuid,
  p_status          text,
  p_external_id     text DEFAULT NULL,
  p_raw             jsonb DEFAULT NULL,
  p_failure_reason  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_refund       record;
  v_order        record;
  v_total_refund numeric := 0;
  v_order_status text;
BEGIN
  IF lower(COALESCE(p_status, '')) NOT IN ('refunded', 'failed') THEN
    RAISE EXCEPTION 'Resultado de reintegro inválido: %', p_status;
  END IF;

  SELECT * INTO v_refund
  FROM public.payment_refunds
  WHERE id = p_refund_id
  FOR UPDATE;
  IF v_refund.id IS NULL THEN
    RAISE EXCEPTION 'Reintegro no encontrado';
  END IF;

  IF v_refund.status = 'refunded' AND lower(p_status) = 'refunded' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', 'refunded');
  END IF;

  IF lower(p_status) = 'failed' THEN
    UPDATE public.payment_refunds
       SET status = 'failed',
           failure_reason = NULLIF(left(btrim(COALESCE(p_failure_reason, '')), 500), ''),
           raw = CASE WHEN p_raw IS NULL THEN raw ELSE p_raw END,
           updated_at = now()
     WHERE id = v_refund.id;
    UPDATE public.return_requests
       SET status = 'approved', updated_at = now()
     WHERE id = v_refund.return_request_id
       AND status = 'processing';
    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'status', 'failed');
  END IF;

  SELECT id, org_id, order_number, total, payment_status, fulfillment_status,
         payment_id, saldo_aplicado_ars
    INTO v_order
  FROM public.ecommerce_orders
  WHERE id = v_refund.ecommerce_order_id
  FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'La orden del reintegro no existe';
  END IF;

  UPDATE public.payment_refunds
     SET status = 'refunded',
         external_refund_id = NULLIF(btrim(COALESCE(p_external_id, '')), ''),
         failure_reason = NULL,
         raw = p_raw,
         processed_at = now(),
         updated_at = now()
   WHERE id = v_refund.id;

  UPDATE public.return_requests
     SET status = 'resolved', resolved_at = now(), updated_at = now()
   WHERE id = v_refund.return_request_id;

  SELECT round(COALESCE(sum(pr.amount), 0), 2) INTO v_total_refund
  FROM public.payment_refunds pr
  WHERE pr.org_id = v_refund.org_id
    AND pr.ecommerce_order_id = v_refund.ecommerce_order_id
    AND pr.status = 'refunded';

  -- Lo que se puede reintegrar es lo que cobró Mercado Pago: el total menos
  -- lo pagado con saldo a favor (20261030001700). Reintegrado eso, el pedido
  -- queda reintegrado y el saldo vuelve (trg_pedido_devuelve_saldo).
  v_order_status := CASE
    WHEN v_total_refund >= round(v_order.total - COALESCE(v_order.saldo_aplicado_ars, 0), 2) THEN 'refunded'
    ELSE 'partial'
  END;

  UPDATE public.ecommerce_orders
     SET payment_status = v_order_status,
         payment_reversed_at = COALESCE(payment_reversed_at, now()),
         payment_reversal_reason = CASE
           WHEN v_order_status = 'refunded' THEN 'Reintegro total ejecutado por Gestiona'
           ELSE format('Reintegro parcial ejecutado por Gestiona: %s de %s', v_total_refund, v_order.total)
         END,
         fulfillment_status = CASE
           WHEN v_order_status = 'refunded'
            AND fulfillment_status IN ('pending', 'processing') THEN 'cancelled'
           ELSE fulfillment_status
         END,
         updated_at = now()
   WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false, 'status', 'refunded',
    'order_payment_status', v_order_status,
    'total_refunded', v_total_refund
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.pago_reintegro_preparar(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pago_reintegro_preparar(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.pago_reintegro_resultado(uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pago_reintegro_resultado(uuid, text, text, jsonb, text) TO service_role;

WITH c(function_name, audience, rationale) AS (VALUES
  ('aplicar_saldo_a_pedido', 'public_token', 'El comprador logueado aplica su saldo a su propio pedido pendiente (transferencia, efectivo o Nerqia Pay), una vez, con cerradura por cliente y sin un pago abierto.'),
  ('trg_pedido_devuelve_saldo', 'security_helper', 'Trigger: devuelve el saldo de un pedido reintegrado o cancelado sin pagar y vence sus pagos abiertos; un rechazo lo deja reservado.'),
  ('liberar_saldo_de_pedidos_impagos', 'security_helper', 'pg_cron: devuelve el saldo reservado por pedidos impagos a los 7 días, salvo con un pago en curso.'),
  ('trg_intento_cobra_lo_que_resta', 'security_helper', 'Trigger: la intención de pago de un pedido con saldo registra el total menos el saldo aplicado.'),
  ('vencer_intentos_de_pago_del_pedido', 'security_helper', 'Interna: vence los pagos abiertos de un pedido cuando cambia lo que hay que cobrar.'),
  ('acreditar_pago_de_pedido', 'security_helper', 'service_role: acredita un pago de Mercado Pago según el importe cobrado y el saldo aplicado al pedido.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
