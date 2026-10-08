BEGIN;

CREATE OR REPLACE VIEW public.sale_margin_facts
WITH (security_barrier = true) AS
SELECT effective.*
FROM public._sale_margin_facts_effective effective
WHERE public.is_org_member(effective.org_id, auth.uid())
  AND public.has_permission(effective.org_id, 'analytics', 'view');

CREATE OR REPLACE VIEW public.sale_margin_operations
WITH (security_barrier = true) AS
SELECT operation.*
FROM public._sale_margin_operations_effective operation
WHERE public.is_org_member(operation.org_id, auth.uid())
  AND public.has_permission(operation.org_id, 'analytics', 'view');

REVOKE ALL ON public.sale_margin_facts, public.sale_margin_operations FROM PUBLIC, anon;
GRANT SELECT ON public.sale_margin_facts, public.sale_margin_operations TO authenticated;

-- One statement/snapshot: total population and paged detail cannot disagree
-- because PostgREST truncated the rows. Never recalculate historical costs.
CREATE OR REPLACE FUNCTION public.get_profit_period(
  p_org_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_product_page integer DEFAULT 1,
  p_operation_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_org_id IS NULL
    OR NOT public.is_org_member(p_org_id, auth.uid())
    OR NOT public.has_permission(p_org_id, 'analytics', 'view') THEN
    RAISE EXCEPTION 'No permission to read profitability' USING ERRCODE = '42501';
  END IF;
  IF (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to)
    OR p_product_page IS NULL OR p_product_page < 1
    OR p_operation_page IS NULL OR p_operation_page < 1
    OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid period or pagination' USING ERRCODE = '22023';
  END IF;

  WITH period_operations AS MATERIALIZED (
    SELECT operation.*
    FROM public.sale_margin_operations operation
    WHERE operation.org_id = p_org_id
      AND (p_from IS NULL OR operation.sold_at >=
        p_from::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AND (p_to IS NULL OR operation.sold_at <
        (p_to + 1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
  ), period_facts AS MATERIALIZED (
    -- Include every line of the selected operation, even across midnight.
    SELECT fact.*, coalesce(fact.product_id::text, 'line:' || fact.sale_id::text) AS product_key
    FROM public.sale_margin_facts fact
    WHERE fact.org_id = p_org_id
      AND EXISTS (SELECT 1 FROM period_operations operation
        WHERE operation.operation_key = fact.operation_key)
  ), product_rollup AS MATERIALIZED (
    SELECT fact.product_key AS "productId",
      coalesce(max(nullif(fact.product_name, '')), 'Producto sin nombre') AS "productName",
      coalesce(fact.channel, 'sin_atribuir') AS channel,
      count(*) AS lines, sum(fact.quantity) AS units,
      round(sum(fact.revenue_ars), 2) AS "revenueARS",
      CASE WHEN bool_and(fact.cogs_ars IS NOT NULL) THEN round(sum(fact.cogs_ars), 2) END AS "cogsARS",
      CASE WHEN bool_and(fact.payment_fee_ars IS NOT NULL) THEN round(sum(fact.payment_fee_ars), 2) END AS "paymentFeeARS",
      CASE WHEN bool_and(fact.shipping_cost_ars IS NOT NULL) THEN round(sum(fact.shipping_cost_ars), 2) END AS "shippingCostARS",
      CASE WHEN bool_and(fact.tax_ars IS NOT NULL) THEN round(sum(fact.tax_ars), 2) END AS "taxARS",
      CASE WHEN bool_and(fact.is_explainable AND fact.contribution_margin_ars IS NOT NULL)
        THEN round(sum(fact.contribution_margin_ars), 2) END AS "contributionMarginARS",
      round(avg(fact.coverage_pct), 1) AS "coveragePct"
    FROM period_facts fact
    GROUP BY fact.product_key, coalesce(fact.channel, 'sin_atribuir')
  ), counts AS (
    SELECT (SELECT count(*) FROM product_rollup) AS products,
      (SELECT count(*) FROM period_operations) AS operations
  ), pages AS (
    SELECT counts.*,
      least(p_product_page, greatest(1, ceil(products::numeric / p_page_size)::integer)) AS product_page,
      least(p_operation_page, greatest(1, ceil(operations::numeric / p_page_size)::integer)) AS operation_page
    FROM counts
  ), coverage AS (
    SELECT count(*) AS lines,
      count(*) FILTER (WHERE fact.is_explainable) AS "explainableLines",
      coalesce(round(sum(fact.revenue_ars), 2), 0) AS "revenueARS",
      coalesce(round(sum(fact.revenue_ars) FILTER (WHERE fact.is_explainable), 2), 0) AS "explainableRevenueARS",
      round(100 * coalesce(sum(fact.revenue_ars) FILTER (WHERE fact.is_explainable), 0)
        / nullif(sum(fact.revenue_ars), 0), 1) AS "explainableRevenuePct",
      round(avg(fact.coverage_pct), 1) AS "averageCoveragePct",
      count(*) FILTER (WHERE fact.cogs_ars IS NOT NULL) AS "cogsKnownLines",
      count(*) FILTER (WHERE fact.payment_fee_ars IS NOT NULL) AS "paymentFeeKnownLines",
      count(*) FILTER (WHERE fact.shipping_cost_ars IS NOT NULL) AS "shippingKnownLines",
      count(*) FILTER (WHERE fact.tax_ars IS NOT NULL) AS "taxKnownLines",
      round(sum(fact.contribution_margin_ars) FILTER (WHERE fact.is_explainable), 2) AS "measuredContributionARS",
      CASE WHEN bool_and(fact.is_explainable AND fact.contribution_margin_ars IS NOT NULL)
        THEN round(sum(fact.contribution_margin_ars), 2) END AS "contributionMarginARS"
    FROM period_facts fact
  ), product_page AS (
    SELECT rollup.*,
      ARRAY(SELECT DISTINCT gap FROM period_facts fact
        CROSS JOIN LATERAL unnest(coalesce(fact.missing_components, ARRAY[]::text[])
          || coalesce(fact.margin_blockers, ARRAY[]::text[])) gap
        WHERE fact.product_key = rollup."productId"
          AND coalesce(fact.channel, 'sin_atribuir') = rollup.channel
        ORDER BY gap) AS "pendingCodes"
    FROM product_rollup rollup
    ORDER BY "revenueARS" DESC, "productName", "productId", channel
    LIMIT p_page_size OFFSET ((SELECT product_page FROM pages) - 1)::bigint * p_page_size
  ), operation_page AS (
    SELECT operation.* FROM period_operations operation
    ORDER BY sold_at DESC NULLS LAST, operation_key
    LIMIT p_page_size OFFSET ((SELECT operation_page FROM pages) - 1)::bigint * p_page_size
  )
  SELECT jsonb_build_object(
    'version', 1, 'currency', 'ARS', 'timeZone', 'America/Argentina/Buenos_Aires',
    'from', p_from, 'to', p_to, 'pageSize', p_page_size,
    'productCount', pages.products, 'operationCount', pages.operations,
    'productPage', pages.product_page, 'operationPage', pages.operation_page,
    'coverage', (SELECT to_jsonb(coverage) FROM coverage),
    'products', coalesce((SELECT jsonb_agg(to_jsonb(detail)
      ORDER BY detail."revenueARS" DESC, detail."productName", detail."productId", detail.channel) FROM product_page detail), '[]'::jsonb),
    'operations', coalesce((SELECT jsonb_agg(to_jsonb(detail)
      ORDER BY detail.sold_at DESC NULLS LAST, detail.operation_key) FROM operation_page detail), '[]'::jsonb)
  ) INTO v_result FROM pages;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_profit_period(uuid, date, date, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profit_period(uuid, date, date, integer, integer, integer) TO authenticated;
COMMENT ON FUNCTION public.get_profit_period(uuid, date, date, integer, integer, integer) IS
  'Profit Foundation: canonical measured contribution, complete period population, paged products/operations, analytics permission; ARS, Buenos Aires operation date; no Ads or net-profit claim.';

NOTIFY pgrst, 'reload schema';
COMMIT;
