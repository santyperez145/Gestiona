-- C7 / E4: el costo de envio de MercadoLibre se toma del shipment ya vendido.
--
-- /orders trae precio y sale_fee, pero no el cargo final de Mercado Envios.
-- La fuente para conciliacion es GET /shipments/{id}/costs: senders[].cost es
-- lo que finalmente se le cobra al vendedor. NULL significa "todavia no lo
-- informó ML"; cero solamente se guarda cuando la respuesta dice cero.
--
-- Una orden puede tener varias lineas. El cargo se prorratea por importe de
-- linea y el ultimo centavo queda en la ultima para que la suma sea siempre el
-- total informado por ML. Asi E4 puede explicar cada margen sin inventar un
-- envio por producto.

ALTER TABLE public.meli_orders
  ADD COLUMN IF NOT EXISTS shipment_id text,
  ADD COLUMN IF NOT EXISTS seller_shipping_cost_ars numeric(14,2),
  ADD COLUMN IF NOT EXISTS shipping_cost_currency text,
  ADD COLUMN IF NOT EXISTS shipping_cost_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipping_cost_error text;

ALTER TABLE public.meli_order_sale_lines
  ADD COLUMN IF NOT EXISTS seller_shipping_cost_ars numeric(14,2),
  ADD COLUMN IF NOT EXISTS exchange_rate_ars numeric(14,4);

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meli_orders_seller_shipping_cost_nonnegative'
      AND conrelid = 'public.meli_orders'::regclass
  ) THEN
    ALTER TABLE public.meli_orders
      ADD CONSTRAINT meli_orders_seller_shipping_cost_nonnegative
      CHECK (seller_shipping_cost_ars IS NULL OR seller_shipping_cost_ars >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meli_order_sale_lines_seller_shipping_cost_nonnegative'
      AND conrelid = 'public.meli_order_sale_lines'::regclass
  ) THEN
    ALTER TABLE public.meli_order_sale_lines
      ADD CONSTRAINT meli_order_sale_lines_seller_shipping_cost_nonnegative
      CHECK (seller_shipping_cost_ars IS NULL OR seller_shipping_cost_ars >= 0);
  END IF;
END
$constraints$;

CREATE INDEX IF NOT EXISTS meli_orders_shipment_id_idx
  ON public.meli_orders(org_id, shipment_id)
  WHERE shipment_id IS NOT NULL;

