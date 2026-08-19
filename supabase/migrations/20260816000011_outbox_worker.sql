-- ═══════════════════════════════════════════════════════════════════════════
-- H2b — El worker que vacía la cola, y los eventos reales del negocio
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El motor de `20260816000010` guarda el evento en la misma transacción que el
-- cambio. Falta lo que lo entrega, y falta que algo lo emita.
--
-- ── Por qué el worker vive en Postgres y no en una Edge Function ──────────
--
-- Porque `pg_net` y `pg_cron` ya están instalados y ya se usan para los 13 cron
-- jobs. Un worker en Edge Function agregaría un deploy más, un secreto más y un
-- punto de falla más para hacer exactamente lo mismo. `docs/ARQUITECTURA.md`
-- dice "los servicios se extraen sólo cuando se justifica": todavía no.
--
-- ── Mandar no es entregar ─────────────────────────────────────────────────
--
-- `net.http_post` es **asincrónico**: devuelve un `request_id` y sigue. La
-- respuesta aparece después en `net._http_response`. Marcar la fila como
-- entregada al mandarla sería mentir — un 500 del destino quedaría como éxito.
--
-- Por eso hay dos pasadas: `outbox_despachar` manda y guarda el `request_id`, y
-- `outbox_confirmar` lee la respuesta y recién ahí marca entregado o fallado.
-- Es la diferencia entre "lo intenté" y "llegó", y es justo la que importa
-- cuando lo que no llegó es el aviso de una venta.
--
-- ── La firma del webhook ──────────────────────────────────────────────────
--
-- Cada entrega va firmada con HMAC-SHA256 sobre el cuerpo, usando el secreto de
-- la suscripción. Sin firma, cualquiera que conozca la URL puede inventarle al
-- comercio una orden que no existe. Este repo ya pagó ese precio del otro lado:
-- **la firma del webhook de MercadoPago nunca se validaba**, así que toda
-- compra quedaba pagada de un lado e impaga del otro, en silencio.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Despachar ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.outbox_despachar(p_limite int DEFAULT 50)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'vault', 'extensions', 'net'
AS $fn$
DECLARE
  v_url    text;
  v_key    text;
  v_fila   public.outbox_events;
  v_sub    public.event_subscriptions;
  v_req    bigint;
  v_n      int := 0;
  v_cuerpo text;
  v_firma  text;
  v_hdrs   jsonb;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY';

  FOR v_fila IN SELECT * FROM public.outbox_tomar(p_limite, 'pg_cron') LOOP
    BEGIN
      SELECT * INTO v_sub FROM public.event_subscriptions WHERE id = v_fila.subscription_id;
      v_cuerpo := v_fila.payload::text;

      IF v_fila.destino = 'interno' THEN
        -- Una función SQL del mismo sistema. Es sincrónico: si no explota,
        -- llegó. `format(%I)` y no concatenación: `objetivo` es un nombre de
        -- función guardado en una tabla, y concatenarlo sería inyección.
        EXECUTE format('SELECT %I($1)', v_fila.objetivo) USING v_fila.payload;
        PERFORM public.outbox_entregado(v_fila.id);
        v_n := v_n + 1;
        CONTINUE;
      END IF;

      IF v_fila.destino = 'edge_function' THEN
        IF v_url IS NULL OR v_key IS NULL THEN
          -- Es el mismo modo de falla que tuvo tumbados los 13 crons durante
          -- meses: sin los secretos del vault, todo falla en silencio. Acá al
          -- menos queda escrito en la fila.
          PERFORM public.outbox_fallado(v_fila.id,
            'faltan SUPABASE_URL o SUPABASE_ANON_KEY en el vault');
          CONTINUE;
        END IF;
        v_hdrs := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key,
          'apikey', v_key,
          'X-Gestiona-Event', v_fila.event_type,
          'X-Gestiona-Event-Id', v_fila.event_id::text);

        v_req := net.http_post(
          url     := v_url || '/functions/v1/' || v_fila.objetivo,
          body    := v_fila.payload,
          headers := v_hdrs,
          timeout_milliseconds := 15000);

      ELSE  -- webhook
        v_hdrs := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Gestiona-Event', v_fila.event_type,
          'X-Gestiona-Event-Id', v_fila.event_id::text,
          'X-Gestiona-Delivery', v_fila.id::text);

        -- Firma HMAC-SHA256 del cuerpo. Quien recibe recalcula y compara: sin
        -- esto, conocer la URL alcanza para inventar una venta.
        IF COALESCE(v_sub.config->>'secret', '') <> '' THEN
          v_firma := encode(
            extensions.hmac(v_cuerpo, v_sub.config->>'secret', 'sha256'), 'hex');
          v_hdrs := v_hdrs || jsonb_build_object('X-Gestiona-Signature', 'sha256=' || v_firma);
        END IF;

        v_req := net.http_post(
          url     := v_fila.objetivo,
          body    := v_fila.payload,
          headers := v_hdrs,
          timeout_milliseconds := 15000);
      END IF;

      -- Queda en `en_curso` con el request_id. La confirmación es de la otra
      -- pasada: mandar no es entregar.
      UPDATE public.outbox_events SET request_id = v_req WHERE id = v_fila.id;
      v_n := v_n + 1;

    EXCEPTION WHEN OTHERS THEN
      -- Que una entrega explote no puede frenar a las otras 49.
      PERFORM public.outbox_fallado(v_fila.id, left(SQLERRM, 500));
    END;
  END LOOP;

  RETURN v_n;
