-- C8 / Recepción de órdenes de compra: el RPC escribe purchases (y el trigger
-- mueve el stock), por lo que no puede quedar más abierto que las tablas que
-- modifica. También serializa por orden: dos entregas simultáneas no pueden
-- leer el mismo pendiente y registrar mercadería de más.

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_order_id    uuid,
  p_items       jsonb,
  p_notes       text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_org         uuid;
  v_user        uuid := auth.uid();
  v_currency    text;
  v_supplier    text;
  v_supplier_id uuid;
  v_status      text;
  v_rate        numeric;
  v_item        jsonb;
  v_it          record;
  v_qty         numeric;
  v_pendiente   numeric;
  v_cost_usd    numeric;
  v_purchase    uuid;
  v_recibidos   int := 0;
  v_estado      text;
BEGIN
  -- Este lock es la autoridad de concurrencia de una recepción: cualquier
  -- segundo llamado de la misma OC espera y vuelve a ver quantity_received.
  SELECT po.org_id, po.currency, po.supplier_name, po.supplier_id, po.status
    INTO v_org, v_currency, v_supplier, v_supplier_id, v_status
    FROM public.purchase_orders po
   WHERE po.id = p_order_id
   FOR UPDATE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'La orden de compra no existe' USING ERRCODE = 'no_data_found';
  END IF;

  -- SECURITY DEFINER elude RLS. Se exige exactamente el mismo rol que las
  -- policies de purchase_orders, purchase_order_items y purchases; un viewer
  -- no puede convertir una orden en stock ni registrar costo.
  IF NOT public.has_org_role(v_org, v_user, ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'No tenés permiso para recibir mercadería de esta orden'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- No se recibe una intención ni una OC cancelada. La UI ya guía este flujo,
  -- pero la regla vive acá porque un llamado RPC no pasa por la pantalla.
  IF v_status NOT IN ('confirmed', 'partially_received') THEN
    RAISE EXCEPTION 'La orden debe estar confirmada para recibir mercadería'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Una sucursal de otra organización sería una fuga entre tenants.
  IF p_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations l
     WHERE l.id = p_location_id AND l.org_id = v_org
  ) THEN
    RAISE EXCEPTION 'La sucursal no pertenece a esta organización'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No se indicó qué recibir' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT NULLIF(s.exchange_rate, 0) INTO v_rate
    FROM public.settings s WHERE s.org_id = v_org LIMIT 1;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    -- El lock del renglón cubre el caso de IDs duplicados en el mismo payload
    -- y documenta que quantity_received es una cuenta transaccional, no una
    -- decisión del navegador.
    SELECT i.* INTO v_it
      FROM public.purchase_order_items i
     WHERE i.id = (v_item->>'item_id')::uuid
       AND i.order_id = p_order_id
     FOR UPDATE;

    IF v_it.id IS NULL THEN
      RAISE EXCEPTION 'El renglón % no pertenece a esta orden', v_item->>'item_id'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_pendiente := v_it.quantity_ordered - COALESCE(v_it.quantity_received, 0);
    IF v_qty > v_pendiente THEN
      RAISE EXCEPTION 'De "%" faltan % unidades y se quieren recibir %',
        v_it.product_name, v_pendiente, v_qty USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_cost_usd := CASE
      WHEN upper(COALESCE(v_currency, 'USD')) = 'ARS' AND v_rate IS NOT NULL
        THEN v_it.unit_cost / v_rate
      ELSE v_it.unit_cost
    END;

    -- El INSERT dispara trg_purchase_stock_movement; ningún cliente ni esta
    -- función escribe products.stock o location_stock por separado.
    INSERT INTO public.purchases (
      org_id, user_id, product_id, product_name, quantity,
      unit_cost_usd, customs_fee, total_usd, exchange_rate, total_ars,
      date, supplier, supplier_id, location_id
    ) VALUES (
      v_org, v_user, v_it.product_id, v_it.product_name, v_qty::int,
      v_cost_usd, 0, v_cost_usd * v_qty, COALESCE(v_rate, 0),
      CASE WHEN v_rate IS NULL THEN 0 ELSE v_cost_usd * v_qty * v_rate END,
      now(), v_supplier, v_supplier_id, p_location_id
    ) RETURNING id INTO v_purchase;

    INSERT INTO public.purchase_order_receipts (
      org_id, order_id, order_item_id, purchase_id, quantity, received_by, notes
    ) VALUES (v_org, p_order_id, v_it.id, v_purchase, v_qty, v_user, p_notes);

    UPDATE public.purchase_order_items
       SET quantity_received = COALESCE(quantity_received, 0) + v_qty
     WHERE id = v_it.id;

    v_recibidos := v_recibidos + 1;
  END LOOP;

  IF v_recibidos = 0 THEN
    RAISE EXCEPTION 'No se recibió ningún renglón' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT CASE
           WHEN bool_and(COALESCE(quantity_received, 0) >= quantity_ordered) THEN 'received'
           ELSE 'partially_received'
         END
    INTO v_estado
    FROM public.purchase_order_items
   WHERE order_id = p_order_id;

  UPDATE public.purchase_orders
     SET status = v_estado,
         received_date = CASE WHEN v_estado = 'received' THEN current_date ELSE received_date END,
         updated_at = now()
   WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'status', v_estado,
    'renglones_recibidos', v_recibidos,
    'pendientes', (
      SELECT COALESCE(sum(quantity_ordered - COALESCE(quantity_received, 0)), 0)
        FROM public.purchase_order_items WHERE order_id = p_order_id
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, jsonb, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, jsonb, text, uuid)
  TO authenticated;