-- La Function usa este RPC despues de bajar /shipments/{id}/costs. Tambien
-- sirve si primero se importo la venta y ML informa el shipment despues: en
-- ese caso ajusta el resultado contable sin tocar stock ni volver a crear una
-- venta. No se expone al navegador.
CREATE OR REPLACE FUNCTION public.apply_meli_shipping_cost(
  p_org_id uuid,
  p_meli_order_id uuid,
  p_seller_shipping_cost_ars numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order         public.meli_orders%ROWTYPE;
  v_line          record;
  v_total_sales   numeric := 0;
  v_remaining     numeric;
  v_allocated     numeric;
  v_line_count    integer := 0;
  v_line_position integer := 0;
BEGIN
  IF p_seller_shipping_cost_ars IS NULL
     OR p_seller_shipping_cost_ars < 0
     OR p_seller_shipping_cost_ars = 'NaN'::numeric THEN
    RAISE EXCEPTION 'El costo de envio de MercadoLibre debe ser un importe no negativo';
  END IF;

  SELECT * INTO v_order
  FROM public.meli_orders
  WHERE id = p_meli_order_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de MercadoLibre no encontrada en la organización';
  END IF;

  UPDATE public.meli_orders
  SET seller_shipping_cost_ars = round(p_seller_shipping_cost_ars, 2),
      shipping_cost_updated_at = now(),
      shipping_cost_error = NULL
  WHERE id = v_order.id;

  SELECT count(*), COALESCE(sum(s.total_ars), 0)
    INTO v_line_count, v_total_sales
  FROM public.meli_order_sale_lines l
  JOIN public.sales s ON s.id = l.sale_id
  WHERE l.meli_order_id = v_order.id;

  -- La orden aun no entro al Core: se conserva el costo a nivel orden para que
  -- importarla mas tarde lo aplique. Con precio cero no hay base honesta para
  -- repartir un costo entre productos, asi que las lineas quedan incompletas.
  IF v_line_count = 0 OR v_total_sales <= 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'lineas_actualizadas', 0,
      'prorrateado', false,
      'motivo', CASE WHEN v_line_count = 0 THEN 'orden_aun_no_importada' ELSE 'lineas_sin_base_de_prorrateo' END
    );
  END IF;

  v_remaining := round(p_seller_shipping_cost_ars, 2);

  FOR v_line IN
    SELECT l.id AS line_id, s.id AS sale_id, s.total_ars
    FROM public.meli_order_sale_lines l
    JOIN public.sales s ON s.id = l.sale_id
    WHERE l.meli_order_id = v_order.id
    ORDER BY l.line_number, l.id
  LOOP
    v_line_position := v_line_position + 1;
    IF v_line_position = v_line_count THEN
      -- Absorbe los redondeos de las lineas previas: nunca queda un centavo
      -- perdido ni una suma que no coincida con el cargo del shipment.
      v_allocated := v_remaining;
    ELSE
      v_allocated := round(p_seller_shipping_cost_ars * v_line.total_ars / v_total_sales, 2);
      v_remaining := v_remaining - v_allocated;
    END IF;

    UPDATE public.meli_order_sale_lines
    SET seller_shipping_cost_ars = v_allocated
    WHERE id = v_line.line_id;
  END LOOP;

  UPDATE public.sales s
  SET profit_ars = round(
        s.total_ars - s.cost_of_goods_ars - l.sale_fee_ars - l.seller_shipping_cost_ars,
        2
      ),
      profit_usd = CASE
        WHEN l.exchange_rate_ars IS NOT NULL AND l.exchange_rate_ars > 0
          THEN round((s.total_ars - s.cost_of_goods_ars - l.sale_fee_ars - l.seller_shipping_cost_ars)
                     / l.exchange_rate_ars, 4)
        ELSE s.profit_usd
      END
  FROM public.meli_order_sale_lines l
  WHERE l.meli_order_id = v_order.id
    AND l.sale_id = s.id;

  RETURN jsonb_build_object(
    'ok', true,
    'lineas_actualizadas', v_line_count,
    'prorrateado', true,
    'shipping_cost_ars', round(p_seller_shipping_cost_ars, 2)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_meli_shipping_cost(uuid, uuid, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_meli_shipping_cost(uuid, uuid, numeric)
  TO service_role;

-- Reemplaza la importacion para que una orden que ya tiene costo de shipment
-- lo aplique al entrar, y para conservar el tipo de cambio de cada linea.
CREATE OR REPLACE FUNCTION public.import_meli_order_as_sales(
  p_org_id uuid,
  p_meli_order_id uuid,
  p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order             public.meli_orders%ROWTYPE;
  v_item              jsonb;
  v_product           record;
  v_item_id           text;
  v_quantity          integer;
  v_unit_price        numeric;
  v_line_fee          numeric;
  v_cost_per_unit_usd numeric;
  v_cost_ars          numeric;
  v_line_total        numeric;
  v_line_profit       numeric;
  v_exchange_rate     numeric := 1695;
  v_sale_id           uuid;
  v_first_sale_id     uuid;
  v_line_number       integer := 0;
  v_sales_count       integer := 0;
  v_sales             jsonb := '[]'::jsonb;
  v_total_sales       numeric := 0;
  v_total_fee         numeric := 0;
  v_payment_gross     numeric;
BEGIN
  IF NOT public.has_org_role(p_org_id, p_actor_id, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires owner/admin role';
  END IF;

  SELECT * INTO v_order
  FROM public.meli_orders
  WHERE id = p_meli_order_id AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de MercadoLibre no encontrada en la organización';
  END IF;

  IF lower(COALESCE(v_order.status, '')) <> 'paid' THEN
    RAISE EXCEPTION 'Sólo se pueden importar órdenes cobradas de MercadoLibre';
  END IF;

  IF v_order.imported_at IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(sale_id ORDER BY line_number), '[]'::jsonb)
      INTO v_sales
    FROM public.meli_order_sale_lines
    WHERE meli_order_id = v_order.id;

    RETURN jsonb_build_object(
      'already_imported', true,
      'ventas', jsonb_array_length(v_sales),
      'sale_ids', v_sales
    );
  END IF;

  IF jsonb_typeof(v_order.items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_order.items) = 0 THEN
    RAISE EXCEPTION 'La orden no tiene productos para importar';
  END IF;

  SELECT COALESCE(NULLIF(exchange_rate, 0), 1695)
    INTO v_exchange_rate
  FROM public.settings
  WHERE org_id = p_org_id
  LIMIT 1;
  v_exchange_rate := COALESCE(v_exchange_rate, 1695);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_order.items)
  LOOP
    v_line_number := v_line_number + 1;
    v_item_id := NULLIF(btrim(v_item->>'item_id'), '');

    BEGIN
      v_quantity := (v_item->>'quantity')::integer;
      v_unit_price := (v_item->>'unit_price')::numeric;
      v_line_fee := NULLIF(v_item->>'sale_fee', '')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'La orden tiene una línea con cantidad, precio o comisión inválidos';
    END;

    IF v_item_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0
       OR v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'La orden tiene una línea incompleta o inválida';
    END IF;

    IF v_line_fee IS NULL THEN
      SELECT NULLIF(raw_item->>'sale_fee', '')::numeric
        INTO v_line_fee
      FROM jsonb_array_elements(COALESCE(v_order.raw->'order_items', '[]'::jsonb)) raw_item
      WHERE raw_item->'item'->>'id' = v_item_id
      LIMIT 1;
    END IF;

    IF v_line_fee IS NULL OR v_line_fee < 0 THEN
      RAISE EXCEPTION 'MercadoLibre no informó una comisión válida para la publicación %', v_item_id;
    END IF;

    SELECT p.id, p.name, p.total_cost_usd
      INTO v_product
    FROM public.meli_listings ml
    JOIN public.products p ON p.id = ml.product_id AND p.org_id = ml.org_id
    WHERE ml.org_id = p_org_id
      AND ml.meli_item_id = v_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'La publicación % no está vinculada a un producto de Gestiona', v_item_id;
    END IF;

    v_cost_per_unit_usd := COALESCE(v_product.total_cost_usd, 0);
    v_cost_ars := round(v_cost_per_unit_usd * v_exchange_rate * v_quantity, 2);
    v_line_total := round(v_unit_price * v_quantity, 2);
    -- Si shipment todavia no esta disponible, el resultado conserva solo los
    -- terminos conocidos. apply_meli_shipping_cost lo completa despues.
    v_line_profit := round(v_line_total - v_cost_ars - v_line_fee, 2);

    INSERT INTO public.sales (
      user_id, org_id, product_id, product_name, quantity, unit_price_ars,
      total_ars, cost_per_unit_usd, cost_of_goods_ars, profit_ars, profit_usd,
      customer_name, date, paid, payment_method, source
    ) VALUES (
      p_actor_id, p_org_id, v_product.id, v_product.name, v_quantity, v_unit_price,
      v_line_total, v_cost_per_unit_usd, v_cost_ars, v_line_profit,
      round(v_line_profit / v_exchange_rate, 4),
      NULLIF(btrim(v_order.buyer_nickname), ''), COALESCE(v_order.date_created, now()),
      true, 'mercadolibre', 'mercadolibre'
    ) RETURNING id INTO v_sale_id;

    INSERT INTO public.meli_order_sale_lines (
      org_id, meli_order_id, sale_id, line_number, meli_item_id, sale_fee_ars,
      exchange_rate_ars
    ) VALUES (
      p_org_id, v_order.id, v_sale_id, v_line_number, v_item_id, v_line_fee,
      v_exchange_rate
    );

    v_first_sale_id := COALESCE(v_first_sale_id, v_sale_id);
    v_sales_count := v_sales_count + 1;
    v_sales := v_sales || to_jsonb(v_sale_id);
    v_total_sales := v_total_sales + v_line_total;
    v_total_fee := v_total_fee + v_line_fee;
  END LOOP;

  v_payment_gross := COALESCE(NULLIF(v_order.total_ars, 0), v_total_sales);
  IF v_payment_gross <= 0 THEN
    RAISE EXCEPTION 'La orden no informa un total cobrable';
  END IF;
  IF v_total_fee > v_payment_gross THEN
    RAISE EXCEPTION 'La comisión de MercadoLibre supera el total de la orden';
  END IF;

  INSERT INTO public.payment_transactions (
    org_id, source, source_id, provider, method, installments,
    gross_amount, provider_fee, provider_fee_iva, platform_fee, net_amount,
    currency, status, external_id, released_at, raw
  ) VALUES (
    p_org_id, 'mercadolibre', v_order.id, 'mercadolibre', 'marketplace', 0,
    round(v_payment_gross, 2), round(v_total_fee, 2), 0, 0,
    round(v_payment_gross - v_total_fee, 2), 'ARS', 'approved',
    'meli-order:' || v_order.meli_order_id::text, now(), v_order.raw
  )
  ON CONFLICT (provider, external_id) DO UPDATE
    SET status = EXCLUDED.status,
        updated_at = now();

  UPDATE public.meli_orders
  SET sale_id = v_first_sale_id,
      imported_at = now()
  WHERE id = v_order.id;

  IF v_order.seller_shipping_cost_ars IS NOT NULL THEN
    PERFORM public.apply_meli_shipping_cost(
      p_org_id,
      v_order.id,
      v_order.seller_shipping_cost_ars
    );
  END IF;

  RETURN jsonb_build_object(
    'already_imported', false,
    'ventas', v_sales_count,
    'sale_ids', v_sales,
    'fee_ars', round(v_total_fee, 2),
    'shipping_cost_ars', v_order.seller_shipping_cost_ars
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.import_meli_order_as_sales(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_meli_order_as_sales(uuid, uuid, uuid)
  TO service_role;

-- Verificacion ZZ: ML informa $400 de envio para una orden de $2.000 + $6.000.
-- La base reparte $100/$300, ajusta ambas ganancias y no deja restos.
DO $verify$
DECLARE
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_user_id uuid;
  v_org_id uuid;
  v_product_a uuid;
  v_product_b uuid;
  v_order_id uuid;
  v_sale_a uuid;
  v_sale_b uuid;
  v_ship_a numeric;
  v_ship_b numeric;
  v_profit_a numeric;
  v_profit_b numeric;
  v_can_execute boolean;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'C7 shipping verification omitted: no auth user exists';
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ envío MercadoLibre', 'zz-meli-shipping-' || v_suffix, v_user_id)
  RETURNING id INTO v_org_id;
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'owner');
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, total_cost_usd)
  VALUES (v_org_id, v_user_id, 'ZZ ML envío A', 2000, 1)
  RETURNING id INTO v_product_a;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, total_cost_usd)
  VALUES (v_org_id, v_user_id, 'ZZ ML envío B', 6000, 2)
  RETURNING id INTO v_product_b;
  INSERT INTO public.meli_listings (org_id, product_id, meli_item_id)
  VALUES
    (v_org_id, v_product_a, 'MLAZZSHIP' || v_suffix || 'A'),
    (v_org_id, v_product_b, 'MLAZZSHIP' || v_suffix || 'B');

  INSERT INTO public.meli_orders (
    org_id, meli_order_id, status, buyer_nickname, total_ars, items,
    shipment_id, seller_shipping_cost_ars, date_created, raw
  ) VALUES (
    v_org_id, 800000000000 + floor(random() * 999999)::bigint, 'paid',
    'zz-comprador', 8000,
    jsonb_build_array(
      jsonb_build_object('item_id', 'MLAZZSHIP' || v_suffix || 'A', 'quantity', 1, 'unit_price', 2000, 'sale_fee', 100),
      jsonb_build_object('item_id', 'MLAZZSHIP' || v_suffix || 'B', 'quantity', 1, 'unit_price', 6000, 'sale_fee', 300)
    ),
    'ZZSHIP' || v_suffix, 400, now(), jsonb_build_object('origin', 'ZZ verification')
  ) RETURNING id INTO v_order_id;

  PERFORM public.import_meli_order_as_sales(v_org_id, v_order_id, v_user_id);

  SELECT l.sale_id, l.seller_shipping_cost_ars, s.profit_ars
    INTO v_sale_a, v_ship_a, v_profit_a
  FROM public.meli_order_sale_lines l
  JOIN public.sales s ON s.id = l.sale_id
  WHERE l.meli_order_id = v_order_id AND l.line_number = 1;
  SELECT l.sale_id, l.seller_shipping_cost_ars, s.profit_ars
    INTO v_sale_b, v_ship_b, v_profit_b
  FROM public.meli_order_sale_lines l
  JOIN public.sales s ON s.id = l.sale_id
  WHERE l.meli_order_id = v_order_id AND l.line_number = 2;

  IF v_ship_a <> 100 OR v_ship_b <> 300 OR v_profit_a <> 105 OR v_profit_b <> 2010 THEN
    RAISE EXCEPTION 'C7 shipping invalid: A ship/profit %,%; B ship/profit %,%',
      v_ship_a, v_profit_a, v_ship_b, v_profit_b;
  END IF;

  SELECT has_function_privilege(
    'authenticated',
    'public.apply_meli_shipping_cost(uuid,uuid,numeric)',
    'EXECUTE'
  ) INTO v_can_execute;
  IF v_can_execute THEN
    RAISE EXCEPTION 'C7 shipping RPC quedó ejecutable por authenticated';
  END IF;

  DELETE FROM public.meli_order_sale_lines WHERE meli_order_id = v_order_id;
  DELETE FROM public.payment_transactions WHERE org_id = v_org_id;
  DELETE FROM public.sales WHERE id IN (v_sale_a, v_sale_b);
  DELETE FROM public.meli_orders WHERE id = v_order_id;
  DELETE FROM public.organizations WHERE id = v_org_id;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.products WHERE id IN (v_product_a, v_product_b))
     OR EXISTS (SELECT 1 FROM public.meli_orders WHERE id = v_order_id)
     OR EXISTS (SELECT 1 FROM public.meli_order_sale_lines WHERE org_id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.sales WHERE id IN (v_sale_a, v_sale_b))
     OR EXISTS (SELECT 1 FROM public.payment_transactions WHERE org_id = v_org_id) THEN
    RAISE EXCEPTION 'C7 shipping dejó filas ZZ';
  END IF;

  RAISE NOTICE 'C7 shipping verificado: costo real prorrateado y restos ZZ 0';
END
$verify$;
