BEGIN;

-- Catalog labels are current metadata, never a replacement for historical money.
CREATE OR REPLACE VIEW public.sale_margin_dimensions WITH (security_barrier = true) AS
SELECT fact.*, variant.id AS variant_id,
  CASE WHEN variant.id IS NOT NULL THEN nullif(variant.sku, '')
    WHEN sale.variant_id IS NULL THEN nullif(product.sku, '') END AS sku,
  variant.variant_name,
  CASE WHEN variant.id IS NOT NULL OR (sale.variant_id IS NULL AND product.id IS NOT NULL)
    THEN 'current_catalog' ELSE 'unavailable' END AS sku_source,
  store.id AS store_id
FROM public.sale_margin_facts fact
JOIN public.sales sale ON sale.id = fact.sale_id AND sale.org_id = fact.org_id
LEFT JOIN public.products product ON product.id = fact.product_id AND product.org_id = fact.org_id
LEFT JOIN public.product_variants variant ON variant.id = sale.variant_id
  AND variant.product_id = fact.product_id AND variant.org_id = fact.org_id
LEFT JOIN public.ecommerce_orders customer_order ON fact.channel = 'tienda_online'
  AND customer_order.id = sale.ecommerce_order_id AND customer_order.org_id = fact.org_id
LEFT JOIN public.ecommerce_stores store ON store.id = customer_order.store_id AND store.org_id = fact.org_id
WHERE public.is_org_member(fact.org_id, auth.uid()) AND public.has_permission(fact.org_id, 'analytics', 'view');
REVOKE ALL ON public.sale_margin_dimensions FROM PUBLIC, anon;
GRANT SELECT ON public.sale_margin_dimensions TO authenticated;

CREATE OR REPLACE VIEW public.profit_store_options WITH (security_barrier = true) AS
SELECT store.org_id, store.id, store.name, store.is_active
FROM public.ecommerce_stores store
WHERE public.is_org_member(store.org_id, auth.uid()) AND public.has_permission(store.org_id, 'analytics', 'view');
REVOKE ALL ON public.profit_store_options FROM PUBLIC, anon;
GRANT SELECT ON public.profit_store_options TO authenticated;