-- Verificación contra la base: un no-miembro queda fuera, el owner recibe una
-- entrega parcial y la segunda completa sin que se duplique el movimiento.
-- La sesión emula el JWT real y se borra el org ZZ entero antes de terminar.
DO $verify$
DECLARE
  v_owner_id uuid;
  v_org_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_item_id uuid;
  v_stock numeric;
  v_received numeric;
  v_status text;
  v_denied boolean := false;
  v_anon_can_execute boolean;
BEGIN
  SELECT id INTO v_owner_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_owner_id IS NULL THEN
    RAISE NOTICE 'Purchase receipt verification omitted: no auth user exists';
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_user_id)
  VALUES ('ZZ autoridad recepción OC', 'zz-po-receipt-' || substr(gen_random_uuid()::text, 1, 8), v_owner_id)
  RETURNING id INTO v_org_id;
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org_id, v_owner_id, 'owner');
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, total_cost_usd, stock)
  VALUES (v_org_id, v_owner_id, 'ZZ producto recepción', 100, 5, 0)
  RETURNING id INTO v_product_id;
  INSERT INTO public.purchase_orders (
    org_id, order_number, supplier_name, status, currency, total_amount
  ) VALUES (
    v_org_id, 'ZZ-PO-' || substr(gen_random_uuid()::text, 1, 8), 'ZZ proveedor', 'confirmed', 'USD', 50
  ) RETURNING id INTO v_order_id;
  INSERT INTO public.purchase_order_items (
    org_id, order_id, product_id, product_name, quantity_ordered, quantity_received, unit_cost, total_cost
  ) VALUES (
    v_org_id, v_order_id, v_product_id, 'ZZ producto recepción', 5, 0, 10, 50
  ) RETURNING id INTO v_item_id;

  -- Un JWT ajeno no puede eludir las policies por ser una función DEFINER.
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.receive_purchase_order(
      v_order_id, jsonb_build_array(jsonb_build_object('item_id', v_item_id, 'quantity', 1))
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN
    RAISE EXCEPTION 'Un JWT ajeno pudo recibir una orden de compra';
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner_id::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.receive_purchase_order(
    v_order_id, jsonb_build_array(jsonb_build_object('item_id', v_item_id, 'quantity', 2)), 'ZZ parcial'
  );
  EXECUTE 'RESET ROLE';

  SELECT quantity_received INTO v_received FROM public.purchase_order_items WHERE id = v_item_id;
  SELECT stock INTO v_stock FROM public.products WHERE id = v_product_id;
  SELECT status INTO v_status FROM public.purchase_orders WHERE id = v_order_id;
  IF v_received <> 2 OR v_stock <> 2 OR v_status <> 'partially_received' THEN
    RAISE EXCEPTION 'La recepción parcial no quedó consistente: recibido %, stock %, estado %',
      v_received, v_stock, v_status;
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner_id::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.receive_purchase_order(
    v_order_id, jsonb_build_array(jsonb_build_object('item_id', v_item_id, 'quantity', 3)), 'ZZ final'
  );
  EXECUTE 'RESET ROLE';

  SELECT quantity_received INTO v_received FROM public.purchase_order_items WHERE id = v_item_id;
  SELECT stock INTO v_stock FROM public.products WHERE id = v_product_id;
  SELECT status INTO v_status FROM public.purchase_orders WHERE id = v_order_id;
  SELECT has_function_privilege(
    'anon', 'public.receive_purchase_order(uuid, jsonb, text, uuid)', 'EXECUTE'
  ) INTO v_anon_can_execute;
  IF v_received <> 5 OR v_stock <> 5 OR v_status <> 'received' OR v_anon_can_execute THEN
    RAISE EXCEPTION 'La recepción final o los permisos no quedaron consistentes: recibido %, stock %, estado %, anon %',
      v_received, v_stock, v_status, v_anon_can_execute;
  END IF;

  -- Borrar purchases primero revierte su asiento por trigger; el CASCADE del
  -- org limpia órdenes, renglones, recibos y Kardex ZZ.
  DELETE FROM public.purchases WHERE org_id = v_org_id;
  DELETE FROM public.organizations WHERE id = v_org_id;

  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.purchase_orders WHERE id = v_order_id)
     OR EXISTS (SELECT 1 FROM public.purchase_order_receipts WHERE org_id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.purchases WHERE org_id = v_org_id)
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE org_id = v_org_id) THEN
    RAISE EXCEPTION 'Purchase receipt authority dejó filas ZZ';
  END IF;

  RAISE NOTICE 'Purchase receipt authority verified: roles, parcial, total y restos ZZ 0';
END
$verify$;
