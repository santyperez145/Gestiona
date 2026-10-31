-- El saldo a favor de un pedido impago queda reservado (2026-10-30).
--
-- 20261030001400 devolvía el saldo aplicado apenas un pedido fallaba, se
-- reintegraba, tenía un contracargo o se cancelaba sin pagar, pero el pedido
-- seguía diciendo que una parte se había pagado con saldo:
--
--   · Un pago rechazado se reintenta sobre el mismo pedido (store-pay acepta
--     pedidos 'failed' y la confirmación manual también). Con el saldo ya
--     devuelto, el reintento cobraba sólo la diferencia: el comercio entregaba
--     el total y cobraba menos.
--   · Una transferencia que llegaba tarde a un pedido cancelado se repartía
--     como si el saldo siguiera aplicado.
--   · Un contracargo devolvía el saldo solo, aunque la disputa todavía se
--     pueda ganar.
--
-- Ahora:
--   · Pago rechazado: no vuelve nada. El saldo queda reservado para el pedido
--     y el reintento cobra la diferencia.
--   · Cancelado sin pagar: el saldo vuelve y el pedido deja de tenerlo
--     aplicado (si después se cobra, se cobra completo).
--   · Reintegrado: el saldo vuelve. El pedido conserva cuánto se pagó con
--     saldo, porque es historia: el contraasiento revierte el asiento entero.
--   · Contracargo: no vuelve solo. Lo decide el dueño o un administrador con
--     `devolver_saldo_del_pedido`, que queda en la auditoría.
--   · Siete días impago con saldo reservado: el saldo vuelve solo (pg_cron,
--     cada hora) y el pedido queda pendiente por el total.
--   · `aplicar_saldo_a_pedido` no aplica saldo a un pedido cancelado ni a uno
--     que ya lo usó y lo devolvió (antes chocaba con el índice único).

BEGIN;

-- ── Devolver lo usado en un pedido, una sola vez ────────────────────────
CREATE OR REPLACE FUNCTION public.devolver_saldo_usado_en_pedido(p_order_id uuid, p_motivo text)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_neto numeric;
  v_cliente uuid;
  v_nombre text;
  v_org uuid;
  v_id uuid;
