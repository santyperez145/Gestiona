-- P0.3.3 — operaciones completas del RMA: reconciliar dinero y recibir
-- físicamente la mercadería sin duplicar stock.

ALTER TABLE public.returns
  ADD COLUMN IF NOT EXISTS return_request_id uuid
    REFERENCES public.return_requests(id) ON DELETE SET NULL;

-- La tabla remota nació de dos migraciones históricas que se encontraron con
-- el mismo nombre. Estos campos existían en el contrato de la UI, pero no en
-- la tabla efectiva: sin ellos aprobar, rechazar o recibir un RMA fallaba en
-- producción. Se agregan acá antes de usar el flujo nuevo.
ALTER TABLE public.return_requests
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_reason text,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.return_requests
  DROP CONSTRAINT IF EXISTS return_requests_status_check;
ALTER TABLE public.return_requests
  ADD CONSTRAINT return_requests_status_check
  CHECK (status IN (
    'pending', 'approved', 'rejected', 'processing', 'resolved', 'closed',
    'received', 'refunded', 'cancelled'
  ));

CREATE OR REPLACE FUNCTION public.touch_return_request_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_return_request_updated_at ON public.return_requests;
CREATE TRIGGER trg_return_request_updated_at
BEFORE UPDATE ON public.return_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_return_request_updated_at();

CREATE INDEX IF NOT EXISTS returns_return_request_idx
  ON public.returns(return_request_id)
  WHERE return_request_id IS NOT NULL;

COMMENT ON COLUMN public.returns.return_request_id IS
  'RMA que originó la recepción física. Permite auditar dinero y mercadería por separado.';

