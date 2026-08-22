-- F2 / explicación por operación, cobro y promoción.
--
-- La vista por línea ya responde cuánto se sabe. Este slice responde cómo se
-- compone un ticket completo sin sumar dos veces un descuento ni fingir que
-- conocemos la base histórica de una promoción. También evita declarar margen
-- final cuando hubo una devolución cuyo neto aún no está reconciliado.

CREATE OR REPLACE VIEW public._sale_margin_facts_effective
WITH (security_barrier = true)
AS
SELECT
  source.sale_id,
  source.org_id,
  source.product_id,
  source.product_name,
  source.quantity,
  source.sold_at,
  source.recorded_source,
  source.channel,
  source.operation_type,
  source.operation_id,
  source.operation_key,
  source.revenue_ars,
  source.cogs_ars,
  source.cogs_source,
  source.payment_fee_ars,
  source.payment_fee_source,
  source.shipping_cost_ars,
  source.shipping_cost_source,
  source.tax_ars,
  source.tax_source,
  source.gross_margin_ars,
  CASE
    WHEN source.returned OR source.returned_quantity > 0 THEN NULL
    ELSE source.contribution_margin_ars
  END AS contribution_margin_ars,
  source.known_components,
  source.coverage_pct,
  source.missing_components,
  source.is_explainable
    AND NOT source.returned
    AND source.returned_quantity = 0 AS is_explainable,
  CASE
    WHEN source.returned OR source.returned_quantity > 0 THEN 'return_pending'
    ELSE source.quality_status
  END AS quality_status,
  source.returned,
  source.returned_quantity,
  CASE
    WHEN source.returned OR source.returned_quantity > 0
      THEN ARRAY['devolucion_neta']::text[]
    ELSE ARRAY[]::text[]
  END AS margin_blockers
FROM public._sale_margin_facts_source source;

REVOKE ALL ON TABLE public._sale_margin_facts_effective FROM PUBLIC, anon, authenticated;

-- Mantiene las columnas anteriores en el mismo orden y agrega blockers al
-- final. Las dependencias existentes continúan usando el mismo contrato.
CREATE OR REPLACE VIEW public.sale_margin_facts
WITH (security_barrier = true)
AS
SELECT effective.*
FROM public._sale_margin_facts_effective effective
WHERE public.is_org_member(effective.org_id, auth.uid());

REVOKE ALL ON TABLE public.sale_margin_facts FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.sale_margin_facts TO authenticated;

CREATE OR REPLACE VIEW public.organization_margin_coverage
WITH (security_invoker = true)
AS
SELECT
  facts.org_id,
  count(*)::bigint AS sales_lines,
  count(DISTINCT facts.operation_key)::bigint AS operations,
  round(sum(facts.revenue_ars), 2) AS revenue_ars,
  count(*) FILTER (WHERE facts.cogs_ars IS NOT NULL)::bigint AS cogs_known_lines,
  count(*) FILTER (WHERE facts.payment_fee_ars IS NOT NULL)::bigint AS payment_fee_known_lines,
  count(*) FILTER (WHERE facts.shipping_cost_ars IS NOT NULL)::bigint AS shipping_known_lines,
  count(*) FILTER (WHERE facts.tax_ars IS NOT NULL)::bigint AS tax_known_lines,
  count(*) FILTER (WHERE facts.is_explainable)::bigint AS explainable_lines,
  round(coalesce(sum(facts.revenue_ars) FILTER (WHERE facts.is_explainable), 0), 2) AS explainable_revenue_ars,
  round(
    100 * coalesce(sum(facts.revenue_ars) FILTER (WHERE facts.is_explainable), 0)
    / nullif(sum(facts.revenue_ars), 0),
    1
  ) AS explainable_revenue_pct,
  round(avg(facts.coverage_pct), 1) AS average_coverage_pct,
  round(sum(facts.contribution_margin_ars) FILTER (WHERE facts.is_explainable), 2) AS measured_contribution_margin_ars
FROM public.sale_margin_facts facts
GROUP BY facts.org_id;

REVOKE ALL ON TABLE public.organization_margin_coverage FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.organization_margin_coverage TO authenticated;

