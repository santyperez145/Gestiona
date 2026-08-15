-- B4 / confiabilidad de cobros: una devolución o contracargo no puede dejar
-- una orden de tienda marcada como pagada y disponible para despacho.
--
-- El proveedor es la autoridad del pago. La Function sólo llama al RPC con
-- service_role después de volver a pedirle el pago a MercadoPago. El RPC no
-- repone stock ni borra ventas: que se haya devuelto el dinero no demuestra
-- que el producto volvió al depósito. Esa reposición sigue siendo una
-- devolución física explícita por `return_store_order_item` y Kardex.

ALTER TABLE public.ecommerce_orders
  DROP CONSTRAINT IF EXISTS ecommerce_orders_payment_status_check;
ALTER TABLE public.ecommerce_orders
  ADD CONSTRAINT ecommerce_orders_payment_status_check
  CHECK (payment_status IN (
    'pending', 'paid', 'failed', 'refunded', 'charged_back', 'partial'
  ));

ALTER TABLE public.ecommerce_orders
  ADD COLUMN IF NOT EXISTS payment_reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_reversal_reason text;

COMMENT ON COLUMN public.ecommerce_orders.payment_reversed_at IS
  'Momento en que el proveedor confirmó una devolución o contracargo. No implica devolución física de mercadería.';
COMMENT ON COLUMN public.ecommerce_orders.payment_reversal_reason IS
  'Detalle saneado del proveedor para una reversión de pago. No contiene el payload del webhook.';

CREATE INDEX IF NOT EXISTS ecommerce_orders_payment_reversed_idx
  ON public.ecommerce_orders (org_id, payment_reversed_at DESC)
  WHERE payment_status IN ('refunded', 'charged_back');

CREATE OR REPLACE FUNCTION public.trg_soltar_reserva_de_orden()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF NEW.payment_status = 'paid' THEN
      UPDATE public.stock_reservations
         SET status = 'fulfilled', resolved_at = now()
       WHERE order_id = NEW.id AND status = 'active';
    -- Las reversiónes cancelan una reserva que todavía estuviera activa, pero
    -- jamás modifican `products.stock`: una venta cobrada ya lo movió por el
    -- trigger de `sales`, y una devolución física es otro hecho posterior.
    ELSIF NEW.payment_status IN ('failed', 'refunded', 'charged_back') THEN
      UPDATE public.stock_reservations
         SET status = 'cancelled', resolved_at = now()
       WHERE order_id = NEW.id AND status = 'active';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_soltar_reserva_de_orden IS
  'Suelta la reserva al pagar o al caerse/revertirse el pago. No toca stock: el Kardex sólo se mueve por ventas, compras y devoluciones físicas.';