END;
$fn$;

COMMENT ON FUNCTION public.outbox_despachar IS
  'Manda las entregas pendientes. NO las marca entregadas: pg_net es asincronico y la respuesta la lee outbox_confirmar.';

-- ── 2. Confirmar ───────────────────────────────────────────────────────────
--
-- Un 2xx es entregado. Cualquier otra cosa —o un error de red— es fallado, y
-- vuelve a la cola con backoff. Una fila mandada hace más de 5 minutos sin
-- respuesta se da por perdida: `net._http_response` tiene retención corta y
-- esperar para siempre la dejaría trabada.

CREATE OR REPLACE FUNCTION public.outbox_confirmar()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $fn$
DECLARE
  v_fila public.outbox_events;
  v_rsp  record;
  v_n    int := 0;
BEGIN
  FOR v_fila IN
    SELECT * FROM public.outbox_events
     WHERE estado = 'en_curso' AND request_id IS NOT NULL
  LOOP
    SELECT status_code, error_msg, content INTO v_rsp
      FROM net._http_response WHERE id = v_fila.request_id;

    IF NOT FOUND THEN
      -- Todavía no respondió. `outbox_tomar` la rescata si pasan 5 minutos.
      CONTINUE;
    END IF;

    IF v_rsp.status_code BETWEEN 200 AND 299 THEN
      PERFORM public.outbox_entregado(v_fila.id);
    ELSE
      PERFORM public.outbox_fallado(v_fila.id,
        COALESCE(v_rsp.error_msg,
                 'HTTP ' || COALESCE(v_rsp.status_code::text, '?') || ' ' || left(COALESCE(v_rsp.content, ''), 300)));
    END IF;
    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$fn$;

-- ── 3. Los eventos del negocio ─────────────────────────────────────────────
--
-- Se emiten desde triggers y no desde las funciones de negocio a propósito: un
-- trigger no se puede olvidar. `create_store_order`, el POS offline que
-- sincroniza, una corrección a mano desde el panel y un import de MercadoLibre
-- crean órdenes por caminos distintos, y todos pasan por el INSERT.