CREATE OR REPLACE VIEW public.platform_org_margin_coverage
WITH (security_barrier = true)
AS
SELECT
  organization.id AS org_id,
  count(facts.sale_id)::bigint AS sales_lines,
  count(DISTINCT facts.operation_key)::bigint AS operations,
  round(coalesce(sum(facts.revenue_ars), 0), 2) AS revenue_ars,
  count(facts.sale_id) FILTER (WHERE facts.cogs_ars IS NOT NULL)::bigint AS cogs_known_lines,
  count(facts.sale_id) FILTER (WHERE facts.payment_fee_ars IS NOT NULL)::bigint AS payment_fee_known_lines,
  count(facts.sale_id) FILTER (WHERE facts.shipping_cost_ars IS NOT NULL)::bigint AS shipping_known_lines,
  count(facts.sale_id) FILTER (WHERE facts.tax_ars IS NOT NULL)::bigint AS tax_known_lines,
  count(facts.sale_id) FILTER (WHERE facts.is_explainable)::bigint AS explainable_lines,
  round(coalesce(sum(facts.revenue_ars) FILTER (WHERE facts.is_explainable), 0), 2) AS explainable_revenue_ars,
  CASE WHEN coalesce(sum(facts.revenue_ars), 0) > 0 THEN round(
    100 * coalesce(sum(facts.revenue_ars) FILTER (WHERE facts.is_explainable), 0)
    / sum(facts.revenue_ars),
    1
  ) END AS explainable_revenue_pct,
  round(avg(facts.coverage_pct), 1) AS average_coverage_pct,
  round(sum(facts.contribution_margin_ars) FILTER (WHERE facts.is_explainable), 2) AS measured_contribution_margin_ars
FROM public.organizations organization
LEFT JOIN public._sale_margin_facts_effective facts ON facts.org_id = organization.id
WHERE public.is_platform_admin(auth.uid())
GROUP BY organization.id;

REVOKE ALL ON TABLE public.platform_org_margin_coverage FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.platform_org_margin_coverage TO authenticated;