CREATE OR REPLACE FUNCTION public.handle_store_order_payment_reversal(
  p_order_id uuid,
  p_payment_id text,
  p_status text,
  p_detail text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_detail text := NULLIF(left(btrim(COALESCE(p_detail, '')), 500), '');
  v_changed boolean := false;
  v_needs_delivery_review boolean := false;
BEGIN
  IF v_status NOT IN ('refunded', 'charged_back') THEN
    RAISE EXCEPTION 'Estado de reversión inválido: %', COALESCE(p_status, '');
  END IF;

  SELECT * INTO v_order
  FROM public.ecommerce_orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  -- Un webhook de un intento viejo no puede revocar el cobro que realmente
  -- acreditó esta orden. Si el proveedor avisa otro id, se conserva evidencia
  -- en su liquidación pero no se cambia la operación de la tienda.
  IF v_order.payment_id IS NOT NULL
     AND NULLIF(btrim(COALESCE(p_payment_id, '')), '') IS NOT NULL
     AND v_order.payment_id <> btrim(p_payment_id) THEN
    RETURN jsonb_build_object(
      'ok', true, 'changed', false, 'reason', 'different_payment',
      'payment_status', v_order.payment_status
    );
  END IF;

  IF v_order.payment_status = 'charged_back'
     OR (v_order.payment_status = 'refunded' AND v_status = 'refunded') THEN
    RETURN jsonb_build_object(
      'ok', true, 'changed', false, 'payment_status', v_order.payment_status,
      'needs_delivery_review', v_order.fulfillment_status IN ('shipped', 'delivered')
    );
  END IF;

  v_needs_delivery_review := v_order.fulfillment_status IN ('shipped', 'delivered');

  UPDATE public.ecommerce_orders
     SET payment_status = v_status,
         payment_reversed_at = COALESCE(payment_reversed_at, now()),
         payment_reversal_reason = COALESCE(v_detail, payment_reversal_reason),
         -- Si todavía no salió, se cancela la preparación. Si ya se despachó o
         -- entregó, no se inventa que el paquete volvió: se avisa al comercio.
         fulfillment_status = CASE
           WHEN fulfillment_status IN ('pending', 'processing') THEN 'cancelled'
           ELSE fulfillment_status
         END,
         updated_at = now()
   WHERE id = v_order.id;
  v_changed := FOUND;

  IF v_changed THEN
    BEGIN
      INSERT INTO public.notifications (user_id, org_id, title, message, type, entity_type, entity_id)
      SELECT
        m.user_id,
        v_order.org_id,
        CASE WHEN v_status = 'charged_back'
             THEN 'Contracargo en la tienda' ELSE 'Pago devuelto en la tienda' END,
        CASE WHEN v_needs_delivery_review
             THEN format('Pedido %s: el pago se revirtió y el envío ya salió. Coordiná la devolución con el correo; el stock no se repuso automáticamente.', v_order.order_number)
             ELSE format('Pedido %s: el pago se revirtió. La preparación fue cancelada; no lo despaches.', v_order.order_number)
        END,
        'ecommerce', 'ecommerce_order', v_order.id::text
      FROM public.memberships m
      WHERE m.org_id = v_order.org_id AND m.role IN ('owner', 'admin');
    EXCEPTION WHEN OTHERS THEN
      -- La reversión ya quedó persistida; un fallo de aviso no puede hacer que
      -- el proveedor reintente y deje el estado operativo ambiguo.
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'changed', v_changed, 'payment_status', v_status,
    'needs_delivery_review', v_needs_delivery_review
  );
END;
$$;

