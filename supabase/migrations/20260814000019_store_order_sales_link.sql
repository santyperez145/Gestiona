-- E4: cada línea de venta de la tienda tiene que poder explicar de qué orden,
-- cobro y conceptos viene. Antes `sales` decía tienda_online pero no guardaba
-- el id de la orden: la liquidación de MercadoPago, el IVA y el envío quedaban
-- aislados en otras tablas y cualquier cruce posterior era una conjetura por
-- fecha, importe o nombre del cliente.
--
-- El vínculo es prospectivo. No se unen ventas históricas por heurística: una
-- atribución incorrecta sería peor que una fila explícitamente incompleta.

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS ecommerce_order_id uuid
  REFERENCES public.ecommerce_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sales_ecommerce_order_idx
  ON public.sales(org_id, ecommerce_order_id)
  WHERE ecommerce_order_id IS NOT NULL;

COMMENT ON COLUMN public.sales.ecommerce_order_id IS
  'Orden de tienda que creó esta línea de venta. Sólo se completa hacia adelante por mark_store_order_paid; no se infiere para ventas históricas.';

-- Conserva el circuito de pago de la tienda y agrega el enlace al insertar la
-- venta. El trigger de sales sigue siendo el único que mueve stock; este RPC
-- no actualiza products.stock ni variants.stock.
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

    v_cost_ars := COALESCE(v_prod.total_cost_usd, 0) * v_rate;
    v_profit   := (v_item->>'unit_price')::numeric * v_qty - v_cost_ars * v_qty;

    INSERT INTO public.sales (
      org_id, user_id, product_id, product_name, quantity,
      unit_price_ars, total_ars, cost_per_unit_usd, cost_of_goods_ars,
      profit_ars, profit_usd, customer_name, date, paid,
      payment_method, source, ecommerce_order_id
    ) VALUES (
      v_order.org_id, v_owner, v_prod.id, v_item->>'name', v_qty,
      (v_item->>'unit_price')::numeric,
      (v_item->>'total')::numeric,
      COALESCE(v_prod.total_cost_usd, 0),
      round(v_cost_ars * v_qty, 2),
      v_profit,
      CASE WHEN v_rate > 0 THEN v_profit / v_rate ELSE 0 END,
      v_order.customer_name, now(), true,
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

  RETURN jsonb_build_object('ok', true, 'ventas_creadas', v_ventas);
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_store_order_paid(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- RLS no puede proteger una sola columna. Los miembros sí pueden cargar una
-- venta manual, pero no pueden declarar que pertenece a una orden de tienda:
-- eso adulteraría la liquidación por línea. Sólo el flujo server-side de pago
-- (service_role) establece o modifica el vínculo.
CREATE OR REPLACE FUNCTION public.guard_sales_ecommerce_order_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.ecommerce_order_id IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.ecommerce_order_id IS DISTINCT FROM OLD.ecommerce_order_id) THEN
    IF auth.role() IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'El vínculo de una venta con una orden de tienda sólo lo registra el cobro del servidor';
    END IF;

    IF NEW.ecommerce_order_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.ecommerce_orders o
         WHERE o.id = NEW.ecommerce_order_id AND o.org_id = NEW.org_id
       ) THEN
      RAISE EXCEPTION 'La orden de tienda debe pertenecer a la misma organización que la venta';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_sales_ecommerce_order_link ON public.sales;
CREATE TRIGGER trg_guard_sales_ecommerce_order_link
  BEFORE INSERT OR UPDATE OF ecommerce_order_id ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.guard_sales_ecommerce_order_link();

REVOKE ALL ON FUNCTION public.guard_sales_ecommerce_order_link() FROM PUBLIC, anon, authenticated;