CREATE OR REPLACE VIEW public._sale_margin_operations_source
WITH (security_barrier = true)
AS
WITH line_context AS (
  SELECT
    fact.*,
    sale.payment_method,
    sale.split_payments,
    round(coalesce(sale.global_discount_ars, 0), 2) AS global_discount_ars,
    nullif(btrim(sale.coupon_code), '') AS coupon_code,
    coalesce(sale.discount_applied, false) AS price_discount_applied,
    coalesce(store_order.order_number, meli_order.meli_order_id::text) AS external_reference
  FROM public._sale_margin_facts_effective fact
  JOIN public.sales sale ON sale.id = fact.sale_id AND sale.org_id = fact.org_id
  LEFT JOIN public.ecommerce_orders store_order
    ON store_order.id = sale.ecommerce_order_id AND store_order.org_id = sale.org_id
  LEFT JOIN public.meli_order_sale_lines meli_line ON meli_line.sale_id = sale.id
  LEFT JOIN public.meli_orders meli_order
    ON meli_order.id = meli_line.meli_order_id AND meli_order.org_id = sale.org_id
), payment_legs AS (
  SELECT
    line.org_id,
    line.operation_key,
    coalesce(nullif(btrim(leg.value->>'method'), ''), 'sin_informar') AS payment_method,
    CASE
      WHEN coalesce(leg.value->>'amount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        THEN round((leg.value->>'amount')::numeric, 2)
    END AS amount_ars
  FROM line_context line
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(line.split_payments) = 'array'
       AND jsonb_array_length(line.split_payments) > 0
        THEN line.split_payments
      ELSE jsonb_build_array(jsonb_build_object(
        'method', coalesce(nullif(btrim(line.payment_method), ''), 'sin_informar'),
        'amount', line.revenue_ars
      ))
    END
  ) leg
), payment_method_totals AS (
  SELECT
    org_id,
    operation_key,
    payment_method,
    round(sum(amount_ars), 2) AS amount_ars
  FROM payment_legs
  GROUP BY org_id, operation_key, payment_method
), payment_mix AS (
  SELECT
    org_id,
    operation_key,
    array_agg(payment_method ORDER BY payment_method) AS payment_methods,
    jsonb_agg(
      jsonb_build_object('method', payment_method, 'amount_ars', amount_ars)
      ORDER BY payment_method
    ) AS payment_mix,
    round(sum(amount_ars), 2) AS payment_mix_total_ars
  FROM payment_method_totals
  GROUP BY org_id, operation_key
), operation_rollup AS (
  SELECT
    line.org_id,
    line.operation_key,
    (array_agg(line.operation_id ORDER BY line.operation_id))[1] AS operation_id,
    max(line.operation_type) AS operation_type,
    max(line.channel) AS channel,
    max(line.recorded_source) AS recorded_source,
    coalesce(
      max(line.external_reference),
      upper(left(replace((array_agg(line.operation_id ORDER BY line.operation_id))[1]::text, '-', ''), 8))
    ) AS operation_reference,
    min(line.sold_at) AS sold_at,
    count(*)::bigint AS line_count,
    sum(line.quantity)::bigint AS units,
    round(sum(line.revenue_ars), 2) AS revenue_ars,
    bool_and(line.cogs_ars IS NOT NULL) AS cogs_complete,
    bool_and(line.payment_fee_ars IS NOT NULL) AS payment_fee_complete,
    bool_and(line.shipping_cost_ars IS NOT NULL) AS shipping_complete,
    bool_and(line.tax_ars IS NOT NULL) AS tax_complete,
    round(sum(line.cogs_ars), 2) AS cogs_sum_ars,
    round(sum(line.payment_fee_ars), 2) AS payment_fee_sum_ars,
    round(sum(line.shipping_cost_ars), 2) AS shipping_sum_ars,
    round(sum(line.tax_ars), 2) AS tax_sum_ars,
    coalesce(array_agg(DISTINCT line.cogs_source ORDER BY line.cogs_source)
      FILTER (WHERE line.cogs_source IS NOT NULL), ARRAY[]::text[]) AS cogs_sources,
    coalesce(array_agg(DISTINCT line.payment_fee_source ORDER BY line.payment_fee_source)
      FILTER (WHERE line.payment_fee_source IS NOT NULL), ARRAY[]::text[]) AS payment_fee_sources,
    coalesce(array_agg(DISTINCT line.shipping_cost_source ORDER BY line.shipping_cost_source)
      FILTER (WHERE line.shipping_cost_source IS NOT NULL), ARRAY[]::text[]) AS shipping_sources,
    coalesce(array_agg(DISTINCT line.tax_source ORDER BY line.tax_source)
      FILTER (WHERE line.tax_source IS NOT NULL), ARRAY[]::text[]) AS tax_sources,
    round(sum(line.global_discount_ars), 2) AS measured_discount_ars,
    coalesce(array_agg(DISTINCT line.coupon_code ORDER BY line.coupon_code)
      FILTER (WHERE line.coupon_code IS NOT NULL), ARRAY[]::text[]) AS coupon_codes,
    count(*) FILTER (WHERE line.price_discount_applied)::bigint AS price_discount_lines,
    bool_or(
      line.global_discount_ars > 0
      OR line.coupon_code IS NOT NULL
      OR line.price_discount_applied
    ) AS has_promotion,
    bool_or(line.coupon_code IS NOT NULL) AS has_coupon_without_amount,
    bool_or(line.price_discount_applied) AS has_price_discount_without_baseline,
    bool_or(cardinality(line.margin_blockers) > 0) AS has_margin_blocker,
    sum(line.returned_quantity)::bigint AS returned_units
  FROM line_context line
  GROUP BY line.org_id, line.operation_key
), classified AS (
  SELECT
    operation.*,
    (operation.cogs_complete::integer
      + operation.payment_fee_complete::integer
      + operation.shipping_complete::integer
      + operation.tax_complete::integer) AS known_components,
    array_remove(ARRAY[
      CASE WHEN NOT operation.cogs_complete THEN 'costo_mercaderia' END,
      CASE WHEN NOT operation.payment_fee_complete THEN 'comision_cobro' END,
      CASE WHEN NOT operation.shipping_complete THEN 'costo_envio_real' END,
      CASE WHEN NOT operation.tax_complete THEN 'iva' END
    ], NULL)::text[] AS missing_components,
    array_remove(ARRAY[
      CASE WHEN operation.has_margin_blocker THEN 'devolucion_neta' END
    ], NULL)::text[] AS margin_blockers,
    array_remove(ARRAY[
      CASE WHEN operation.has_coupon_without_amount THEN 'importe_descuento_cupon' END,
      CASE WHEN operation.has_price_discount_without_baseline THEN 'precio_referencia_historico' END
    ], NULL)::text[] AS promotion_missing_evidence
  FROM operation_rollup operation
)
SELECT
  classified.org_id,
  classified.operation_key,
  classified.operation_id,
  classified.operation_type,
  classified.operation_reference,
  classified.channel,
  classified.recorded_source,
  classified.sold_at,
  classified.line_count,
  classified.units,
  classified.revenue_ars,
  CASE WHEN classified.cogs_complete THEN classified.cogs_sum_ars END AS cogs_ars,
  CASE WHEN classified.payment_fee_complete THEN classified.payment_fee_sum_ars END AS payment_fee_ars,
  CASE WHEN classified.shipping_complete THEN classified.shipping_sum_ars END AS shipping_cost_ars,
  CASE WHEN classified.tax_complete THEN classified.tax_sum_ars END AS tax_ars,
  CASE
    WHEN classified.known_components = 4 AND NOT classified.has_margin_blocker
    THEN round(
      classified.revenue_ars
      - classified.cogs_sum_ars
      - classified.payment_fee_sum_ars
      - classified.shipping_sum_ars
      - classified.tax_sum_ars,
      2
    )
  END AS contribution_margin_ars,
  classified.known_components,
  classified.known_components * 25 AS coverage_pct,
  classified.missing_components,
  classified.margin_blockers,
  classified.known_components = 4 AND NOT classified.has_margin_blocker AS is_explainable,
  CASE
    WHEN classified.has_margin_blocker THEN 'return_pending'
    WHEN classified.known_components = 4 THEN 'complete'
    WHEN classified.known_components = 0 THEN 'unmeasured'
    ELSE 'partial'
  END AS quality_status,
  classified.cogs_sources,
  classified.payment_fee_sources,
  classified.shipping_sources,
  classified.tax_sources,
  coalesce(mix.payment_methods, ARRAY[]::text[]) AS payment_methods,
  coalesce(mix.payment_mix, '[]'::jsonb) AS payment_mix,
  round(classified.revenue_ars - coalesce(mix.payment_mix_total_ars, 0), 2) AS payment_mix_difference_ars,
  classified.has_promotion,
  classified.measured_discount_ars,
  classified.coupon_codes,
  classified.price_discount_lines,
  classified.promotion_missing_evidence,
  CASE
    WHEN NOT classified.has_promotion THEN 'not_applicable'
    WHEN cardinality(classified.promotion_missing_evidence) > 0 THEN 'partial'
    ELSE 'measured'
  END AS promotion_evidence_status,
  classified.returned_units