REVOKE ALL ON FUNCTION public.handle_store_order_payment_reversal(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.handle_store_order_payment_reversal(uuid, text, text, text) IS
  'Sólo Edge Functions con service_role: persiste una devolución/contracargo de MercadoPago, bloquea despacho pendiente y nunca repone stock sin devolución física.';

-- Una orden revertida es terminal para acreditar automáticamente. Un evento
-- `approved` atrasado no puede regenerar ventas ni descontar stock una segunda
-- vez. Para una nueva compra, se crea una orden nueva y trazable.
CREATE OR REPLACE FUNCTION public.mark_store_order_paid(
  p_order_id uuid,
  p_payment_id text DEFAULT NULL,
  p_method text DEFAULT 'mercado_pago'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order       record;
  v_item        jsonb;
  v_prod        record;
  v_qty         int;
  v_owner       uuid;
  v_customer_id uuid;
  v_rate        numeric;
  v_cost_ars    numeric;
  v_profit      numeric;
  v_ventas      int := 0;
BEGIN
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;
  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'ya_procesada', true);
  END IF;
  IF v_order.payment_status IN ('refunded', 'charged_back') THEN
    RAISE EXCEPTION 'El pago de la orden fue revertido; creá una orden nueva para cobrarla'
      USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    v_customer_id := public.upsert_customer_from_order(v_order.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'upsert_customer_from_order falló antes de crear ventas para %: %', p_order_id, SQLERRM;
    v_customer_id := NULL;
  END;

  SELECT m.user_id INTO v_owner
  FROM public.memberships m
  WHERE m.org_id = v_order.org_id AND m.role = 'owner'
  ORDER BY m.joined_at LIMIT 1;

  SELECT COALESCE(exchange_rate, 1) INTO v_rate
  FROM public.settings WHERE org_id = v_order.org_id;
  v_rate := COALESCE(v_rate, 1);

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 1);
    SELECT id, name, stock, total_cost_usd
      INTO v_prod FROM public.products
     WHERE id = (v_item->>'product_id')::uuid FOR UPDATE;
    IF v_prod.id IS NULL THEN CONTINUE; END IF;

    v_cost_ars := COALESCE(v_prod.total_cost_usd, 0) * v_rate;
    v_profit := (v_item->>'unit_price')::numeric * v_qty - v_cost_ars * v_qty;
    INSERT INTO public.sales (
      org_id, user_id, product_id, product_name, quantity,
      unit_price_ars, total_ars, cost_per_unit_usd, cost_of_goods_ars,
      profit_ars, profit_usd, customer_id, customer_name, date, paid,
      payment_method, source, ecommerce_order_id
    ) VALUES (
      v_order.org_id, v_owner, v_prod.id, v_item->>'name', v_qty,
      (v_item->>'unit_price')::numeric, (v_item->>'total')::numeric,
      COALESCE(v_prod.total_cost_usd, 0), round(v_cost_ars * v_qty, 2),
      v_profit, CASE WHEN v_rate > 0 THEN v_profit / v_rate ELSE 0 END,
      v_customer_id, v_order.customer_name, now(), true,
      p_method, 'tienda_online', v_order.id
    );
    v_ventas := v_ventas + 1;
  END LOOP;

  UPDATE public.ecommerce_orders
     SET payment_status = 'paid',
         fulfillment_status = CASE WHEN fulfillment_status = 'pending' THEN 'processing' ELSE fulfillment_status END,
         payment_id = COALESCE(payment_id, p_payment_id),
         updated_at = now()
   WHERE id = p_order_id;

  IF v_owner IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notifications (user_id, org_id, title, message, type)
      VALUES (
        v_owner, v_order.org_id, 'Pedido pagado en la tienda',
        format('%s pagó %s (pedido %s)', v_order.customer_name,
               to_char(v_order.total, 'FM$999G999G999'), v_order.order_number),
        'ecommerce'
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'ventas_creadas', v_ventas, 'customer_id', v_customer_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_store_order_paid(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- Quien recibió una devolución/contracargo puede todavía recibir físicamente
-- el producto y registrar esa reposición. Antes el nuevo estado habría
-- bloqueado el único camino que mueve Kardex correctamente.
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
AS $$
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
  IF v_order.payment_status NOT IN ('paid', 'refunded', 'charged_back') THEN
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
$$;

REVOKE ALL ON FUNCTION public.return_store_order_item(uuid, uuid, uuid, int, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_store_order_item(uuid, uuid, uuid, int, text, text, text) TO authenticated;

-- Verificación con una organización ZZ: reversión corta despacho sin duplicar
-- stock, no permite reaprobar, conserva una orden ya enviada para revisión y
-- permite que el stock vuelva solamente por una devolución física autorizada.
CREATE TEMP TABLE IF NOT EXISTS zz_store_payment_reversal_verification (
  check_name text PRIMARY KEY, passed boolean NOT NULL, detail text
);
TRUNCATE zz_store_payment_reversal_verification;

DO $verify$
DECLARE
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_user uuid;
  v_org uuid;
  v_store uuid;
  v_product uuid;
  v_first uuid;
  v_second uuid;
  v_after_paid numeric;
  v_after_reversal numeric;
  v_status text;
  v_fulfillment text;
  v_can_auth boolean;
  v_reapprove_blocked boolean := false;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    RAISE NOTICE 'Store payment reversal verification omitted: no auth user exists';
    RETURN;
  END IF;
  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ reversión pago tienda', 'zz-pay-reversal-' || v_suffix, v_user)
  RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  INSERT INTO public.ecommerce_stores (org_id, slug) VALUES (v_org, 'zz-pay-reversal-' || v_suffix)
  RETURNING id INTO v_store;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, total_cost_usd, stock)
  VALUES (v_org, v_user, 'ZZ producto reversión', 500, 2, 5)
  RETURNING id INTO v_product;

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_name, customer_email, items, subtotal, total
  ) VALUES (
    v_org, v_store, 'ZZREV-' || v_suffix, 'ZZ comprador', 'zz-reversal-' || v_suffix || '@invalid.test',
    jsonb_build_array(jsonb_build_object('product_id', v_product, 'name', 'ZZ producto reversión', 'quantity', 1, 'unit_price', 500, 'total', 500)),
    500, 500
  ) RETURNING id INTO v_first;
  PERFORM public.mark_store_order_paid(v_first, 'zz-payment-' || v_suffix, 'mercado_pago');
  SELECT stock INTO v_after_paid FROM public.products WHERE id = v_product;
  PERFORM public.handle_store_order_payment_reversal(v_first, 'zz-payment-' || v_suffix, 'refunded', 'test refund');
  SELECT payment_status, fulfillment_status INTO v_status, v_fulfillment FROM public.ecommerce_orders WHERE id = v_first;
  SELECT stock INTO v_after_reversal FROM public.products WHERE id = v_product;
  IF v_status <> 'refunded' OR v_fulfillment <> 'cancelled' OR v_after_reversal <> v_after_paid THEN
    RAISE EXCEPTION 'La reversión no preservó estado/stock: pago %, entrega %, stock %/%', v_status, v_fulfillment, v_after_reversal, v_after_paid;
  END IF;
  BEGIN
    PERFORM public.mark_store_order_paid(v_first, 'zz-payment-' || v_suffix, 'mercado_pago');
  EXCEPTION WHEN check_violation THEN v_reapprove_blocked := true;
  END;
  IF NOT v_reapprove_blocked THEN RAISE EXCEPTION 'Un pago revertido se pudo reaprobar'; END IF;

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_name, customer_email, items, subtotal, total
  ) VALUES (
    v_org, v_store, 'ZZCHB-' || v_suffix, 'ZZ comprador', 'zz-chargeback-' || v_suffix || '@invalid.test',
    jsonb_build_array(jsonb_build_object('product_id', v_product, 'name', 'ZZ producto reversión', 'quantity', 1, 'unit_price', 500, 'total', 500)),
    500, 500
  ) RETURNING id INTO v_second;
  PERFORM public.mark_store_order_paid(v_second, 'zz-chargeback-' || v_suffix, 'mercado_pago');
  UPDATE public.ecommerce_orders SET fulfillment_status = 'shipped' WHERE id = v_second;
  PERFORM public.handle_store_order_payment_reversal(v_second, 'zz-chargeback-' || v_suffix, 'charged_back', 'test chargeback');
  SELECT payment_status, fulfillment_status INTO v_status, v_fulfillment FROM public.ecommerce_orders WHERE id = v_second;
  IF v_status <> 'charged_back' OR v_fulfillment <> 'shipped' THEN
    RAISE EXCEPTION 'El contracargo alteró un envío ya salido: pago %, entrega %', v_status, v_fulfillment;
  END IF;

  SELECT has_function_privilege('authenticated', 'public.handle_store_order_payment_reversal(uuid,text,text,text)', 'EXECUTE')
    INTO v_can_auth;
  IF v_can_auth THEN RAISE EXCEPTION 'La reversión quedó expuesta a authenticated'; END IF;

  DELETE FROM public.sales WHERE ecommerce_order_id IN (v_first, v_second);
  DELETE FROM public.ecommerce_orders WHERE id IN (v_first, v_second);
  DELETE FROM public.organizations WHERE id = v_org;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org)
     OR EXISTS (SELECT 1 FROM public.sales WHERE ecommerce_order_id IN (v_first, v_second))
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'Store payment reversal dejó restos ZZ';
  END IF;
  INSERT INTO zz_store_payment_reversal_verification VALUES
    ('reversión', true, 'estado, stock, re-aprobación, contracargo, ACL y restos verificados');
END
$verify$;

SELECT check_name, passed, detail FROM zz_store_payment_reversal_verification
UNION ALL SELECT 'zz_restos', NOT EXISTS (
  SELECT 1 FROM public.organizations WHERE name = 'ZZ reversión pago tienda'
), 'debe ser true';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260815000003', 'store_payment_reversals') ON CONFLICT DO NOTHING;
