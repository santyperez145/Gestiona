-- P0.3 — reintegros iniciados por el comercio, con idempotencia de proveedor.
--
-- La tabla `returns` registra el retorno físico del mostrador o de una orden
-- online. `return_requests` registra el RMA. Ninguna de las dos alcanza para
-- saber si MercadoPago recibió la orden de devolver dinero. Esta tabla es el
-- hecho financiero separado: una solicitud de devolución puede tener un único
-- reintegro lógico y ese reintegro conserva la misma clave ante reintentos.

CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  return_request_id    uuid NOT NULL REFERENCES public.return_requests(id) ON DELETE CASCADE,
  ecommerce_order_id   uuid NOT NULL REFERENCES public.ecommerce_orders(id) ON DELETE CASCADE,
  provider             text NOT NULL DEFAULT 'mercadopago',
  provider_payment_id  text NOT NULL,
  amount               numeric(14,2) NOT NULL CHECK (amount > 0),
  currency             text NOT NULL DEFAULT 'ARS',
  client_key           text NOT NULL,
  status               text NOT NULL DEFAULT 'processing'
                         CHECK (status IN ('processing', 'refunded', 'failed')),
  external_refund_id   text,
  attempt_count        integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  failure_reason       text,
  raw                  jsonb,
  requested_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  processed_at         timestamptz,
  last_attempt_at      timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_refunds_provider_check CHECK (provider = 'mercadopago')
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_request_unico
  ON public.payment_refunds(org_id, return_request_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_refunds_client_key_unico
  ON public.payment_refunds(org_id, client_key);
CREATE INDEX IF NOT EXISTS payment_refunds_order_idx
  ON public.payment_refunds(org_id, ecommerce_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_refunds_status_idx
  ON public.payment_refunds(org_id, status, created_at DESC);

COMMENT ON TABLE public.payment_refunds IS
  'Registro idempotente del reintegro a un comprador. El token de MercadoPago '
  'nunca se guarda acá ni se entrega a anon/authenticated.';
COMMENT ON COLUMN public.payment_refunds.client_key IS
  'Clave estable por solicitud de RMA. Se reutiliza en cada retry contra MercadoPago.';
COMMENT ON COLUMN public.payment_refunds.raw IS
  'Respuesta saneada del proveedor: no se guarda el payload completo ni credenciales.';

ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_refunds TO authenticated;

DROP POLICY IF EXISTS payment_refunds_org_select ON public.payment_refunds;
CREATE POLICY payment_refunds_org_select ON public.payment_refunds
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.payment_refunds_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_payment_refunds_updated_at ON public.payment_refunds;
CREATE TRIGGER trg_payment_refunds_updated_at
BEFORE UPDATE ON public.payment_refunds
FOR EACH ROW EXECUTE FUNCTION public.payment_refunds_updated_at();

-- Un reintegro parcial deja la orden en `partial`, que es un estado operativo,
-- no una invitación a volver a crear las ventas. La transición directa a paid
-- se bloquea acá para cubrir tanto RPCs viejos como una edición manual.
CREATE OR REPLACE FUNCTION public.block_partial_order_reapproval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF OLD.payment_status = 'partial' AND NEW.payment_status = 'paid' THEN
    RAISE EXCEPTION 'Una orden con reintegro parcial no puede volver a acreditarse'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_block_partial_order_reapproval ON public.ecommerce_orders;
CREATE TRIGGER trg_block_partial_order_reapproval
BEFORE UPDATE OF payment_status ON public.ecommerce_orders
FOR EACH ROW EXECUTE FUNCTION public.block_partial_order_reapproval();

-- Un reintegro parcial tampoco debe impedir que el comercio reciba físicamente
-- el producto. Se conserva el RPC existente y se amplía sólo su estado
-- permitido; el movimiento sigue pasando exclusivamente por el Kardex.
CREATE OR REPLACE FUNCTION public.return_store_order_item(
  p_order_id uuid,
  p_product_id uuid,
  p_variant_id uuid DEFAULT NULL,
  p_qty int DEFAULT 1,
  p_reason text DEFAULT NULL,
  p_refund_method text DEFAULT 'transferencia',
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_order record;
  v_item jsonb;
  v_comprados int := 0;
  v_devueltos int := 0;
  v_unit numeric := 0;
  v_nombre text;
  v_var_nombre text;
  v_return_id uuid;
BEGIN
  IF COALESCE(p_qty, 0) < 1 THEN
    RAISE EXCEPTION 'La cantidad a devolver tiene que ser al menos 1';
  END IF;
  SELECT o.id, o.org_id, o.items, o.payment_status, o.order_number
    INTO v_order FROM public.ecommerce_orders o WHERE o.id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;
  IF NOT public.has_org_role(v_order.org_id, auth.uid(), ARRAY['owner','admin','manager']) THEN
    RAISE EXCEPTION 'No tenés permiso para registrar devoluciones';
  END IF;
  IF v_order.payment_status NOT IN ('paid', 'partial', 'refunded', 'charged_back') THEN
    RAISE EXCEPTION 'La orden % todavía no tiene un cobro revertible', v_order.order_number;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb)) LOOP
    IF (v_item->>'product_id')::uuid = p_product_id
       AND COALESCE(NULLIF(v_item->>'variant_id','')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
      v_comprados := v_comprados + GREATEST(COALESCE((v_item->>'quantity')::int, 0), 0);
      v_unit := COALESCE((v_item->>'unit_price')::numeric, 0);
      v_nombre := v_item->>'name';
    END IF;
  END LOOP;
  IF v_comprados = 0 THEN RAISE EXCEPTION 'Ese producto no está en la orden %', v_order.order_number; END IF;

  SELECT COALESCE(SUM(r.quantity), 0) INTO v_devueltos
  FROM public.returns r
  WHERE r.ecommerce_order_id = p_order_id AND r.product_id = p_product_id
    AND COALESCE(r.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid);
  IF v_devueltos + p_qty > v_comprados THEN
    RAISE EXCEPTION 'Se compraron % y ya se devolvieron %: no se pueden devolver % más', v_comprados, v_devueltos, p_qty;
  END IF;

  SELECT v.variant_name INTO v_var_nombre FROM public.product_variants v WHERE v.id = p_variant_id;
  INSERT INTO public.returns (
    org_id, user_id, ecommerce_order_id, product_id, variant_id,
    product_name, quantity, amount_ars, reason, refund_method, notes
  ) VALUES (
    v_order.org_id, auth.uid(), p_order_id, p_product_id, p_variant_id,
    COALESCE(v_nombre, 'Producto'), p_qty, round(v_unit * p_qty),
    p_reason, p_refund_method, p_notes
  ) RETURNING id INTO v_return_id;

  PERFORM public.record_stock_movement(
    v_order.org_id, p_product_id, p_variant_id,
    COALESCE(v_nombre, 'Producto'), v_var_nombre,
    'return', p_qty, 'ecommerce_order', p_order_id, NULL, v_unit,
    format('Devolución de la orden %s', v_order.order_number), auth.uid(), NULL
  );
  RETURN jsonb_build_object(
    'ok', true, 'return_id', v_return_id, 'order_number', v_order.order_number,
    'quantity', p_qty, 'amount', round(v_unit * p_qty),
    'restantes', v_comprados - v_devueltos - p_qty
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.return_store_order_item(uuid, uuid, uuid, int, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_store_order_item(uuid, uuid, uuid, int, text, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.pago_reintegro_preparar(
  p_return_request_id uuid,
  p_requested_by      uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
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
  IF v_request.resolution <> 'refund' OR v_request.refund_method <> 'original_payment' THEN
    RAISE EXCEPTION 'La solicitud no está configurada para reintegrar al medio original';
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
$fn$;

REVOKE ALL ON FUNCTION public.pago_reintegro_preparar(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pago_reintegro_preparar(uuid, uuid) TO service_role;

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
         payment_id
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

  v_order_status := CASE
    WHEN v_total_refund >= round(v_order.total, 2) THEN 'refunded'
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

REVOKE ALL ON FUNCTION public.pago_reintegro_resultado(uuid, text, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pago_reintegro_resultado(uuid, text, text, jsonb, text)
  TO service_role;

COMMENT ON FUNCTION public.pago_reintegro_preparar(uuid, uuid) IS
  'Prepara o reanuda el reintegro de un RMA. Valida orden, monto, saldo e idempotencia; sólo service_role.';
COMMENT ON FUNCTION public.pago_reintegro_resultado(uuid, text, text, jsonb, text) IS
  'Asienta la respuesta de MercadoPago, actualiza el RMA y marca la orden partial/refunded sin tocar stock.';

-- Guardas de forma: si el objeto existe con otra forma, fallar ahora es mejor
-- que desplegar una Function que crea un reintegro con datos incompletos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ecommerce_orders'
      AND column_name = 'payment_id'
  ) THEN
    RAISE EXCEPTION 'ecommerce_orders no tiene payment_id; no se puede reintegrar por MercadoPago';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'return_requests'
      AND column_name = 'ecommerce_order_id'
  ) THEN
    RAISE EXCEPTION 'return_requests no tiene ecommerce_order_id; no se puede enlazar el RMA';
  END IF;
  IF has_table_privilege('anon', 'public.payment_refunds', 'SELECT')
     OR has_table_privilege('authenticated', 'public.payment_refunds', 'INSERT')
     OR has_function_privilege('authenticated', 'public.pago_reintegro_preparar(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pago_reintegro_resultado(uuid,text,text,jsonb,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'ACL de payment_refunds o sus funciones quedó demasiado abierta';
  END IF;
END $$;