-- Hechos por línea para la futura comparación de margen por canal. El costo
-- de envío de la columna de la orden es lo que pagó el comprador, no el costo
-- real del correo: se nombra así para no presentar ingreso como gasto. La
-- etiqueta/API del transportista aún no informa su costo final, por eso ese
-- término queda NULL en vez de inventar una ganancia "real".
CREATE OR REPLACE VIEW public.store_order_margin_facts
WITH (security_invoker = true)
AS
WITH settlements AS (
  SELECT
    pt.org_id,
    pt.source_id AS ecommerce_order_id,
    round(sum(pt.provider_fee + pt.provider_fee_iva + pt.platform_fee), 2) AS payment_fee_total_ars
  FROM public.payment_transactions pt
  WHERE pt.source = 'ecommerce'
    AND pt.status = 'approved'
    AND pt.source_id IS NOT NULL
  GROUP BY pt.org_id, pt.source_id
), lines AS (
  SELECT
    s.id AS sale_id,
    s.org_id,
    s.ecommerce_order_id,
    s.product_id,
    s.product_name,
    s.quantity,
    s.date AS sold_at,
    s.total_ars AS product_revenue_ars,
    s.cost_of_goods_ars,
    o.order_number,
    o.shipping_cost AS shipping_charged_order_ars,
    o.tax_amount AS tax_order_ars,
    st.payment_fee_total_ars,
    sum(s.total_ars) OVER (PARTITION BY s.ecommerce_order_id) AS products_total_ars,
    row_number() OVER (PARTITION BY s.ecommerce_order_id ORDER BY s.id) AS allocation_position,
    count(*) OVER (PARTITION BY s.ecommerce_order_id) AS allocation_count
  FROM public.sales s
  JOIN public.ecommerce_orders o
    ON o.id = s.ecommerce_order_id AND o.org_id = s.org_id
  LEFT JOIN settlements st
    ON st.org_id = s.org_id AND st.ecommerce_order_id = s.ecommerce_order_id
  WHERE s.source = 'tienda_online'
    AND s.ecommerce_order_id IS NOT NULL
), provisional AS (
  SELECT
    *,
    CASE WHEN payment_fee_total_ars IS NOT NULL AND products_total_ars > 0
      THEN round(payment_fee_total_ars * product_revenue_ars / products_total_ars, 2)
    END AS payment_fee_preliminary_ars,
    CASE WHEN products_total_ars > 0
      THEN round(shipping_charged_order_ars * product_revenue_ars / products_total_ars, 2)
    END AS shipping_charged_preliminary_ars,
    CASE WHEN products_total_ars > 0
      THEN round(tax_order_ars * product_revenue_ars / products_total_ars, 2)
    END AS tax_preliminary_ars
  FROM lines
), allocated AS (
  SELECT
    *,
    CASE
      WHEN payment_fee_total_ars IS NULL OR products_total_ars <= 0 THEN NULL
      WHEN allocation_position = allocation_count THEN round(
        payment_fee_total_ars
        - coalesce(sum(payment_fee_preliminary_ars) OVER (
            PARTITION BY ecommerce_order_id
            ORDER BY sale_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0),
        2
      )
      ELSE payment_fee_preliminary_ars
    END AS payment_fee_ars,
    CASE
      WHEN products_total_ars <= 0 THEN NULL
      WHEN allocation_position = allocation_count THEN round(
        shipping_charged_order_ars
        - coalesce(sum(shipping_charged_preliminary_ars) OVER (
            PARTITION BY ecommerce_order_id
            ORDER BY sale_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0),
        2
      )
      ELSE shipping_charged_preliminary_ars
    END AS shipping_charged_ars,
    CASE
      WHEN products_total_ars <= 0 THEN NULL
      WHEN allocation_position = allocation_count THEN round(
        tax_order_ars
        - coalesce(sum(tax_preliminary_ars) OVER (
            PARTITION BY ecommerce_order_id
            ORDER BY sale_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0),
        2
      )
      ELSE tax_preliminary_ars
    END AS tax_ars
  FROM provisional
)
SELECT
  sale_id,
  org_id,
  ecommerce_order_id,
  product_id,
  product_name,
  quantity,
  sold_at,
  order_number,
  product_revenue_ars,
  cost_of_goods_ars,
  payment_fee_ars,
  shipping_charged_ars,
  tax_ars,
  NULL::numeric AS carrier_shipping_cost_ars,
  round(product_revenue_ars - cost_of_goods_ars, 2) AS gross_margin_ars,
  CASE WHEN payment_fee_ars IS NOT NULL
    THEN round(product_revenue_ars - cost_of_goods_ars - payment_fee_ars, 2)
  END AS margin_after_payment_ars,
  payment_fee_ars IS NOT NULL AS payment_fee_recorded,
  false AS carrier_shipping_cost_recorded
FROM allocated;

COMMENT ON VIEW public.store_order_margin_facts IS
  'Hechos por línea de venta de tienda: costo de mercadería, comisión de pago, IVA y envío cobrado al comprador. El costo real del correo se mantiene NULL hasta que se registre desde una etiqueta/contrato.';

REVOKE ALL ON TABLE public.store_order_margin_facts FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.store_order_margin_facts TO authenticated;

-- Verificación real: dos líneas reciben la misma llave de orden y el prorrateo
-- conserva exactamente comisión, envío cobrado e IVA. Se usa un org ZZ y se
-- elimina todo antes de terminar.
DO $verify$
DECLARE
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_user_id uuid;
  v_org_id uuid;
  v_store_id uuid;
  v_product_a uuid;
  v_product_b uuid;
  v_order_id uuid;
  v_linked_sales integer;
  v_payment_a numeric;
  v_payment_b numeric;
  v_shipping_a numeric;
  v_shipping_b numeric;
  v_tax_a numeric;
  v_tax_b numeric;
  v_margin_a numeric;
  v_margin_b numeric;
  v_anon_can_select boolean;
  v_auth_can_select boolean;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Store margin facts verification omitted: no auth user exists';
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ hechos margen tienda', 'zz-store-margin-' || v_suffix, v_user_id)
  RETURNING id INTO v_org_id;
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');
  INSERT INTO public.ecommerce_stores (org_id, slug)
  VALUES (v_org_id, 'zz-store-margin-' || v_suffix)
  RETURNING id INTO v_store_id;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, total_cost_usd, stock)
  VALUES (v_org_id, v_user_id, 'ZZ margen tienda A', 200, 2, 4)
  RETURNING id INTO v_product_a;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, total_cost_usd, stock)
  VALUES (v_org_id, v_user_id, 'ZZ margen tienda B', 600, 3, 4)
  RETURNING id INTO v_product_b;

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_email, customer_name,
    items, subtotal, shipping_cost, tax_amount, total
  ) VALUES (
    v_org_id, v_store_id, 'ZZMARGIN-' || v_suffix,
    'zz-margin@example.invalid', 'ZZ Comprador',
    jsonb_build_array(
      jsonb_build_object('product_id', v_product_a, 'name', 'ZZ margen tienda A', 'quantity', 1, 'unit_price', 200, 'total', 200),
      jsonb_build_object('product_id', v_product_b, 'name', 'ZZ margen tienda B', 'quantity', 1, 'unit_price', 600, 'total', 600)
    ),
    800, 100, 168, 900
  ) RETURNING id INTO v_order_id;

  PERFORM public.mark_store_order_paid(v_order_id, 'zz-margin-payment-' || v_suffix, 'mercado_pago');

  INSERT INTO public.payment_transactions (
    org_id, source, source_id, provider, method, gross_amount,
    provider_fee, provider_fee_iva, platform_fee, net_amount,
    status, external_id
  ) VALUES (
    v_org_id, 'ecommerce', v_order_id, 'mercadopago', 'wallet', 900,
    60, 12, 8, 820,
    'approved', 'zz-margin-payment-' || v_suffix
  );

  SELECT count(*) INTO v_linked_sales
  FROM public.sales
  WHERE ecommerce_order_id = v_order_id AND source = 'tienda_online';
  SELECT payment_fee_ars, shipping_charged_ars, tax_ars, margin_after_payment_ars
    INTO v_payment_a, v_shipping_a, v_tax_a, v_margin_a
  FROM public.store_order_margin_facts
  WHERE ecommerce_order_id = v_order_id AND product_id = v_product_a;
  SELECT payment_fee_ars, shipping_charged_ars, tax_ars, margin_after_payment_ars
    INTO v_payment_b, v_shipping_b, v_tax_b, v_margin_b
  FROM public.store_order_margin_facts
  WHERE ecommerce_order_id = v_order_id AND product_id = v_product_b;

  IF v_linked_sales <> 2
     OR v_payment_a <> 20 OR v_payment_b <> 60
     OR v_shipping_a <> 25 OR v_shipping_b <> 75
     OR v_tax_a <> 42 OR v_tax_b <> 126
     OR v_margin_a <> 178 OR v_margin_b <> 537 THEN
    RAISE EXCEPTION 'Store margin facts invalid: links %, fees %/%, shipping %/%, tax %/%, margins %/%',
      v_linked_sales, v_payment_a, v_payment_b, v_shipping_a, v_shipping_b,
      v_tax_a, v_tax_b, v_margin_a, v_margin_b;
  END IF;

  SELECT has_table_privilege('anon', 'public.store_order_margin_facts', 'SELECT')
    INTO v_anon_can_select;
  SELECT has_table_privilege('authenticated', 'public.store_order_margin_facts', 'SELECT')
    INTO v_auth_can_select;
  IF v_anon_can_select OR NOT v_auth_can_select THEN
    RAISE EXCEPTION 'Store margin facts grants invalid: anon %, authenticated %',
      v_anon_can_select, v_auth_can_select;
  END IF;

  DELETE FROM public.payment_transactions WHERE org_id = v_org_id;
  DELETE FROM public.sales WHERE org_id = v_org_id;
  DELETE FROM public.ecommerce_orders WHERE id = v_order_id;
  DELETE FROM public.organizations WHERE id = v_org_id;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.products WHERE id IN (v_product_a, v_product_b))
     OR EXISTS (SELECT 1 FROM public.ecommerce_orders WHERE id = v_order_id)
     OR EXISTS (SELECT 1 FROM public.sales WHERE org_id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.payment_transactions WHERE org_id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE org_id = v_org_id) THEN
    RAISE EXCEPTION 'Store margin facts dejó filas ZZ';
  END IF;

  RAISE NOTICE 'Store margin facts verified: orden enlazada, prorrateo exacto y restos ZZ 0';
END
$verify$;
