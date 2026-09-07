-- Automatizaciones operativas: ejecución idempotente y trazable de reposición.
-- El motor Edge decide qué productos cumplen la regla; PostgreSQL materializa
-- todas las órdenes y sus líneas en una sola transacción. Un reintento del mismo
-- flujo/día devuelve el resultado previo en vez de duplicar compras.

CREATE TABLE IF NOT EXISTS public.automation_action_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  idempotency_key text NOT NULL,
  resource_type text,
  resource_ids uuid[] NOT NULL DEFAULT '{}',
  result jsonb NOT NULL DEFAULT '{}',
  executed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_action_executions_idempotency_uq
    UNIQUE (org_id, flow_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS automation_action_executions_org_recent_idx
  ON public.automation_action_executions(org_id, executed_at DESC);

ALTER TABLE public.automation_action_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.automation_action_executions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.automation_action_executions TO service_role;

CREATE OR REPLACE FUNCTION public.create_automated_purchase_orders(
  p_org_id uuid,
  p_flow_id uuid,
  p_product_ids uuid[],
  p_quantity numeric,
  p_run_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_execution_id uuid;
  v_existing_result jsonb;
  v_flow_name text;
  v_requested_count integer;
  v_found_count integer;
  v_group record;
  v_order_id uuid;
  v_order_ids uuid[] := '{}';
  v_order_number text;
  v_subtotal numeric(14,2);
  v_tax_amount numeric(14,2);
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Esta operación sólo puede ejecutarse desde el motor de automatizaciones'
      USING ERRCODE = '42501';
  END IF;

  IF p_org_id IS NULL OR p_flow_id IS NULL OR p_run_date IS NULL THEN
    RAISE EXCEPTION 'Faltan datos de la automatización' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity <> trunc(p_quantity)
     OR p_quantity > 100000 THEN
    RAISE EXCEPTION 'La cantidad de reposición debe ser un entero entre 1 y 100000'
      USING ERRCODE = '22023';
  END IF;

  SELECT flow.name INTO v_flow_name
  FROM public.automation_flows flow
  WHERE flow.id = p_flow_id
    AND flow.org_id = p_org_id
    AND flow.action_type = 'create_purchase_order';
  IF v_flow_name IS NULL THEN
    RAISE EXCEPTION 'La automatización de reposición no está disponible'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_requested_count
  FROM (SELECT DISTINCT unnest(COALESCE(p_product_ids, '{}')) AS id) requested;
  IF v_requested_count = 0 OR v_requested_count > 200 THEN
    RAISE EXCEPTION 'La reposición debe incluir entre 1 y 200 productos'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_found_count
  FROM public.products product
  WHERE product.org_id = p_org_id
    AND product.id = ANY(p_product_ids);
  IF v_found_count <> v_requested_count THEN
    RAISE EXCEPTION 'Uno o más productos no pertenecen a la organización'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.automation_action_executions(
    org_id, flow_id, action_type, idempotency_key, resource_type
  ) VALUES (
    p_org_id, p_flow_id, 'create_purchase_order',
    'purchase-order:' || p_run_date::text, 'purchase_order'
  )
  ON CONFLICT (org_id, flow_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_execution_id;

  IF v_execution_id IS NULL THEN
    SELECT execution.result INTO v_existing_result
    FROM public.automation_action_executions execution
    WHERE execution.org_id = p_org_id
      AND execution.flow_id = p_flow_id
      AND execution.idempotency_key = 'purchase-order:' || p_run_date::text;
    RETURN COALESCE(v_existing_result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  END IF;

  FOR v_group IN
    SELECT
      supplier.id AS supplier_id,
      COALESCE(supplier.name, 'Proveedor por definir') AS supplier_name,
      supplier.email AS supplier_email,
      CASE
        WHEN upper(COALESCE(NULLIF(trim(product.cost_currency), ''),
          CASE WHEN COALESCE(product.cost_ars, 0) > 0 THEN 'ARS' ELSE 'USD' END)) = 'ARS'
        THEN 'ARS' ELSE 'USD'
      END AS currency
    FROM public.products product
    LEFT JOIN public.suppliers supplier
      ON supplier.id = product.supplier_id AND supplier.org_id = product.org_id
    WHERE product.org_id = p_org_id AND product.id = ANY(p_product_ids)
    GROUP BY supplier.id, supplier.name, supplier.email,
      CASE
        WHEN upper(COALESCE(NULLIF(trim(product.cost_currency), ''),
          CASE WHEN COALESCE(product.cost_ars, 0) > 0 THEN 'ARS' ELSE 'USD' END)) = 'ARS'
        THEN 'ARS' ELSE 'USD'
      END
  LOOP
    SELECT
      round(sum(p_quantity * CASE WHEN v_group.currency = 'ARS'
        THEN COALESCE(product.cost_ars, 0)
        ELSE COALESCE(NULLIF(product.total_cost_usd, 0), product.cost_usd, 0) END), 2),
      round(sum(p_quantity * CASE WHEN v_group.currency = 'ARS'
        THEN COALESCE(product.cost_ars, 0)
        ELSE COALESCE(NULLIF(product.total_cost_usd, 0), product.cost_usd, 0) END
        * COALESCE(product.tax_rate, 0) / 100), 2)
    INTO v_subtotal, v_tax_amount
    FROM public.products product
    LEFT JOIN public.suppliers supplier
      ON supplier.id = product.supplier_id AND supplier.org_id = product.org_id
    WHERE product.org_id = p_org_id
      AND product.id = ANY(p_product_ids)
      AND supplier.id IS NOT DISTINCT FROM v_group.supplier_id
      AND (CASE
        WHEN upper(COALESCE(NULLIF(trim(product.cost_currency), ''),
          CASE WHEN COALESCE(product.cost_ars, 0) > 0 THEN 'ARS' ELSE 'USD' END)) = 'ARS'
        THEN 'ARS' ELSE 'USD'
      END) = v_group.currency;

    v_order_number := public.generate_po_number(p_org_id);
    INSERT INTO public.purchase_orders(
      org_id, order_number, supplier_id, supplier_name, supplier_email,
      status, currency, subtotal, tax_amount, total_amount, internal_notes
    ) VALUES (
      p_org_id, v_order_number, v_group.supplier_id, v_group.supplier_name,
      v_group.supplier_email, 'draft', v_group.currency, v_subtotal,
      v_tax_amount, v_subtotal + v_tax_amount,
      'Borrador creado por automatización: ' || v_flow_name || '. Revisar antes de enviar.'
    ) RETURNING id INTO v_order_id;

    INSERT INTO public.purchase_order_items(
      order_id, org_id, product_id, product_name, sku, quantity_ordered,
      quantity_received, unit_cost, tax_rate, total_cost
    )
    SELECT
      v_order_id, p_org_id, product.id, product.name, product.sku, p_quantity,
      0,
      CASE WHEN v_group.currency = 'ARS'
        THEN COALESCE(product.cost_ars, 0)
        ELSE COALESCE(NULLIF(product.total_cost_usd, 0), product.cost_usd, 0) END,
      COALESCE(product.tax_rate, 0),
      round(p_quantity * CASE WHEN v_group.currency = 'ARS'
        THEN COALESCE(product.cost_ars, 0)
        ELSE COALESCE(NULLIF(product.total_cost_usd, 0), product.cost_usd, 0) END, 2)
    FROM public.products product
    LEFT JOIN public.suppliers supplier
      ON supplier.id = product.supplier_id AND supplier.org_id = product.org_id
    WHERE product.org_id = p_org_id
      AND product.id = ANY(p_product_ids)
      AND supplier.id IS NOT DISTINCT FROM v_group.supplier_id
      AND (CASE
        WHEN upper(COALESCE(NULLIF(trim(product.cost_currency), ''),
          CASE WHEN COALESCE(product.cost_ars, 0) > 0 THEN 'ARS' ELSE 'USD' END)) = 'ARS'
        THEN 'ARS' ELSE 'USD'
      END) = v_group.currency;

    v_order_ids := array_append(v_order_ids, v_order_id);
  END LOOP;

  v_result := jsonb_build_object(
    'order_ids', to_jsonb(v_order_ids),
    'orders_created', cardinality(v_order_ids),
    'products_included', v_requested_count,
    'replayed', false
  );
  UPDATE public.automation_action_executions
  SET resource_ids = v_order_ids, result = v_result
  WHERE id = v_execution_id;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_automated_purchase_orders(uuid, uuid, uuid[], numeric, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_automated_purchase_orders(uuid, uuid, uuid[], numeric, date)
  TO service_role;
