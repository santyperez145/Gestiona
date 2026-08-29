-- POS QR con Mercado Pago Orders API.
--
-- Un QR no es un recibo: es una intención de cobro. Esta capa impide que Caja
-- cree la venta, descuente stock o declare un pago antes de que Mercado Pago
-- confirme la order como `processed`.
--
-- Flujo:
--   preparar + reservar → crear order/QR → esperar proveedor → acreditar →
--   crear ticket v3 + cobro conciliable + liberar reserva.
--
-- El navegador sólo prepara como usuario autenticado. Los estados del
-- proveedor y el cierre del ticket son RPC internos para `service_role`.

ALTER TABLE public.payment_connections
  ADD COLUMN IF NOT EXISTS mp_store_id text,
  ADD COLUMN IF NOT EXISTS mp_external_store_id text,
  ADD COLUMN IF NOT EXISTS mp_pos_id text,
  ADD COLUMN IF NOT EXISTS mp_external_pos_id text,
  ADD COLUMN IF NOT EXISTS mp_pos_status text,
  ADD COLUMN IF NOT EXISTS mp_pos_configured_at timestamptz;

COMMENT ON COLUMN public.payment_connections.mp_external_pos_id IS
  'Identificador no secreto de la caja creada en Mercado Pago para Orders API QR.';

CREATE TABLE IF NOT EXISTS public.pos_qr_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  client_key uuid NOT NULL,
  payload_hash text NOT NULL,
  payment_intent_id uuid NOT NULL REFERENCES public.payment_intents(id) ON DELETE RESTRICT,
  payment_attempt_id uuid NOT NULL REFERENCES public.payment_attempts(id) ON DELETE RESTRICT,
  sale_transaction_id uuid REFERENCES public.sale_transactions(id) ON DELETE RESTRICT,
  provider_order_id text,
  provider_payment_id text,
  state text NOT NULL DEFAULT 'preparing' CHECK (state IN (
    'preparing','pending','accredited','finalizing','completed',
    'cancelled','expired','failed','manual_review','refunded'
  )),
  provider_status text,
  provider_status_detail text,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  platform_fee numeric(18,2) NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  currency text NOT NULL DEFAULT 'ARS',
  sales_payload jsonb NOT NULL,
  qr_data text,
  failure_reason text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id, client_key),
  UNIQUE (provider_order_id)
);

CREATE INDEX IF NOT EXISTS pos_qr_sessions_org_created_idx
  ON public.pos_qr_sessions (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pos_qr_sessions_live_idx
  ON public.pos_qr_sessions (state, expires_at)
  WHERE state IN ('preparing','pending','accredited','finalizing');

ALTER TABLE public.pos_qr_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_qr_sessions_org_read ON public.pos_qr_sessions;
CREATE POLICY pos_qr_sessions_org_read ON public.pos_qr_sessions
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

ALTER TABLE public.stock_reservations
  ADD COLUMN IF NOT EXISTS pos_qr_session_id uuid
  REFERENCES public.pos_qr_sessions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS stock_reservations_pos_qr_idx
  ON public.stock_reservations (pos_qr_session_id)
  WHERE pos_qr_session_id IS NOT NULL;

COMMENT ON TABLE public.pos_qr_sessions IS
  'Máquina de estados de un cobro QR de mostrador. No existe ticket hasta proveedor processed.';
COMMENT ON COLUMN public.pos_qr_sessions.sales_payload IS
  'Snapshot server-side de las líneas aceptadas y bloqueadas por el importe del QR.';
COMMENT ON COLUMN public.stock_reservations.pos_qr_session_id IS
  'Reserva temporal de un QR pendiente. Aparta disponible; nunca mueve stock físico.';

CREATE OR REPLACE VIEW public.payment_connection_status AS
SELECT
  c.org_id,
  c.provider,
  c.nickname,
  c.email,
  c.external_id,
  c.live_mode,
  c.connected_at,
  c.last_error,
  (c.access_token IS NOT NULL) AS conectado,
  (c.expires_at IS NULL OR c.expires_at > now()) AS vigente,
  c.expires_at,
  (c.mp_external_pos_id IS NOT NULL AND c.mp_pos_status = 'active') AS qr_pos_ready,
  c.mp_pos_status
FROM public.payment_connections c
WHERE public.is_org_member(c.org_id, auth.uid());

ALTER VIEW public.payment_connection_status SET (security_invoker = false);
GRANT SELECT ON public.payment_connection_status TO authenticated;

-- Respuesta saneada compartida por create/status. El payload canónico sólo se
-- devuelve a la Edge autenticada para construir items del proveedor.
CREATE OR REPLACE FUNCTION public.pos_qr_session_response(p_session_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'session_id', session.id,
    'org_id', session.org_id,
    'state', session.state,
    'amount', session.amount,
    'platform_fee', session.platform_fee,
    'currency', session.currency,
    'expires_at', session.expires_at,
    'provider_order_id', session.provider_order_id,
    'provider_status', session.provider_status,
    'provider_status_detail', session.provider_status_detail,
    'provider_payment_id', session.provider_payment_id,
    'qr_data', session.qr_data,
    'sale_transaction_id', session.sale_transaction_id,
    'failure_reason', session.failure_reason,
    'payment_attempt_id', session.payment_attempt_id,
    'items', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'product_id', line.value->>'product_id',
        'title', line.value->>'product_name',
        'unit_price', line.value->>'unit_price_ars',
        'quantity', line.value->>'quantity'
      )), '[]'::jsonb)
      FROM jsonb_array_elements(session.sales_payload) line(value)
    )
  )
  FROM public.pos_qr_sessions session
  WHERE session.id = p_session_id
    AND (
      public.is_org_member(session.org_id, auth.uid())
      OR auth.role() = 'service_role'
    );