CREATE OR REPLACE FUNCTION public.trg_eventos_de_orden()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_datos jsonb;
BEGIN
  v_datos := jsonb_build_object(
    'order_id', NEW.id, 'order_number', NEW.order_number,
    'total', NEW.total, 'subtotal', NEW.subtotal,
    'shipping_cost', NEW.shipping_cost, 'discount_amount', NEW.discount_amount,
    'tax_amount', NEW.tax_amount, 'currency', 'ARS',
    'customer_email', NEW.customer_email, 'customer_name', NEW.customer_name,
    'payment_method', NEW.payment_method, 'coupon_code', NEW.coupon_code,
    'items', NEW.items);

  IF TG_OP = 'INSERT' THEN
    PERFORM public.emitir_evento(
      NEW.org_id, 'orden', NEW.id, 'orden.creada', v_datos);
    RETURN NEW;
  END IF;

  -- El estado de pago sólo genera evento cuando **cambia**: un UPDATE que toca
  -- otra columna no es una venta nueva.
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    PERFORM public.emitir_evento(
      NEW.org_id, 'orden', NEW.id,
      CASE NEW.payment_status
        WHEN 'paid'     THEN 'orden.pagada'
        WHEN 'refunded' THEN 'orden.reembolsada'
        WHEN 'failed'   THEN 'orden.fallida'
        ELSE 'orden.pago_actualizado'
      END,
      v_datos || jsonb_build_object(
        'payment_status', NEW.payment_status,
        'payment_status_anterior', OLD.payment_status,
        'payment_id', NEW.payment_id));
  END IF;

  IF NEW.fulfillment_status IS DISTINCT FROM OLD.fulfillment_status THEN
    PERFORM public.emitir_evento(
      NEW.org_id, 'orden', NEW.id,
      CASE NEW.fulfillment_status
        WHEN 'shipped'   THEN 'orden.despachada'
        WHEN 'delivered' THEN 'orden.entregada'
        ELSE 'orden.entrega_actualizada'
      END,
      v_datos || jsonb_build_object(
        'fulfillment_status', NEW.fulfillment_status,
        'tracking_number', NEW.tracking_number,
        'carrier', NEW.carrier));
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_orden_eventos ON public.ecommerce_orders;
CREATE TRIGGER trg_orden_eventos
  AFTER INSERT OR UPDATE OF payment_status, fulfillment_status ON public.ecommerce_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_eventos_de_orden();

-- El inventario ya es un ledger; esto lo hace **audible**. Con el evento, la
-- alerta de reposición, la sincronización con MercadoLibre y la analítica dejan
-- de tener que consultar la tabla para enterarse.
CREATE OR REPLACE FUNCTION public.trg_eventos_de_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  -- El agregado es el producto, no el movimiento: la versión del evento sirve
  -- para leer la historia de ESE producto en orden.
  PERFORM public.emitir_evento(
    NEW.org_id, 'producto', COALESCE(NEW.product_id, NEW.variant_id), 'stock.movido',
    jsonb_build_object(
      'movement_id', NEW.id,
      'product_id', NEW.product_id, 'variant_id', NEW.variant_id,
      'delta', NEW.quantity, 'stock_after', NEW.stock_after,
      'tipo', NEW.movement_type, 'referencia', NEW.reference_id,
      'referencia_tipo', NEW.reference_type, 'nota', NEW.notes));
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_stock_eventos ON public.stock_movements;
CREATE TRIGGER trg_stock_eventos
  AFTER INSERT ON public.stock_movements
  FOR EACH ROW WHEN (NEW.org_id IS NOT NULL AND COALESCE(NEW.product_id, NEW.variant_id) IS NOT NULL)
  EXECUTE FUNCTION public.trg_eventos_de_stock();

-- ── 4. El cron ─────────────────────────────────────────────────────────────
--
-- Cada minuto: despachar y confirmar. No hace falta más frecuencia — un evento
-- que tarda 60 segundos en salir no rompe nada, y el costo de despertar la base
-- cada segundo sí se nota.

DO $fn$
BEGIN
  PERFORM cron.unschedule('outbox-despachar');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$fn$;

DO $fn$
BEGIN
  PERFORM cron.unschedule('outbox-confirmar');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$fn$;

DO $fn$
BEGIN
  PERFORM cron.unschedule('outbox-limpiar');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$fn$;

SELECT cron.schedule('outbox-despachar', '* * * * *', 'SELECT public.outbox_despachar(100)');
SELECT cron.schedule('outbox-confirmar', '* * * * *', 'SELECT public.outbox_confirmar()');
SELECT cron.schedule('outbox-limpiar', '17 4 * * *', 'SELECT public.outbox_limpiar()');