BEGIN
  -- Lo usado de saldo en el pedido, neto de lo ya devuelto. El índice único
  -- saldo_a_favor_pedido_uq admite una sola devolución por pedido.
  SELECT -COALESCE(sum(m.monto_ars), 0),
         (array_agg(m.customer_id ORDER BY m.created_at))[1],
         (array_agg(m.customer_name ORDER BY m.created_at))[1],
         (array_agg(m.org_id ORDER BY m.created_at))[1]
    INTO v_neto, v_cliente, v_nombre, v_org
    FROM public.saldo_a_favor_movimientos m
   WHERE m.ecommerce_order_id = p_order_id;
  IF COALESCE(v_neto, 0) <= 0 OR v_cliente IS NULL THEN
    RETURN 0;
  END IF;
  INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por, ecommerce_order_id)
  VALUES (v_org, v_cliente, v_nombre, v_neto, p_motivo, auth.uid(), p_order_id)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  RETURN CASE WHEN v_id IS NULL THEN 0 ELSE v_neto END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.devolver_saldo_usado_en_pedido(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── Cuándo vuelve solo ──────────────────────────────────────────────────
-- BEFORE: el pedido cancelado deja de tener el saldo aplicado en la misma
-- escritura que lo devuelve.
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
    NEW.saldo_aplicado_ars := 0;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.trg_pedido_devuelve_saldo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_pedido_devuelve_saldo ON public.ecommerce_orders;
CREATE TRIGGER trg_pedido_devuelve_saldo
  BEFORE UPDATE OF payment_status, fulfillment_status ON public.ecommerce_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_pedido_devuelve_saldo();

-- Pedidos que la versión anterior dejó con el saldo devuelto y todavía
-- aplicado: si no se pagaron, se cobran completos.
UPDATE public.ecommerce_orders o
   SET saldo_aplicado_ars = 0, updated_at = now()
 WHERE o.saldo_aplicado_ars > 0
   AND o.payment_status IN ('pending', 'failed')
   AND EXISTS (SELECT 1 FROM public.saldo_a_favor_movimientos m
                WHERE m.ecommerce_order_id = o.id AND m.monto_ars > 0);

-- ── Contracargo: lo decide el comercio ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.devolver_saldo_del_pedido(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order record;
  v_devuelto numeric;
BEGIN
  SELECT o.id, o.org_id, o.order_number, o.payment_status INTO v_order
    FROM public.ecommerce_orders o WHERE o.id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL OR auth.uid() IS NULL
     OR NOT public.has_org_role(v_order.org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador devuelve el saldo de un pedido' USING ERRCODE = '42501';
  END IF;
  IF v_order.payment_status IS DISTINCT FROM 'charged_back' THEN
    RAISE EXCEPTION 'Sólo se devuelve a mano el saldo de un pedido con contracargo; en los demás casos vuelve solo'
      USING ERRCODE = '22023';
  END IF;
  v_devuelto := public.devolver_saldo_usado_en_pedido(v_order.id,
    format('Devolución del saldo del pedido %s: contracargo', v_order.order_number));
  IF v_devuelto > 0 THEN
    INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
    VALUES (auth.uid(), v_order.org_id, 'store_credit_returned', 'ecommerce_order', v_order.id::text,
            jsonb_build_object('monto', v_devuelto, 'motivo', 'contracargo', 'pedido', v_order.order_number));
  END IF;
  RETURN jsonb_build_object('ok', true, 'devuelto', v_devuelto);
END;
$fn$;
REVOKE ALL ON FUNCTION public.devolver_saldo_del_pedido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.devolver_saldo_del_pedido(uuid) TO authenticated;

-- ── Siete días impago: el saldo vuelve ──────────────────────────────────
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
     ORDER BY o.created_at
     LIMIT 500
     FOR UPDATE OF o SKIP LOCKED
  LOOP
    PERFORM public.devolver_saldo_usado_en_pedido(v_o.id,
      format('Devolución del saldo del pedido %s: no se pagó en 7 días', v_o.order_number));
    UPDATE public.ecommerce_orders SET saldo_aplicado_ars = 0, updated_at = now() WHERE id = v_o.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.liberar_saldo_de_pedidos_impagos() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('liberar-saldo-de-pedidos-impagos')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'liberar-saldo-de-pedidos-impagos');
  PERFORM cron.schedule('liberar-saldo-de-pedidos-impagos', '41 * * * *', 'SELECT public.liberar_saldo_de_pedidos_impagos()');
END $$;

-- ── El comprador aplica su saldo: no a un pedido cancelado ni dos veces ─
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
  IF lower(btrim(COALESCE(v_order.payment_method, ''))) NOT IN ('transferencia', 'efectivo') THEN
    RAISE EXCEPTION 'El saldo a favor se combina con transferencia o efectivo' USING ERRCODE = '22023';
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

WITH c(function_name, audience, rationale) AS (VALUES
  ('devolver_saldo_usado_en_pedido', 'security_helper', 'Interna: devuelve una sola vez el saldo neto usado en un pedido (índice único por pedido).'),
  ('devolver_saldo_del_pedido', 'authenticated_delegate', 'Dueño o administrador: devuelve el saldo de un pedido con contracargo; queda en la auditoría.'),
  ('liberar_saldo_de_pedidos_impagos', 'security_helper', 'pg_cron: devuelve el saldo reservado por pedidos que siguen impagos a los 7 días.'),
  ('trg_pedido_devuelve_saldo', 'security_helper', 'Trigger: devuelve el saldo de un pedido reintegrado o cancelado sin pagar; un rechazo lo deja reservado.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

-- aplicar_saldo_a_pedido ya tenía contrato: misma audiencia, huella nueva.
UPDATE public.security_function_contracts sc
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
 WHERE sc.function_name = p.proname
   AND sc.identity_arguments = pg_get_function_identity_arguments(p.oid)
   AND p.proname = 'aplicar_saldo_a_pedido';

COMMIT;