-- Lectura server-side sin crear otro intento. Se usa para consultar una
-- operación que quedó processing después de un timeout.
CREATE OR REPLACE FUNCTION public.pago_reintegro_estado(
  p_org_id            uuid,
  p_return_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_request record;
  v_refund  record;
BEGIN
  SELECT id, org_id, ecommerce_order_id, status, refund_amount, refund_method,
         resolution, received_at
    INTO v_request
  FROM public.return_requests
  WHERE id = p_return_request_id;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud de devolución no encontrada';
  END IF;
  IF v_request.org_id <> p_org_id THEN
    RAISE EXCEPTION 'La solicitud de devolución no pertenece a la organización indicada'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id, org_id, ecommerce_order_id, return_request_id, provider_payment_id,
         amount, currency, client_key, status, external_refund_id,
         attempt_count, failure_reason, raw, last_attempt_at, processed_at
    INTO v_refund
  FROM public.payment_refunds
  WHERE org_id = p_org_id AND return_request_id = p_return_request_id;

  IF v_refund.id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'not_started',
      'org_id', p_org_id,
      'return_request_id', p_return_request_id,
      'ecommerce_order_id', v_request.ecommerce_order_id,
      'return_request_status', v_request.status,
      'received_at', v_request.received_at
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_refund.status,
    'refund_id', v_refund.id,
    'org_id', v_refund.org_id,
    'return_request_id', v_refund.return_request_id,
    'ecommerce_order_id', v_refund.ecommerce_order_id,
    'payment_id', v_refund.provider_payment_id,
    'amount', v_refund.amount,
    'currency', v_refund.currency,
    'client_key', v_refund.client_key,
    'external_refund_id', v_refund.external_refund_id,
    'attempt_count', v_refund.attempt_count,
    'failure_reason', v_refund.failure_reason,
    'raw', v_refund.raw,
    'last_attempt_at', v_refund.last_attempt_at,
    'processed_at', v_refund.processed_at,
    'return_request_status', v_request.status,
    'received_at', v_request.received_at
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.pago_reintegro_estado(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pago_reintegro_estado(uuid, uuid)
  TO service_role;

-- Guarda una respuesta saneada del proveedor sin cambiar processing. Es
-- importante cuando la API devuelve un estado que todavía no permite cerrar
-- la operación o cuando la consulta de estado no encuentra una coincidencia
-- inequívoca.
CREATE OR REPLACE FUNCTION public.pago_reintegro_observar(
  p_refund_id uuid,
  p_raw       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_refund record;
BEGIN
  UPDATE public.payment_refunds
     SET raw = p_raw,
         last_attempt_at = now(),
         updated_at = now()
   WHERE id = p_refund_id
  RETURNING id, status, external_refund_id INTO v_refund;

  IF v_refund.id IS NULL THEN
    RAISE EXCEPTION 'Reintegro no encontrado';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'refund_id', v_refund.id,
    'status', v_refund.status,
    'external_refund_id', v_refund.external_refund_id
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.pago_reintegro_observar(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pago_reintegro_observar(uuid, jsonb)
  TO service_role;

-- Recibe la mercadería de un RMA y mueve el stock por el único camino válido.
-- Si el RMA no identifica un producto, procesa todas las líneas congeladas de
-- la orden. `received_at` y `return_request_id` hacen la operación idempotente.
CREATE OR REPLACE FUNCTION public.receive_store_return_request(
  p_return_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_request       record;
  v_order         record;
  v_item          jsonb;
  v_product_id    uuid;
  v_variant_id    uuid;
  v_zero_variant  uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_purchased     int;
  v_returned      int;
  v_available     int;
  v_qty           int;
  v_unit           numeric;
  v_name           text;
  v_variant_name   text;
  v_return_id      uuid;
  v_return_ids     jsonb := '[]'::jsonb;
  v_received_qty   int := 0;
  v_received_amount numeric := 0;
  v_found          boolean := false;
BEGIN
  SELECT r.* INTO v_request
  FROM public.return_requests r
  WHERE r.id = p_return_request_id
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud de devolución no encontrada';
  END IF;
  IF NOT public.has_org_role(v_request.org_id, auth.uid(), ARRAY['owner','admin','manager']) THEN
    RAISE EXCEPTION 'No tenés permiso para recibir devoluciones';
  END IF;

  IF v_request.received_at IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(r.id ORDER BY r.created_at), '[]'::jsonb)
      INTO v_return_ids
    FROM public.returns r
    WHERE r.return_request_id = v_request.id;
    RETURN jsonb_build_object(
      'ok', true, 'idempotent', true, 'received_at', v_request.received_at,
      'return_ids', v_return_ids
    );
  END IF;

  IF v_request.ecommerce_order_id IS NULL THEN
    RAISE EXCEPTION 'La solicitud no está vinculada a una orden online';
  END IF;

  SELECT o.* INTO v_order
  FROM public.ecommerce_orders o
  WHERE o.id = v_request.ecommerce_order_id
  FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'La orden online no existe';
  END IF;
  IF v_order.payment_status NOT IN ('paid', 'partial', 'refunded', 'charged_back') THEN
    RAISE EXCEPTION 'La orden % todavía no tiene una devolución física registrable', v_order.order_number;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_order.items, '[]'::jsonb)) LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_variant_id := NULLIF(v_item->>'variant_id', '')::uuid;
    IF v_product_id IS NULL THEN
      CONTINUE;
    END IF;
    IF v_request.product_id IS NOT NULL AND v_product_id <> v_request.product_id THEN
      CONTINUE;
    END IF;
    IF v_request.product_id IS NOT NULL
       AND COALESCE(v_variant_id, v_zero_variant) <> COALESCE(v_request.variant_id, v_zero_variant) THEN
      CONTINUE;
    END IF;

    v_purchased := GREATEST(COALESCE((v_item->>'quantity')::int, 0), 0);
    v_qty := CASE WHEN v_request.product_id IS NULL THEN v_purchased ELSE v_request.quantity END;
    IF v_qty < 1 OR v_purchased < 1 THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(r.quantity), 0) INTO v_returned
    FROM public.returns r
    WHERE r.ecommerce_order_id = v_order.id
      AND r.product_id = v_product_id
      AND COALESCE(r.variant_id, v_zero_variant) = COALESCE(v_variant_id, v_zero_variant);
    v_available := v_purchased - v_returned;
    IF v_available < v_qty THEN
      RAISE EXCEPTION 'El producto % ya tiene % unidades devueltas y sólo quedan % para recibir',
        COALESCE(v_item->>'name', 'sin nombre'), v_returned, GREATEST(v_available, 0);
    END IF;

    v_name := COALESCE(v_item->>'name', 'Producto');
    v_unit := COALESCE((v_item->>'unit_price')::numeric, 0);
    SELECT pv.variant_name INTO v_variant_name
    FROM public.product_variants pv
    WHERE pv.id = v_variant_id;

    INSERT INTO public.returns (
      org_id, user_id, ecommerce_order_id, return_request_id,
      product_id, variant_id, product_name, quantity, amount_ars,
      reason, refund_method, notes
    ) VALUES (
      v_order.org_id, auth.uid(), v_order.id, v_request.id,
      v_product_id, v_variant_id, v_name, v_qty, round(v_unit * v_qty),
      v_request.reason_text, COALESCE(v_request.refund_method, 'original_payment'),
      COALESCE(v_request.notes, 'Recepción física del RMA ' || v_request.rma_number)
    ) RETURNING id INTO v_return_id;

    PERFORM public.record_stock_movement(
      v_order.org_id, v_product_id, v_variant_id,
      v_name, v_variant_name, 'return', v_qty,
      'ecommerce_order', v_order.id, NULL, v_unit,
      format('Recepción física del RMA %s', v_request.rma_number), auth.uid(), NULL
    );

    v_return_ids := v_return_ids || jsonb_build_array(v_return_id);
    v_received_qty := v_received_qty + v_qty;
    v_received_amount := v_received_amount + round(v_unit * v_qty);
    v_found := true;
    EXIT WHEN v_request.product_id IS NOT NULL;
  END LOOP;

  IF NOT v_found THEN
    RAISE EXCEPTION 'No se encontraron líneas de producto disponibles para recibir este RMA';
  END IF;

  UPDATE public.return_requests
     SET received_at = COALESCE(received_at, now()), updated_at = now()
   WHERE id = v_request.id;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false, 'received_at', now(),
    'return_ids', v_return_ids, 'quantity', v_received_qty,
    'amount', round(v_received_amount)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.receive_store_return_request(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_store_return_request(uuid)
  TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.pago_reintegro_estado(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pago_reintegro_observar(uuid,jsonb)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'ACL de operaciones de devolución quedó demasiado abierta';
  END IF;
END $$;
