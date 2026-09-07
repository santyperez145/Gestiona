-- Verificación reversible del contrato de reposición automática.
-- La excepción NQ001 revierte la subtransacción de prueba antes de continuar,
-- por lo que ninguna orden, flujo ni evidencia sintética queda persistida.

DO $test$
DECLARE
  v_product record;
  v_flow_id uuid;
  v_first jsonb;
  v_replay jsonb;
  v_order_ids uuid[];
  v_orders integer;
  v_items integer;
  v_executions integer;
BEGIN
  SELECT product.id, product.org_id INTO v_product
  FROM public.products product
  ORDER BY product.created_at
  LIMIT 1;

  IF v_product.id IS NULL THEN
    RAISE NOTICE 'Verificación de reposición omitida: base sin productos';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  BEGIN
    INSERT INTO public.automation_flows(
      org_id, name, trigger_type, trigger_config, action_type, action_config, active
    ) VALUES (
      v_product.org_id, 'Verificación reversible', 'low_stock', '{}',
      'create_purchase_order', '{}', false
    ) RETURNING id INTO v_flow_id;

    v_first := public.create_automated_purchase_orders(
      v_product.org_id, v_flow_id, ARRAY[v_product.id], 3, DATE '2099-12-31'
    );
    v_replay := public.create_automated_purchase_orders(
      v_product.org_id, v_flow_id, ARRAY[v_product.id], 3, DATE '2099-12-31'
    );
    SELECT ARRAY(SELECT jsonb_array_elements_text(v_first->'order_ids')::uuid)
      INTO v_order_ids;

    SELECT count(*) INTO v_orders
    FROM public.purchase_orders WHERE id = ANY(v_order_ids);
    SELECT count(*) INTO v_items
    FROM public.purchase_order_items
    WHERE order_id = ANY(v_order_ids) AND quantity_ordered = 3;
    SELECT count(*) INTO v_executions
    FROM public.automation_action_executions WHERE flow_id = v_flow_id;

    IF COALESCE((v_first->>'replayed')::boolean, true)
       OR NOT COALESCE((v_replay->>'replayed')::boolean, false)
       OR v_orders < 1 OR v_items <> 1 OR v_executions <> 1 THEN
      RAISE EXCEPTION 'Falló el contrato atómico/idempotente de reposición';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'NQ001', MESSAGE = 'rollback verificación Nerqia';
  EXCEPTION WHEN SQLSTATE 'NQ001' THEN
    IF SQLERRM <> 'rollback verificación Nerqia' THEN RAISE; END IF;
    RAISE NOTICE 'Reposición verificada: orden+línea atómicas, replay sin duplicados, rollback OK';
  END;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    PERFORM public.create_automated_purchase_orders(
      v_product.org_id, gen_random_uuid(), ARRAY[v_product.id], 1, current_date
    );
    RAISE EXCEPTION 'El rol authenticated pudo ejecutar reposición privilegiada';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Reposición verificada: rol no privilegiado bloqueado';
  END;
END;
$test$;