-- The extended RPC keeps the released signature unambiguous for legacy callers.
CREATE OR REPLACE FUNCTION public.get_profit_period_dimensions(
  p_org_id uuid, p_from date, p_to date,
  p_product_page integer, p_operation_page integer, p_page_size integer, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $function$
DECLARE
  v_store uuid; v_channel text; v_group text; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_org_id IS NULL OR NOT public.is_org_member(p_org_id, auth.uid())
    OR NOT public.has_permission(p_org_id, 'analytics', 'view') THEN
    RAISE EXCEPTION 'No permission to read profitability' USING ERRCODE = '42501';
  END IF;
  IF p_filters IS NULL OR jsonb_typeof(p_filters) <> 'object' THEN
    RAISE EXCEPTION 'Invalid profit filters' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_filters) AS keys(key) WHERE key NOT IN ('storeId', 'channel', 'groupBy')) THEN
    RAISE EXCEPTION 'Unsupported profit filter' USING ERRCODE = '22023';
  END IF;
  BEGIN v_store := nullif(p_filters->>'storeId', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid store filter' USING ERRCODE = '22023';
  END;
  v_channel := nullif(p_filters->>'channel', '');
  v_group := coalesce(nullif(p_filters->>'groupBy', ''), 'product');
  IF (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to)
    OR p_product_page IS NULL OR p_product_page < 1 OR p_operation_page IS NULL OR p_operation_page < 1
    OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 OR v_group NOT IN ('product', 'sku')
    OR (v_channel IS NOT NULL AND v_channel NOT IN ('pos', 'tienda_online', 'mercadolibre', 'sin_atribuir'))
    OR (v_store IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profit_store_options WHERE org_id = p_org_id AND id = v_store)) THEN
    RAISE EXCEPTION 'Invalid period, store or channel' USING ERRCODE = '22023';
  END IF;

  WITH eligible_operations AS MATERIALIZED (
    SELECT operation.* FROM public.sale_margin_operations operation
    WHERE operation.org_id = p_org_id
      AND (p_from IS NULL OR operation.sold_at >= p_from::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AND (p_to IS NULL OR operation.sold_at < (p_to + 1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AND (v_channel IS NULL OR operation.channel = v_channel)
  ), dimensions AS MATERIALIZED (
    SELECT dimension.*, coalesce(dimension.product_id::text, 'line:' || dimension.sale_id::text) AS product_key,
      CASE WHEN v_group = 'sku' THEN dimension.variant_id END AS variant_key
    FROM public.sale_margin_dimensions dimension
    JOIN eligible_operations operation ON operation.operation_key = dimension.operation_key
      AND operation.org_id = dimension.org_id WHERE dimension.org_id = p_org_id
  ), period_operations AS MATERIALIZED (
    SELECT operation.* FROM eligible_operations operation
    WHERE v_store IS NULL OR EXISTS (SELECT 1 FROM dimensions d WHERE d.operation_key = operation.operation_key AND d.store_id = v_store)
  ), period_facts AS MATERIALIZED (
    SELECT d.* FROM dimensions d WHERE EXISTS (SELECT 1 FROM period_operations o WHERE o.operation_key = d.operation_key)
  ), product_rollup AS MATERIALIZED (
    SELECT fact.product_key AS "productId", fact.variant_key AS "variantId",
      coalesce(max(nullif(fact.product_name, '')), 'Producto sin nombre') AS "productName",
      CASE WHEN v_group = 'sku' THEN max(fact.sku) END AS sku,
      CASE WHEN v_group = 'sku' THEN max(fact.variant_name) END AS "variantName",
      CASE WHEN v_group = 'sku' AND bool_and(fact.sku_source = 'current_catalog') THEN 'current_catalog'
        WHEN v_group = 'sku' THEN 'unavailable' END AS "skuSource",
      coalesce(fact.channel, 'sin_atribuir') AS channel, count(*) AS lines, sum(fact.quantity) AS units,
      round(sum(fact.revenue_ars), 2) AS "revenueARS",
      CASE WHEN bool_and(fact.cogs_ars IS NOT NULL) THEN round(sum(fact.cogs_ars), 2) END AS "cogsARS",
      CASE WHEN bool_and(fact.payment_fee_ars IS NOT NULL) THEN round(sum(fact.payment_fee_ars), 2) END AS "paymentFeeARS",
      CASE WHEN bool_and(fact.shipping_cost_ars IS NOT NULL) THEN round(sum(fact.shipping_cost_ars), 2) END AS "shippingCostARS",
      CASE WHEN bool_and(fact.tax_ars IS NOT NULL) THEN round(sum(fact.tax_ars), 2) END AS "taxARS",
      CASE WHEN bool_and(fact.is_explainable AND fact.contribution_margin_ars IS NOT NULL)
        THEN round(sum(fact.contribution_margin_ars), 2) END AS "contributionMarginARS",
      round(avg(fact.coverage_pct), 1) AS "coveragePct"
    FROM period_facts fact GROUP BY fact.product_key, fact.variant_key, coalesce(fact.channel, 'sin_atribuir')
  ), counts AS (
    SELECT (SELECT count(*) FROM product_rollup) AS products, (SELECT count(*) FROM period_operations) AS operations
  ), pages AS (
    SELECT counts.*, least(p_product_page, greatest(1, ceil(products::numeric / p_page_size)::integer)) AS product_page,
      least(p_operation_page, greatest(1, ceil(operations::numeric / p_page_size)::integer)) AS operation_page FROM counts
  ), coverage AS (
    SELECT count(*) AS lines, count(*) FILTER (WHERE fact.is_explainable) AS "explainableLines",
      coalesce(round(sum(fact.revenue_ars), 2), 0) AS "revenueARS",
      coalesce(round(sum(fact.revenue_ars) FILTER (WHERE fact.is_explainable), 2), 0) AS "explainableRevenueARS",
      round(100 * coalesce(sum(fact.revenue_ars) FILTER (WHERE fact.is_explainable), 0) / nullif(sum(fact.revenue_ars), 0), 1) AS "explainableRevenuePct",
      round(avg(fact.coverage_pct), 1) AS "averageCoveragePct",
      count(*) FILTER (WHERE fact.cogs_ars IS NOT NULL) AS "cogsKnownLines",
      count(*) FILTER (WHERE fact.payment_fee_ars IS NOT NULL) AS "paymentFeeKnownLines",
      count(*) FILTER (WHERE fact.shipping_cost_ars IS NOT NULL) AS "shippingKnownLines",
      count(*) FILTER (WHERE fact.tax_ars IS NOT NULL) AS "taxKnownLines",
      round(sum(fact.contribution_margin_ars) FILTER (WHERE fact.is_explainable), 2) AS "measuredContributionARS",
      CASE WHEN bool_and(fact.is_explainable AND fact.contribution_margin_ars IS NOT NULL)
        THEN round(sum(fact.contribution_margin_ars), 2) END AS "contributionMarginARS" FROM period_facts fact
  ), product_page AS (
    SELECT rollup.*, ARRAY(SELECT DISTINCT gap FROM period_facts fact
      CROSS JOIN LATERAL unnest(coalesce(fact.missing_components, ARRAY[]::text[]) || coalesce(fact.margin_blockers, ARRAY[]::text[])) gap
      WHERE fact.product_key = rollup."productId" AND fact.variant_key IS NOT DISTINCT FROM rollup."variantId"
        AND coalesce(fact.channel, 'sin_atribuir') = rollup.channel ORDER BY gap) AS "pendingCodes"
    FROM product_rollup rollup ORDER BY "revenueARS" DESC, "productName", "productId", "variantId" NULLS FIRST, channel
    LIMIT p_page_size OFFSET ((SELECT product_page FROM pages) - 1)::bigint * p_page_size
  ), operation_page AS (
    SELECT operation.* FROM period_operations operation ORDER BY sold_at DESC NULLS LAST, operation_key
    LIMIT p_page_size OFFSET ((SELECT operation_page FROM pages) - 1)::bigint * p_page_size
  )
  SELECT jsonb_build_object('version', 1, 'currency', 'ARS', 'timeZone', 'America/Argentina/Buenos_Aires',
    'from', p_from, 'to', p_to, 'pageSize', p_page_size, 'productCount', pages.products, 'operationCount', pages.operations,
    'productPage', pages.product_page, 'operationPage', pages.operation_page,
    'filters', jsonb_build_object('storeId', v_store, 'channel', v_channel, 'groupBy', v_group),
    'stores', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'active', is_active) ORDER BY name, id)
      FROM public.profit_store_options WHERE org_id = p_org_id), '[]'::jsonb),
    'coverage', (SELECT to_jsonb(coverage) FROM coverage),
    'products', coalesce((SELECT jsonb_agg(to_jsonb(detail) ORDER BY detail."revenueARS" DESC, detail."productName", detail."productId", detail."variantId" NULLS FIRST, detail.channel)
      FROM product_page detail), '[]'::jsonb),
    'operations', coalesce((SELECT jsonb_agg(to_jsonb(detail) ORDER BY detail.sold_at DESC NULLS LAST, detail.operation_key)
      FROM operation_page detail), '[]'::jsonb)) INTO v_result FROM pages;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_profit_period_dimensions(uuid,date,date,integer,integer,integer,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profit_period_dimensions(uuid,date,date,integer,integer,integer,jsonb) TO authenticated;

-- One authority; old tabs/clients use the same implementation with no filters.
CREATE OR REPLACE FUNCTION public.get_profit_period(
  p_org_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL,
  p_product_page integer DEFAULT 1, p_operation_page integer DEFAULT 1, p_page_size integer DEFAULT 25
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $function$
  SELECT public.get_profit_period_dimensions(p_org_id, p_from, p_to, p_product_page, p_operation_page, p_page_size, '{}'::jsonb);
$function$;
REVOKE ALL ON FUNCTION public.get_profit_period(uuid,date,date,integer,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profit_period(uuid,date,date,integer,integer,integer) TO authenticated;

-- Retire only the unpublished staging overload; no released client uses it.
DROP FUNCTION IF EXISTS public.get_profit_period(uuid,date,date,integer,integer,integer,jsonb);

NOTIFY pgrst, 'reload schema';
COMMIT;