$function$;

REVOKE ALL ON FUNCTION public.pos_qr_session_response(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_qr_session_response(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pos_qr_session_prepare(
  p_org_id uuid,
  p_sales jsonb,
  p_client_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_hash text;
  v_existing public.pos_qr_sessions;
  v_line jsonb;
  v_payload jsonb := '[]'::jsonb;
  v_product public.products%ROWTYPE;
  v_product_id uuid;
  v_variant_id uuid;
  v_location_id uuid;
  v_qty numeric;
  v_requested numeric;
  v_prices jsonb;
  v_authoritative numeric;
  v_locked numeric;
  v_line_id uuid;
  v_customer_id uuid;
  v_coupon_id uuid;
  v_global_discount numeric;
  v_amount numeric := 0;
  v_platform_fee numeric := 0;
  v_check record;
  v_intent public.payment_intents;
  v_attempt public.payment_attempts;
  v_session public.pos_qr_sessions;
BEGIN
  IF v_actor IS NULL
     OR NOT public.is_org_member(p_org_id, v_actor)
     OR NOT public.has_permission(p_org_id, 'sales', 'create') THEN
    RAISE EXCEPTION 'No tenes permiso para crear cobros en esta organizacion'
      USING ERRCODE = '42501';
  END IF;
  IF p_client_key IS NULL THEN
    RAISE EXCEPTION 'El cobro necesita una clave idempotente';
  END IF;
  IF jsonb_typeof(p_sales) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_sales) = 0
     OR jsonb_array_length(p_sales) > 100 THEN
    RAISE EXCEPTION 'El QR necesita entre 1 y 100 renglones';
  END IF;

  v_hash := md5(p_sales::text);
  PERFORM pg_advisory_xact_lock(
    hashtextextended('pos-qr:' || p_org_id::text || ':' || p_client_key::text, 0)
  );

  SELECT * INTO v_existing
  FROM public.pos_qr_sessions session
  WHERE session.org_id = p_org_id AND session.client_key = p_client_key
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'La clave del QR ya fue usada con otro carrito'
        USING ERRCODE = '23505';
    END IF;
    RETURN public.pos_qr_session_response(v_existing.id) || jsonb_build_object('reused', true);
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_sales)
  LOOP
    BEGIN
      v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
      v_variant_id := NULLIF(v_line->>'variant_id', '')::uuid;
      v_location_id := NULLIF(v_line->>'location_id', '')::uuid;
      v_qty := NULLIF(v_line->>'quantity', '')::numeric;
      v_requested := NULLIF(v_line->>'unit_price_ars', '')::numeric;
      v_line_id := COALESCE(NULLIF(v_line->>'id', '')::uuid, gen_random_uuid());
      v_customer_id := NULLIF(v_line->>'customer_id', '')::uuid;
      v_coupon_id := NULLIF(v_line->>'coupon_id', '')::uuid;
      v_global_discount := NULLIF(v_line->>'global_discount_ars', '')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'El carrito contiene ids, cantidades o precios invalidos';
    END;

    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0
       OR v_qty <> trunc(v_qty) OR v_qty > 10000 THEN
      RAISE EXCEPTION 'Cada renglon necesita producto y cantidad entera positiva';
    END IF;

    SELECT * INTO v_product
    FROM public.products product
    WHERE product.id = v_product_id AND product.org_id = p_org_id
    FOR UPDATE;
    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Un producto del carrito no pertenece a la organizacion';
    END IF;
    IF v_variant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.product_variants variant
      WHERE variant.id = v_variant_id
        AND variant.product_id = v_product_id
        AND variant.org_id = p_org_id
    ) THEN
      RAISE EXCEPTION 'Una variante del carrito no pertenece al producto';
    END IF;
    IF v_location_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.locations location
      WHERE location.id = v_location_id AND location.org_id = p_org_id AND location.active
    ) THEN
      RAISE EXCEPTION 'La sucursal del cobro no esta disponible';
    END IF;
    IF v_product.maneja_stock AND public.stock_disponible(
      v_product_id, v_variant_id, v_location_id
    ) < v_qty THEN
      RAISE EXCEPTION 'Sin stock disponible de % para sostener el QR durante 15 minutos',
        v_product.name USING ERRCODE = '22023';
    END IF;

    v_prices := public.precio_pos_autoritativo(
      p_org_id, v_product_id, v_variant_id, v_qty
    );
    v_authoritative := COALESCE((v_prices->>'precio_vigente')::numeric, 0);
    IF v_authoritative <= 0 THEN
      RAISE EXCEPTION 'El producto % no tiene un precio cobrable', v_product.name;
    END IF;

    -- El cliente puede haber aplicado cupón, descuento global/categoría u
    -- override de caja hacia abajo. Nunca puede subir el importe del QR por
    -- encima del precio vigente del servidor.
    v_locked := public.redondear_moneda(
      CASE
        WHEN v_requested IS NOT NULL AND v_requested > 0
          THEN LEAST(v_requested, v_authoritative)
        ELSE v_authoritative
      END,
      'ARS'
    );
    v_amount := v_amount + public.redondear_moneda(v_locked * v_qty, 'ARS');

    v_payload := v_payload || jsonb_build_array(jsonb_build_object(
      'id', v_line_id,
      'org_id', p_org_id,
      'user_id', v_actor,
      'product_id', v_product_id,
      'variant_id', v_variant_id,
      'product_name', left(v_product.name, 500),
      'quantity', v_qty,
      'unit_price_ars', v_locked,
      'total_ars', public.redondear_moneda(v_locked * v_qty, 'ARS'),
      'discount_applied', v_locked + 0.01 < COALESCE((v_prices->>'precio_lista')::numeric, v_locked),
      'customer_id', v_customer_id,
      'customer_name', NULLIF(left(btrim(COALESCE(v_line->>'customer_name', '')), 300), ''),
      'date', now(),
      'paid', true,
      'payment_method', 'qr',
      'split_payments', NULL,
      'global_discount_ars', v_global_discount,
      'coupon_id', v_coupon_id,
      'coupon_code', NULLIF(left(btrim(COALESCE(v_line->>'coupon_code', '')), 80), ''),
      'location_id', v_location_id,
      'seller_name', NULLIF(left(btrim(COALESCE(v_line->>'seller_name', '')), 200), ''),
      'notes', NULLIF(left(btrim(COALESCE(v_line->>'notes', '')), 500), ''),
      'source', 'pos',
      'offline_transaction_id', p_client_key,
      'offline_origin', false
    ));
  END LOOP;

  v_amount := public.redondear_moneda(v_amount, 'ARS');
  IF v_amount <= 0 OR v_amount > 999999999999.99 THEN
    RAISE EXCEPTION 'El total del QR no es valido';
  END IF;

  -- Dos renglones del mismo producto no pueden validar por separado contra el
  -- mismo disponible. Se vuelve a comprobar agrupado mientras los productos
  -- siguen bloqueados, antes de reservar o ensayar el ticket.
  FOR v_check IN
    SELECT
      (line.value->>'product_id')::uuid AS product_id,
      NULLIF(line.value->>'variant_id', '')::uuid AS variant_id,
      NULLIF(line.value->>'location_id', '')::uuid AS location_id,
      sum((line.value->>'quantity')::numeric) AS quantity
    FROM jsonb_array_elements(v_payload) line(value)
    GROUP BY 1, 2, 3
  LOOP
    IF (SELECT product.maneja_stock FROM public.products product WHERE product.id = v_check.product_id)
       AND public.stock_disponible(
         v_check.product_id, v_check.variant_id, v_check.location_id
       ) < v_check.quantity THEN
      RAISE EXCEPTION 'El carrito supera el stock disponible al agrupar sus renglones'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_platform_fee := public.redondear_moneda(
    COALESCE(public.platform_commission_amount(p_org_id, v_amount, 'pos'), 0),
    'ARS'
  );
  IF v_platform_fee < 0 OR v_platform_fee >= v_amount THEN
    RAISE EXCEPTION 'La comision de plataforma no deja un total cobrable';
  END IF;

  -- Ejecuta todo el contrato comercial dentro de una subtransacción que se
  -- revierte a propósito. Así valida plan, cupón, tenant, líneas y autoridad
  -- sin dejar ticket, Kardex, deuda, outbox ni cobro de prueba.
  BEGIN
    PERFORM public.create_sales_transaction_v3(p_org_id, v_payload, 'pos');
    RAISE EXCEPTION '__POS_QR_VALIDATED__';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> '__POS_QR_VALIDATED__' THEN RAISE; END IF;
  END;

  -- Al acreditarse se respeta esta cotización aceptada aunque el cupón venza
  -- durante los 15 minutos. La preparación de arriba ya lo validó; esto no
  -- habilita al navegador a saltearlo porque el payload queda privado.
  SELECT COALESCE(jsonb_agg(line.value || jsonb_build_object('offline_origin', true)), '[]'::jsonb)
  INTO v_payload
  FROM jsonb_array_elements(v_payload) line(value);

  INSERT INTO public.payment_intents (
    org_id, order_id, monto, moneda, metodo, cuotas, estado, expira_at
  ) VALUES (
    p_org_id, NULL, v_amount, 'ARS', 'qr', 1, 'pendiente', now() + interval '15 minutes'
  ) RETURNING * INTO v_intent;

  INSERT INTO public.payment_attempts (
    intent_id, org_id, provider, nro, estado, client_key
  ) VALUES (
    v_intent.id, p_org_id, 'mercadopago', 1, 'iniciado', p_client_key::text
  ) RETURNING * INTO v_attempt;

  INSERT INTO public.pos_qr_sessions (
    org_id, created_by, client_key, payload_hash,
    payment_intent_id, payment_attempt_id, amount, platform_fee,
    sales_payload, expires_at
  ) VALUES (
    p_org_id, v_actor, p_client_key, v_hash,
    v_intent.id, v_attempt.id, v_amount, v_platform_fee,
    v_payload, now() + interval '15 minutes'
  ) RETURNING * INTO v_session;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_payload)
  LOOP
    SELECT * INTO v_product FROM public.products
    WHERE id = (v_line->>'product_id')::uuid AND org_id = p_org_id;
    IF v_product.maneja_stock THEN
      INSERT INTO public.stock_reservations (
        org_id, product_id, variant_id, location_id, customer_name,
        quantity, status, expires_at, notes, created_by, pos_qr_session_id
      ) VALUES (
        p_org_id,
        (v_line->>'product_id')::uuid,
        NULLIF(v_line->>'variant_id', '')::uuid,
        NULLIF(v_line->>'location_id', '')::uuid,
        NULLIF(v_line->>'customer_name', ''),
        (v_line->>'quantity')::integer,
        'active', v_session.expires_at,
        'Cobro QR Mercado Pago pendiente', v_actor, v_session.id
      );
    END IF;
  END LOOP;

  PERFORM public.emitir_evento(
    p_org_id, 'pago', v_intent.id, 'pago.qr_preparado',
    jsonb_build_object(
      'session_id', v_session.id,
      'attempt_id', v_attempt.id,
      'monto', v_amount,
      'provider', 'mercadopago'
    )
  );

  RETURN public.pos_qr_session_response(v_session.id) || jsonb_build_object('reused', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.pos_qr_session_prepare(uuid, jsonb, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_qr_session_prepare(uuid, jsonb, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_qr_provider_created(
  p_session_id uuid,
  p_provider_order_id text,
  p_qr_data text,
  p_provider_status text,
  p_raw jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_session public.pos_qr_sessions;
BEGIN
  SELECT * INTO v_session FROM public.pos_qr_sessions
  WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'Sesion QR inexistente'; END IF;
  IF NULLIF(btrim(COALESCE(p_provider_order_id, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_qr_data, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Mercado Pago no devolvio order y trama QR';
  END IF;
  IF v_session.provider_order_id IS NOT NULL
     AND v_session.provider_order_id <> p_provider_order_id THEN
    RAISE EXCEPTION 'La sesion QR ya pertenece a otra order';
  END IF;

  UPDATE public.pos_qr_sessions
  SET provider_order_id = left(p_provider_order_id, 180),
      qr_data = left(p_qr_data, 4000),
      provider_status = left(COALESCE(p_provider_status, 'created'), 80),
      state = 'pending', updated_at = now()
  WHERE id = p_session_id;

  UPDATE public.payment_attempts
  SET external_id = left(p_provider_order_id, 250), estado = 'pendiente',
      raw = COALESCE(p_raw, '{}'::jsonb)
  WHERE id = v_session.payment_attempt_id;
  UPDATE public.payment_intents
  SET estado = 'procesando', updated_at = now()
  WHERE id = v_session.payment_intent_id;

  RETURN public.pos_qr_session_response(p_session_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.pos_qr_provider_failed(
  p_session_id uuid,
  p_reason text,
  p_raw jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_session public.pos_qr_sessions;
BEGIN
  SELECT * INTO v_session FROM public.pos_qr_sessions
  WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'Sesion QR inexistente'; END IF;
  IF v_session.state IN ('completed','refunded') THEN
    RETURN public.pos_qr_session_response(p_session_id);
  END IF;

  UPDATE public.pos_qr_sessions
  SET state = 'failed', failure_reason = left(COALESCE(p_reason, 'provider_error'), 500),
      updated_at = now()
  WHERE id = p_session_id;
  UPDATE public.payment_attempts
  SET estado = 'error', motivo = left(COALESCE(p_reason, 'provider_error'), 500),
      raw = COALESCE(p_raw, '{}'::jsonb), resuelto_at = now()
  WHERE id = v_session.payment_attempt_id;
  UPDATE public.payment_intents SET estado = 'rechazado', updated_at = now()
  WHERE id = v_session.payment_intent_id;
  UPDATE public.stock_reservations
  SET status = 'cancelled', resolved_at = now()
  WHERE pos_qr_session_id = p_session_id AND status = 'active';
  RETURN public.pos_qr_session_response(p_session_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.pos_qr_apply_provider(
  p_session_id uuid,
  p_provider_order_id text,
  p_status text,
  p_status_detail text DEFAULT NULL,
  p_payment_id text DEFAULT NULL,
  p_gross numeric DEFAULT NULL,
  p_net numeric DEFAULT NULL,
  p_fee numeric DEFAULT NULL,
  p_raw jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_session public.pos_qr_sessions;
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_result jsonb;
  v_transaction_id uuid;
  v_payment public.payment_transactions;
  v_net numeric;
  v_fee numeric;
  v_has_fee_evidence boolean := p_net IS NOT NULL OR p_fee IS NOT NULL;
BEGIN
  SELECT * INTO v_session FROM public.pos_qr_sessions
  WHERE id = p_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'Sesion QR inexistente'; END IF;
  IF v_session.provider_order_id IS NULL
     OR v_session.provider_order_id <> p_provider_order_id THEN
    RAISE EXCEPTION 'La order no corresponde a la sesion QR';
  END IF;

  IF v_session.state = 'completed' AND v_status = 'processed' THEN
    SELECT * INTO v_payment
    FROM public.payment_transactions payment
    WHERE payment.org_id = v_session.org_id
      AND payment.source = 'pos'
      AND payment.source_id = v_session.sale_transaction_id
      AND payment.method = 'wallet'
    FOR UPDATE;

    -- Orders confirma el pago antes de que todos los contratos devuelvan el
    -- arancel. Un webhook/poll posterior puede enriquecerlo sin recrear venta
    -- ni stock; mientras falta, el margen queda settlement_pending.
    IF v_payment.id IS NOT NULL
       AND v_payment.status = 'pending'
       AND v_has_fee_evidence THEN
      v_net := round(COALESCE(
        p_net,
        v_session.amount - COALESCE(p_fee, 0) - v_session.platform_fee
      ), 2);
      v_fee := round(COALESCE(
        p_fee,
        v_session.amount - v_net - v_session.platform_fee
      ), 2);
      IF v_net < 0 OR v_net > v_session.amount
         OR v_fee < 0
         OR abs(v_session.amount - v_session.platform_fee - v_fee - v_net) > 0.02 THEN
        RAISE EXCEPTION 'La liquidacion posterior de Mercado Pago no cierra';
      END IF;

      UPDATE public.payment_transactions
      SET provider_fee = v_fee, net_amount = v_net, status = 'approved',
          released_at = now(),
          raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object(
            'fee_evidence', 'mercadopago_payment_api',
            'provider_status_detail', p_status_detail
          ) || COALESCE(p_raw, '{}'::jsonb),
          updated_at = now()
      WHERE id = v_payment.id;
      UPDATE public.payment_attempts
      SET neto = v_net, comision = v_fee,
          raw = COALESCE(raw, '{}'::jsonb) || COALESCE(p_raw, '{}'::jsonb)
      WHERE id = v_session.payment_attempt_id;
      PERFORM public.ledger_asentar_liquidacion_pos(v_payment.id);

      RETURN public.pos_qr_session_response(p_session_id)
        || jsonb_build_object('reused', true, 'settlement_enriched', true);
    END IF;

    RETURN public.pos_qr_session_response(p_session_id)
      || jsonb_build_object('reused', true, 'settlement_enriched', false);
  END IF;

  IF v_status = 'refunded' THEN
    UPDATE public.pos_qr_sessions
    SET state = 'refunded', provider_status = v_status,
        provider_status_detail = left(COALESCE(p_status_detail, ''), 120), updated_at = now()
    WHERE id = p_session_id;
    UPDATE public.payment_transactions
    SET status = 'refunded', updated_at = now(),
        raw = COALESCE(raw, '{}'::jsonb) || COALESCE(p_raw, '{}'::jsonb)
    WHERE source = 'pos' AND source_id = v_session.sale_transaction_id;
    RETURN public.pos_qr_session_response(p_session_id);
  END IF;

  IF v_status IN ('cancelled','canceled','expired') THEN
    UPDATE public.pos_qr_sessions
    SET state = CASE WHEN v_status = 'expired' THEN 'expired' ELSE 'cancelled' END,
        provider_status = v_status,
        provider_status_detail = left(COALESCE(p_status_detail, ''), 120), updated_at = now()
    WHERE id = p_session_id AND state <> 'completed';
    UPDATE public.payment_attempts
    SET estado = CASE WHEN v_status = 'expired' THEN 'expirado' ELSE 'rechazado' END,
        motivo = left(COALESCE(p_status_detail, v_status), 500),
        raw = COALESCE(p_raw, '{}'::jsonb), resuelto_at = now()
    WHERE id = v_session.payment_attempt_id AND estado <> 'aprobado';
    UPDATE public.payment_intents
    SET estado = CASE WHEN v_status = 'expired' THEN 'expirado' ELSE 'cancelado' END,
        updated_at = now()
    WHERE id = v_session.payment_intent_id AND estado <> 'acreditado';
    UPDATE public.stock_reservations
    SET status = CASE WHEN v_status = 'expired' THEN 'expired' ELSE 'cancelled' END,
        resolved_at = now()
    WHERE pos_qr_session_id = p_session_id AND status = 'active';
    RETURN public.pos_qr_session_response(p_session_id);
  END IF;

  UPDATE public.pos_qr_sessions
  SET provider_status = left(COALESCE(v_status, 'created'), 80),
      provider_status_detail = left(COALESCE(p_status_detail, ''), 120),
      updated_at = now()
  WHERE id = p_session_id;

  IF v_status <> 'processed' THEN
    RETURN public.pos_qr_session_response(p_session_id);
  END IF;

  IF p_gross IS NULL OR abs(round(p_gross, 2) - v_session.amount) > 0.01 THEN
    UPDATE public.pos_qr_sessions
    SET state = 'manual_review',
        failure_reason = format(
          'Mercado Pago informo %s y el QR esperaba %s',
          COALESCE(p_gross::text, 'sin monto'), v_session.amount
        ), updated_at = now()
    WHERE id = p_session_id;
    RETURN public.pos_qr_session_response(p_session_id);
  END IF;
  IF COALESCE(p_fee, 0) < 0 OR COALESCE(p_net, v_session.amount) < 0 THEN
    RAISE EXCEPTION 'Mercado Pago devolvio importes de liquidacion invalidos';
  END IF;

  UPDATE public.pos_qr_sessions SET state = 'finalizing', updated_at = now()
  WHERE id = p_session_id;

  -- El actor original, no service_role, queda como creador del ticket y es el
  -- que se evalúa contra membresía/permisos dentro de v3.
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_session.created_by, 'role', 'authenticated')::text,
    true
  );
  v_result := public.create_sales_transaction_v3(
    v_session.org_id, v_session.sales_payload, 'pos'
  );
  v_transaction_id := (v_result->>'transaction_id')::uuid;

  SELECT * INTO v_payment
  FROM public.payment_transactions payment
  WHERE payment.org_id = v_session.org_id
    AND payment.source = 'pos'
    AND payment.source_id = v_transaction_id
    AND payment.method = 'wallet'
  FOR UPDATE;
  IF v_payment.id IS NULL THEN
    RAISE EXCEPTION 'El ticket no genero evidencia de cobro QR';
  END IF;

  v_net := round(COALESCE(
    p_net,
    v_session.amount - COALESCE(p_fee, 0) - v_session.platform_fee
  ), 2);
  v_fee := round(COALESCE(
    p_fee,
    CASE WHEN p_net IS NULL THEN 0
      ELSE v_session.amount - v_net - v_session.platform_fee END
  ), 2);
  IF v_net < 0 OR v_net > v_session.amount OR v_fee < 0
     OR (
       v_has_fee_evidence
       AND abs(v_session.amount - v_session.platform_fee - v_fee - v_net) > 0.02
     ) THEN
    RAISE EXCEPTION 'El neto de Mercado Pago no coincide con el importe cobrado';
  END IF;

  UPDATE public.payment_transactions
  SET provider = 'mercadopago', method = 'wallet',
      gross_amount = v_session.amount,
      provider_fee = v_fee,
      provider_fee_iva = 0,
      platform_fee = v_session.platform_fee,
      net_amount = v_net,
      status = CASE WHEN v_has_fee_evidence THEN 'approved' ELSE 'pending' END,
      external_id = left(COALESCE(NULLIF(p_payment_id, ''), p_provider_order_id), 250),
      correlation_id = (
        SELECT intent.correlation_id FROM public.payment_intents intent
        WHERE intent.id = v_session.payment_intent_id
      ),
      raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object(
        'fee_evidence', CASE WHEN v_has_fee_evidence
          THEN 'mercadopago_payment_api'
          ELSE 'awaiting_actual_settlement' END,
        'provider_order_id', p_provider_order_id,
        'provider_payment_id', p_payment_id,
        'provider_status_detail', p_status_detail
      ) || COALESCE(p_raw, '{}'::jsonb),
      updated_at = now()
  WHERE id = v_payment.id;

  UPDATE public.payment_attempts
  SET estado = 'aprobado',
      neto = CASE WHEN v_has_fee_evidence THEN v_net ELSE NULL END,
      comision = CASE WHEN v_has_fee_evidence THEN v_fee ELSE NULL END,
      motivo = left(COALESCE(p_status_detail, 'accredited'), 500),
      raw = COALESCE(p_raw, '{}'::jsonb), resuelto_at = now()
  WHERE id = v_session.payment_attempt_id;
  UPDATE public.payment_intents
  SET estado = 'acreditado', attempt_ok = v_session.payment_attempt_id, updated_at = now()
  WHERE id = v_session.payment_intent_id;
  UPDATE public.stock_reservations
  SET status = 'fulfilled', resolved_at = now()
  WHERE pos_qr_session_id = p_session_id AND status = 'active';
  UPDATE public.pos_qr_sessions
  SET state = 'completed', provider_status = 'processed',
      provider_status_detail = left(COALESCE(p_status_detail, 'accredited'), 120),
      provider_payment_id = left(NULLIF(p_payment_id, ''), 250),
      sale_transaction_id = v_transaction_id,
      completed_at = now(), updated_at = now()
  WHERE id = p_session_id;

  IF v_has_fee_evidence THEN
    PERFORM public.ledger_asentar_liquidacion_pos(v_payment.id);
  END IF;

  PERFORM public.emitir_evento(
    v_session.org_id, 'pago', v_session.payment_intent_id, 'pago.qr_acreditado',
    jsonb_build_object(
      'session_id', p_session_id,
      'transaction_id', v_transaction_id,
      'provider_order_id', p_provider_order_id,
      'monto', v_session.amount
    )
  );

  RETURN public.pos_qr_session_response(p_session_id)
    || jsonb_build_object('reused', COALESCE((v_result->>'reused')::boolean, false));
END;
$function$;

REVOKE ALL ON FUNCTION public.pos_qr_provider_created(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_qr_provider_failed(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pos_qr_apply_provider(uuid, text, text, text, text, numeric, numeric, numeric, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_qr_provider_created(uuid, text, text, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_qr_provider_failed(uuid, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_qr_apply_provider(uuid, text, text, text, text, numeric, numeric, numeric, jsonb)
  TO service_role;

-- Sólo la Edge autenticada configura la sucursal/caja después de hablar con
-- Mercado Pago. Los ids no son secretos, pero la tabla que contiene el token
-- sigue sin policies y jamás llega al navegador.
CREATE OR REPLACE FUNCTION public.pos_qr_save_provider_pos(
  p_org_id uuid,
  p_store_id text,
  p_external_store_id text,
  p_pos_id text,
  p_external_pos_id text,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE public.payment_connections
  SET mp_store_id = left(p_store_id, 180),
      mp_external_store_id = left(p_external_store_id, 60),
      mp_pos_id = left(p_pos_id, 180),
      mp_external_pos_id = left(p_external_pos_id, 40),
      mp_pos_status = left(COALESCE(p_status, 'active'), 40),
      mp_pos_configured_at = now(), last_error = NULL, updated_at = now()
  WHERE org_id = p_org_id AND provider = 'mercadopago';
  IF NOT FOUND THEN RAISE EXCEPTION 'Mercado Pago no esta conectado'; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.pos_qr_save_provider_pos(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pos_qr_save_provider_pos(uuid, text, text, text, text, text)
  TO service_role;

DO $guard$
BEGIN
  ASSERT NOT has_function_privilege(
    'authenticated', 'public.pos_qr_apply_provider(uuid,text,text,text,text,numeric,numeric,numeric,jsonb)', 'EXECUTE'
  ), 'el navegador puede fabricar una acreditacion QR';
  ASSERT NOT has_function_privilege(
    'authenticated', 'public.pos_qr_provider_created(uuid,text,text,text,jsonb)', 'EXECUTE'
  ), 'el navegador puede fabricar una order QR';
  ASSERT has_function_privilege(
    'authenticated', 'public.pos_qr_session_prepare(uuid,jsonb,uuid)', 'EXECUTE'
  ), 'Caja no puede preparar el QR';
END;
$guard$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829000041', 'pos_qr_mercadopago_orders')
ON CONFLICT DO NOTHING;
