-- E3 / Un cliente, una ficha: una venta de tienda no debe depender de que el
-- nombre del checkout coincida con el de CRM. `trg_sales_link_customer` corre
-- al INSERT de sales, pero el alta por email ocurría recién después, al cambiar
-- la orden a paid. Un homónimo existente podía quedar enlazado por nombre o la
-- venta quedar sin customer_id.
--
-- El pago resuelve primero `upsert_customer_from_order`, que usa el email
-- normalizado de la orden, y entrega ese id explícito a la nueva venta. POS ya
-- usa `customers` como su ficha; así ambos canales comparten el mismo historial
-- sin convertir `store_customers` en usuarios del SaaS ni inferir históricos.

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

  -- MercadoPago puede reintentar el mismo webhook: una orden ya cobrada nunca
  -- genera una segunda venta, segundo costo ni segundo movimiento de stock.
  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'ya_procesada', true);
  END IF;

  -- La identidad del checkout se resuelve por email ANTES del INSERT de sale.
  -- Es best-effort igual que el trigger histórico: un problema de CRM no puede
  -- impedir acreditar un cobro ni mover el stock. Si falla, el trigger de sales
  -- conserva su fallback por nombre, pero nunca reemplaza un id ya confirmado.
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
    INTO v_prod
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid
    FOR UPDATE;

    IF v_prod.id IS NULL THEN CONTINUE; END IF;

    v_cost_ars := COALESCE(v_prod.total_cost_usd, 0) * v_rate;
    v_profit   := (v_item->>'unit_price')::numeric * v_qty - v_cost_ars * v_qty;

    -- `customer_id` explícito gana sobre el trigger de nombre. El trigger
    -- mantiene su fallback para otros canales y para un fallo best-effort de
    -- CRM; este camino tiene evidencia más fuerte: el email de la orden.
    INSERT INTO public.sales (
      org_id, user_id, product_id, product_name, quantity,
      unit_price_ars, total_ars, cost_per_unit_usd, cost_of_goods_ars,
      profit_ars, profit_usd, customer_id, customer_name, date, paid,
      payment_method, source, ecommerce_order_id
    ) VALUES (
      v_order.org_id, v_owner, v_prod.id, v_item->>'name', v_qty,
      (v_item->>'unit_price')::numeric,
      (v_item->>'total')::numeric,
      COALESCE(v_prod.total_cost_usd, 0),
      round(v_cost_ars * v_qty, 2),
      v_profit,
      CASE WHEN v_rate > 0 THEN v_profit / v_rate ELSE 0 END,
      v_customer_id, v_order.customer_name, now(), true,
      p_method, 'tienda_online', v_order.id
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

  RETURN jsonb_build_object('ok', true, 'ventas_creadas', v_ventas, 'customer_id', v_customer_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_store_order_paid(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- Prueba real: un cliente de mostrador homónimo pero con otro email no puede
-- captar la venta online. El único id válido es el que resuelve el email del
-- checkout. Se crea un org ZZ completo y se borra antes de salir.
DO $verify$
DECLARE
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_user_id uuid;
  v_org_id uuid;
  v_store_id uuid;
  v_product_id uuid;
  v_decoy_customer_id uuid;
  v_order_id uuid;
  v_sale_customer_id uuid;
  v_sale_email text;
  v_anon_can_execute boolean;
  v_auth_can_execute boolean;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Store customer-link verification omitted: no auth user exists';
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ enlace cliente tienda', 'zz-store-customer-' || v_suffix, v_user_id)
  RETURNING id INTO v_org_id;
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');
  INSERT INTO public.ecommerce_stores (org_id, slug)
  VALUES (v_org_id, 'zz-store-customer-' || v_suffix)
  RETURNING id INTO v_store_id;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, total_cost_usd, stock)
  VALUES (v_org_id, v_user_id, 'ZZ producto enlace', 500, 2, 3)
  RETURNING id INTO v_product_id;

  -- Mismo nombre que el checkout, distinto email: es la trampa que el vínculo
  -- por nombre habría elegido de forma estable pero equivocada.
  INSERT INTO public.customers (org_id, user_id, name, email)
  VALUES (v_org_id, v_user_id, 'ZZ Cliente Homónimo', 'zz-otro-' || v_suffix || '@example.invalid')
  RETURNING id INTO v_decoy_customer_id;

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_name, customer_email, customer_phone,
    items, subtotal, shipping_cost, tax_amount, total
  ) VALUES (
    v_org_id, v_store_id, 'ZZCUSTOMER-' || v_suffix,
    'ZZ Cliente Homónimo', 'zz-comprador-' || v_suffix || '@example.invalid', '+5491100000000',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id, 'name', 'ZZ producto enlace',
      'quantity', 1, 'unit_price', 500, 'total', 500
    )),
    500, 0, 0, 500
  ) RETURNING id INTO v_order_id;

  PERFORM public.mark_store_order_paid(v_order_id, 'zz-customer-payment-' || v_suffix, 'mercado_pago');

  SELECT s.customer_id, lower(btrim(c.email))
    INTO v_sale_customer_id, v_sale_email
  FROM public.sales s
  LEFT JOIN public.customers c ON c.id = s.customer_id
  WHERE s.ecommerce_order_id = v_order_id;

  IF v_sale_customer_id IS NULL
     OR v_sale_customer_id = v_decoy_customer_id
     OR v_sale_email <> 'zz-comprador-' || v_suffix || '@example.invalid' THEN
    RAISE EXCEPTION 'La venta de tienda no quedó enlazada al CRM por email: id %, email %',
      v_sale_customer_id, v_sale_email;
  END IF;

  SELECT has_function_privilege('anon', 'public.mark_store_order_paid(uuid, text, text)', 'EXECUTE')
    INTO v_anon_can_execute;
  SELECT has_function_privilege('authenticated', 'public.mark_store_order_paid(uuid, text, text)', 'EXECUTE')
    INTO v_auth_can_execute;
  IF v_anon_can_execute OR v_auth_can_execute THEN
    RAISE EXCEPTION 'mark_store_order_paid quedó expuesta: anon %, authenticated %',
      v_anon_can_execute, v_auth_can_execute;
  END IF;

  DELETE FROM public.sales WHERE ecommerce_order_id = v_order_id;
  DELETE FROM public.ecommerce_orders WHERE id = v_order_id;
  DELETE FROM public.customers WHERE org_id = v_org_id;
  DELETE FROM public.organizations WHERE id = v_org_id;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.ecommerce_orders WHERE id = v_order_id)
     OR EXISTS (SELECT 1 FROM public.sales WHERE ecommerce_order_id = v_order_id)
     OR EXISTS (SELECT 1 FROM public.customers WHERE org_id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE org_id = v_org_id) THEN
    RAISE EXCEPTION 'Store customer-link dejó filas ZZ';
  END IF;

  RAISE NOTICE 'Store customer-link verified: venta enlazada por email y restos ZZ 0';
END
$verify$;
