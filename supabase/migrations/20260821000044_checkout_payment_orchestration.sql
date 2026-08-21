-- ═══════════════════════════════════════════════════════════════════════════
-- P0.3 — el checkout usa el orquestador de pagos
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `payment_intents` y `payment_attempts` ya existían, pero `store-pay` todavía
-- hablaba directo con MercadoPago. Esta migración agrega la primitiva que el
-- checkout público necesita: serializa una orden, reutiliza un intento vivo y
-- permite que un reintento explícito cree una nueva intención sólo cuando el
-- intento anterior terminó sin cobro acreditado.

ALTER TABLE public.payment_attempts
  ADD COLUMN IF NOT EXISTS client_key text;

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_client_key_unico
  ON public.payment_attempts (org_id, client_key)
  WHERE client_key IS NOT NULL;

COMMENT ON COLUMN public.payment_attempts.client_key IS
  'Clave de idempotencia del intento que llega del checkout. Nunca es una credencial.';

CREATE OR REPLACE FUNCTION public.pago_intento_preparar(
  p_order_id    uuid,
  p_metodo      text DEFAULT NULL,
  p_cuotas      int DEFAULT 1,
  p_client_key  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_order       public.ecommerce_orders;
  v_intent      public.payment_intents;
  v_attempt     public.payment_attempts;
  v_provider    text;
  v_method      text;
  v_key         text;
BEGIN
  SELECT * INTO v_order
    FROM public.ecommerce_orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'La orden no existe';
  END IF;

  IF v_order.payment_status IN ('paid', 'refunded', 'charged_back') THEN
    RAISE EXCEPTION 'La orden no admite otro pago';
  END IF;

  v_key := NULLIF(btrim(p_client_key), '');
  IF v_key IS NOT NULL AND length(v_key) > 120 THEN
    RAISE EXCEPTION 'La clave del intento es demasiado larga';
  END IF;

  -- La misma clave nunca puede apuntar a dos órdenes de una organización.
  -- Es un error de cliente, no una razón para devolver el resultado de otra
  -- compra.
  IF v_key IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.payment_attempts a
      JOIN public.payment_intents i ON i.id = a.intent_id
     WHERE a.org_id = v_order.org_id
       AND a.client_key = v_key
       AND i.order_id <> p_order_id
  ) THEN
    RAISE EXCEPTION 'La clave del intento ya pertenece a otra orden';
  END IF;

  -- Una repetición del mismo submit obtiene exactamente el mismo intento y la
  -- misma clave que se usó contra el proveedor. Así un timeout del navegador
  -- no produce un segundo X-Idempotency-Key en MercadoPago.
  IF v_key IS NOT NULL THEN
    SELECT a.* INTO v_attempt
      FROM public.payment_attempts a
      JOIN public.payment_intents i ON i.id = a.intent_id
     WHERE a.org_id = v_order.org_id
       AND a.client_key = v_key
       AND i.order_id = p_order_id
     ORDER BY a.created_at DESC
     LIMIT 1
     FOR UPDATE;

    IF v_attempt.id IS NOT NULL THEN
      SELECT * INTO v_intent FROM public.payment_intents WHERE id = v_attempt.intent_id;
      RETURN jsonb_build_object(
        'intent_id', v_intent.id,
        'attempt_id', v_attempt.id,
        'provider', v_attempt.provider,
        'monto', v_intent.monto,
        'metodo', v_intent.metodo,
        'estado', v_intent.estado,
        'attempt_estado', v_attempt.estado,
        'client_key', v_attempt.client_key,
        'reusado', true,
        'ya_acreditado', v_intent.estado = 'acreditado');
    END IF;
  END IF;

  -- El índice único por orden y el lock de arriba hacen que dos pestañas no
  -- puedan abrir dos intenciones vivas para la misma compra.
  SELECT * INTO v_intent
    FROM public.payment_intents
   WHERE order_id = p_order_id
     AND estado IN ('pendiente', 'procesando', 'acreditado')
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_intent.id IS NOT NULL THEN
    SELECT * INTO v_attempt
      FROM public.payment_attempts
     WHERE intent_id = v_intent.id
     ORDER BY nro DESC
     LIMIT 1
     FOR UPDATE;

    IF v_intent.estado = 'acreditado' OR v_attempt.estado = 'aprobado' THEN
      RETURN jsonb_build_object(
        'intent_id', v_intent.id,
        'attempt_id', v_attempt.id,
        'provider', v_attempt.provider,
        'monto', v_intent.monto,
        'metodo', v_intent.metodo,
        'estado', 'acreditado',
        'attempt_estado', v_attempt.estado,
        'client_key', v_attempt.client_key,
        'reusado', true,
        'ya_acreditado', true);
    END IF;

    IF v_attempt.estado IN ('iniciado', 'pendiente') THEN
      -- Un intento pendiente es deliberadamente exclusivo. El checkout usa la
      -- clave canónica persistida, aunque la pestaña actual haya generado otra.
      IF v_attempt.client_key IS NULL AND v_key IS NOT NULL AND v_attempt.external_id IS NULL THEN
        UPDATE public.payment_attempts
           SET client_key = v_key
         WHERE id = v_attempt.id;
        v_attempt.client_key := v_key;
      END IF;

      RETURN jsonb_build_object(
        'intent_id', v_intent.id,
        'attempt_id', v_attempt.id,
        'provider', v_attempt.provider,
        'monto', v_intent.monto,
        'metodo', v_intent.metodo,
        'estado', v_intent.estado,
        'attempt_estado', v_attempt.estado,
        'client_key', v_attempt.client_key,
        'reusado', true,
        'ya_acreditado', false);
    END IF;

    -- Rechazado, error o expirado: la nueva acción explícita puede abrir otra
    -- intención. Nunca se reusa una fila terminal como si siguiera viva.
    UPDATE public.payment_intents
       SET estado = 'rechazado', updated_at = now()
     WHERE id = v_intent.id
       AND estado <> 'acreditado';
  END IF;

  v_method := COALESCE(NULLIF(btrim(p_metodo), ''), v_order.payment_method, 'mercadopago');

  SELECT p.provider INTO v_provider
    FROM public.pago_proveedores_para(
      v_order.org_id, v_method, v_order.total, GREATEST(COALESCE(p_cuotas, 1), 1)
    ) p
   LIMIT 1;

  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'No hay ningún proveedor activo que pueda cobrar "%" en esta tienda', v_method;
  END IF;

  INSERT INTO public.payment_intents (org_id, order_id, monto, moneda, metodo, cuotas)
  VALUES (
    v_order.org_id,
    p_order_id,
    v_order.total,
    'ARS',
    v_method,
    GREATEST(COALESCE(p_cuotas, 1), 1)
  )
  RETURNING * INTO v_intent;

  INSERT INTO public.payment_attempts (intent_id, org_id, provider, nro, client_key)
  VALUES (v_intent.id, v_order.org_id, v_provider, 1, v_key)
  RETURNING * INTO v_attempt;

  PERFORM public.emitir_evento(
    v_order.org_id,
    'pago',
    v_intent.id,
    'pago.iniciado',
    jsonb_build_object(
      'intent_id', v_intent.id,
      'attempt_id', v_attempt.id,
      'order_id', p_order_id,
      'monto', v_order.total,
      'metodo', v_method,
      'provider', v_provider
    )
  );

  RETURN jsonb_build_object(
    'intent_id', v_intent.id,
    'attempt_id', v_attempt.id,
    'provider', v_provider,
    'monto', v_order.total,
    'metodo', v_method,
    'estado', 'pendiente',
    'attempt_estado', 'iniciado',
    'client_key', v_attempt.client_key,
    'reusado', false,
    'ya_acreditado', false);
END;
$fn$;

REVOKE ALL ON FUNCTION public.pago_intento_preparar(uuid, text, int, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pago_intento_preparar(uuid, text, int, text)
  TO service_role;

COMMENT ON FUNCTION public.pago_intento_preparar IS
  'Prepara un intento de checkout de forma serializada e idempotente; sólo service_role.';