FROM classified
LEFT JOIN payment_mix mix
  ON mix.org_id = classified.org_id
 AND mix.operation_key = classified.operation_key;

REVOKE ALL ON TABLE public._sale_margin_operations_source FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.sale_margin_operations
WITH (security_barrier = true)
AS
SELECT operation.*
FROM public._sale_margin_operations_source operation
WHERE public.is_org_member(operation.org_id, auth.uid());

REVOKE ALL ON TABLE public.sale_margin_operations FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.sale_margin_operations TO authenticated;

COMMENT ON VIEW public.sale_margin_operations IS
  'Explicación canónica por ticket/orden: cuatro costos, fuentes, mix de cobro, evidencia promocional y blockers de devolución sin PII.';

DO $verify$
DECLARE
  v_sales bigint;
  v_facts bigint;
  v_operation_lines bigint;
  v_fact_revenue numeric;
  v_operation_revenue numeric;
BEGIN
  SELECT count(*), round(coalesce(sum(revenue_ars), 0), 2)
  INTO v_facts, v_fact_revenue
  FROM public._sale_margin_facts_effective;
  SELECT count(*) INTO v_sales FROM public.sales;
  SELECT coalesce(sum(line_count), 0), round(coalesce(sum(revenue_ars), 0), 2)
  INTO v_operation_lines, v_operation_revenue
  FROM public._sale_margin_operations_source;

  IF v_sales <> v_facts OR v_facts <> v_operation_lines
     OR v_fact_revenue <> v_operation_revenue THEN
    RAISE EXCEPTION 'El agregado por operación perdió o duplicó líneas: sales %, facts %, op lines %, fact revenue %, op revenue %',
      v_sales, v_facts, v_operation_lines, v_fact_revenue, v_operation_revenue;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public._sale_margin_operations_source
    WHERE contribution_margin_ars IS NOT NULL
      AND (known_components <> 4 OR cardinality(margin_blockers) > 0)
  ) THEN
    RAISE EXCEPTION 'Una operación publicó margen final sin cobertura o con blockers';
  END IF;

  IF has_table_privilege('anon', 'public.sale_margin_operations', 'SELECT')
     OR has_table_privilege('authenticated', 'public._sale_margin_operations_source', 'SELECT')
     OR has_table_privilege('authenticated', 'public._sale_margin_facts_effective', 'SELECT') THEN
    RAISE EXCEPTION 'Las vistas internas o tenant de operación tienen privilegios inseguros';
  END IF;
END
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260822000005', 'margin_operation_explanations') ON CONFLICT DO NOTHING;
