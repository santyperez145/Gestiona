-- A / E4: la venta de la tienda ya calculaba su ganancia pero omitía guardar
-- cost_of_goods_ars. Reportes que suman costo de mercadería quedaban en cero
-- aunque profit_ars sí lo hubiera descontado. Se corrige hacia adelante: no se
-- reconstruyen órdenes históricas con el costo actual del producto porque eso
-- inventaría un dato contable.

CREATE OR REPLACE FUNCTION public.mark_store_order_paid(
  p_order_id   uuid,
  p_payment_id text DEFAULT NULL,
  p_method     text DEFAULT 'mercado_pago'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order    record;
  v_item     jsonb;
  v_prod     record;
  v_qty      int;
  v_owner    uuid;
  v_rate     numeric;
  v_cost_ars numeric;
  v_profit   numeric;
  v_ventas   int := 0;
BEGIN
  SELECT * INTO v_order FROM public.ecommerce_orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;

  -- MercadoPago puede reintentar el mismo webhook: una orden ya cobrada nunca
  -- genera una segunda venta, segundo costo ni segundo movimiento de stock.
  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'ya_procesada', true);
  END IF;

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
    INTO v_prod
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid
    FOR UPDATE;

    IF v_prod.id IS NULL THEN CONTINUE; END IF;

    -- El INSERT en sales activa trg_sale_stock_movement. No se escribe stock
    -- acá: duplicaría el descuento y rompería el Kardex.
    v_cost_ars := COALESCE(v_prod.total_cost_usd, 0) * v_rate;
    v_profit   := (v_item->>'unit_price')::numeric * v_qty - v_cost_ars * v_qty;

    INSERT INTO public.sales (
      org_id, user_id, product_id, product_name, quantity,
      unit_price_ars, total_ars, cost_per_unit_usd, cost_of_goods_ars,
      profit_ars, profit_usd, customer_name, date, paid,
      payment_method, source
    ) VALUES (
      v_order.org_id, v_owner, v_prod.id, v_item->>'name', v_qty,
      (v_item->>'unit_price')::numeric,
      (v_item->>'total')::numeric,
      COALESCE(v_prod.total_cost_usd, 0),
      round(v_cost_ars * v_qty, 2),
      v_profit,
      CASE WHEN v_rate > 0 THEN v_profit / v_rate ELSE 0 END,
      v_order.customer_name, now(), true,
      p_method, 'tienda_online'
    );
    v_ventas := v_ventas + 1;
  END LOOP;

  UPDATE public.ecommerce_orders
  SET payment_status     = 'paid',
      fulfillment_status = CASE WHEN fulfillment_status = 'pending' THEN 'processing' ELSE fulfillment_status END,
      payment_id         = COALESCE(payment_id, p_payment_id),
      updated_at         = now()
  WHERE id = p_order_id;

  IF v_owner IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notifications (user_id, org_id, title, message, type)
      VALUES (
        v_owner, v_order.org_id,
        'Pedido pagado en la tienda',
        format('%s pagó %s (pedido %s)', v_order.customer_name,
               to_char(v_order.total, 'FM$999G999G999'), v_order.order_number),
        'ecommerce'
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'ventas_creadas', v_ventas);
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_store_order_paid(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- Verificación real: el trigger mueve stock una vez y el costo persiste en la
-- venta. La segunda llamada no duplica nada; todo lo ZZ se elimina al final.
DO $verify$
DECLARE
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_user_id uuid;
  v_org_id uuid;
  v_store_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_cogs numeric;
  v_profit numeric;
  v_stock numeric;
  v_sales integer;
  v_can_execute boolean;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Store COGS verification omitted: no auth user exists';
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ costo tienda', 'zz-store-cogs-' || v_suffix, v_user_id)
  RETURNING id INTO v_org_id;
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');
  INSERT INTO public.ecommerce_stores (org_id, slug)
  VALUES (v_org_id, 'zz-store-cogs-' || v_suffix)
  RETURNING id INTO v_store_id;
  INSERT INTO public.products (
    org_id, user_id, name, sale_price_ars, total_cost_usd, stock
  ) VALUES (
    v_org_id, v_user_id, 'ZZ producto costo tienda', 250, 2, 4
  ) RETURNING id INTO v_product_id;
  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_email, customer_name,
    items, subtotal, total
  ) VALUES (
    v_org_id, v_store_id, 'ZZCOGS-' || v_suffix, 'zz-cogs@example.invalid', 'ZZ Comprador',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'name', 'ZZ producto costo tienda',
      'quantity', 2,
      'unit_price', 250,
      'total', 500
    )),
    500, 500
  ) RETURNING id INTO v_order_id;

  PERFORM public.mark_store_order_paid(v_order_id, 'zz-payment-' || v_suffix, 'mercado_pago');
  PERFORM public.mark_store_order_paid(v_order_id, 'zz-payment-' || v_suffix, 'mercado_pago');

  SELECT cost_of_goods_ars, profit_ars
    INTO v_cogs, v_profit
  FROM public.sales
  WHERE org_id = v_org_id AND product_id = v_product_id;
  SELECT stock INTO v_stock FROM public.products WHERE id = v_product_id;
  SELECT count(*) INTO v_sales FROM public.sales WHERE org_id = v_org_id;

  IF v_cogs <> 4 OR v_profit <> 496 OR v_stock <> 2 OR v_sales <> 1 THEN
    RAISE EXCEPTION 'Store COGS invalid: cogs %, profit %, stock %, sales %',
      v_cogs, v_profit, v_stock, v_sales;
  END IF;

  SELECT has_function_privilege(
    'authenticated',
    'public.mark_store_order_paid(uuid,text,text)',
    'EXECUTE'
  ) INTO v_can_execute;
  IF v_can_execute THEN
    RAISE EXCEPTION 'mark_store_order_paid quedó ejecutable por authenticated';
  END IF;

  DELETE FROM public.sales WHERE org_id = v_org_id;
  DELETE FROM public.ecommerce_orders WHERE id = v_order_id;
  DELETE FROM public.organizations WHERE id = v_org_id;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id)
     OR EXISTS (SELECT 1 FROM public.ecommerce_orders WHERE id = v_order_id)
     OR EXISTS (SELECT 1 FROM public.sales WHERE org_id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE org_id = v_org_id) THEN
    RAISE EXCEPTION 'Store COGS dejó filas ZZ';
  END IF;

  RAISE NOTICE 'Store COGS verificado: costo persistido, stock una vez y restos ZZ 0';
END
$verify$;
