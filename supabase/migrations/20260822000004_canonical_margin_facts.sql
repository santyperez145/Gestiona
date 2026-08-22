-- F2 / Margin Intelligence: una sola verdad, con procedencia y cobertura.
--
-- El panel anterior armaba el margen en el navegador desde tres lecturas y
-- descartaba cualquier `sales.source` que no fuera POS, tienda o MercadoLibre.
-- En la base real eso ocultaba 32 de 34 ventas. Ademas, un costo historico en
-- cero se mostraba como costo real, aun cuando el producto hoy tuviera costo:
-- el margen quedaba optimista sin ninguna advertencia.
--
-- Esta vista no completa la historia con el costo actual del producto ni con
-- aranceles configurados hoy. Cada termino dice de que evidencia persistida
-- salio; si falta uno de los cuatro, el margen de contribucion queda NULL.

CREATE OR REPLACE VIEW public._sale_margin_facts_source
WITH (security_barrier = true)
AS
WITH ledger_components AS (
  SELECT
    entry.org_id,
    entry.referencia_tipo,
    entry.referencia_id,
    round(sum(line.debe - line.haber) FILTER (WHERE account.codigo = '5.1.01'), 2) AS cogs_total_ars,
    -- El motor de ventas agrega IVA aun cuando resulte cero; ledger_asentar
    -- omite partidas en cero. La existencia del asiento conserva igualmente
    -- la evidencia de que el calculo fiscal se ejecuto.
    round(coalesce(sum(line.haber - line.debe) FILTER (WHERE account.codigo = '2.1.02'), 0), 2) AS tax_total_ars
  FROM public.ledger_entries entry
  JOIN public.ledger_lines line ON line.entry_id = entry.id
  JOIN public.ledger_accounts account ON account.id = line.account_id
  WHERE entry.anulado_por IS NULL
    AND entry.anula_a IS NULL
    AND entry.referencia_id IS NOT NULL
    AND entry.referencia_tipo IN ('venta_pos', 'orden')
  GROUP BY entry.id, entry.org_id, entry.referencia_tipo, entry.referencia_id
), payment_components AS (
  SELECT
    transaction.org_id,
    transaction.source_id,
    round(sum(
      transaction.provider_fee
      + transaction.provider_fee_iva
      + transaction.platform_fee
    ), 2) AS payment_fee_total_ars
  FROM public.payment_transactions transaction
  WHERE transaction.source = 'pos'
    AND transaction.status = 'approved'
    AND transaction.source_id IS NOT NULL
  GROUP BY transaction.org_id, transaction.source_id
), base AS (
  SELECT
    sale.id AS sale_id,
    sale.org_id,
    sale.product_id,
    sale.product_name,
    sale.quantity,
    sale.date AS sold_at,
    sale.source AS recorded_source,
    CASE sale.source
      WHEN 'pos' THEN 'pos'
      WHEN 'tienda_online' THEN 'tienda_online'
      WHEN 'mercadolibre' THEN 'mercadolibre'
      WHEN 'manual' THEN 'sin_atribuir'
      ELSE coalesce(nullif(sale.source, ''), 'sin_atribuir')
    END AS channel,
    CASE
      WHEN sale.source = 'tienda_online' AND sale.ecommerce_order_id IS NOT NULL THEN 'orden_tienda'
      WHEN sale.source = 'mercadolibre' AND meli.meli_order_id IS NOT NULL THEN 'orden_mercadolibre'
      WHEN sale.sale_transaction_id IS NOT NULL THEN 'venta'
      ELSE 'linea_historica'
    END AS operation_type,
    coalesce(
      CASE WHEN sale.source = 'tienda_online' THEN sale.ecommerce_order_id END,
      CASE WHEN sale.source = 'mercadolibre' THEN meli.meli_order_id END,
      sale.sale_transaction_id,
      sale.id
    ) AS operation_id,
    concat(
      sale.org_id::text,
      ':',
      CASE
        WHEN sale.source = 'tienda_online' AND sale.ecommerce_order_id IS NOT NULL THEN 'store'
        WHEN sale.source = 'mercadolibre' AND meli.meli_order_id IS NOT NULL THEN 'meli'
        WHEN sale.sale_transaction_id IS NOT NULL THEN 'sale'
        ELSE 'legacy'
      END,
      ':',
      coalesce(
        CASE WHEN sale.source = 'tienda_online' THEN sale.ecommerce_order_id::text END,
        CASE WHEN sale.source = 'mercadolibre' THEN meli.meli_order_id::text END,
        sale.sale_transaction_id::text,
        sale.id::text
      )
    ) AS operation_key,
    round(coalesce(sale.total_ars, 0), 2) AS revenue_ars,
    CASE WHEN coalesce(sale.cost_of_goods_ars, 0) > 0
      THEN round(sale.cost_of_goods_ars, 2)
    END AS sale_cogs_ars,
    store.payment_fee_ars AS store_payment_fee_ars,
    store.carrier_shipping_cost_ars AS store_shipping_cost_ars,
    store.tax_ars AS store_tax_ars,
    meli.sale_fee_ars AS meli_payment_fee_ars,
    meli.seller_shipping_cost_ars AS meli_shipping_cost_ars,
    line_payment.payment_fee_total_ars AS line_payment_fee_ars,
    transaction_payment.payment_fee_total_ars AS transaction_payment_fee_ars,
    coalesce(pos_ledger.cogs_total_ars, store_ledger.cogs_total_ars) AS ledger_cogs_total_ars,
    coalesce(pos_ledger.tax_total_ars, store_ledger.tax_total_ars) AS ledger_tax_total_ars,
    invoice.tax_amount AS invoice_tax_ars,
    sale.invoice_id,
    sale.ecommerce_order_id,
    sale.sale_transaction_id,
    meli.meli_order_id,
    coalesce(sale.payment_method, '') AS payment_method,
    sale.split_payments,
    coalesce(sale.returned, false) AS returned,
    coalesce(sale.returned_quantity, 0) AS returned_quantity
  FROM public.sales sale
  LEFT JOIN public.store_order_margin_facts store ON store.sale_id = sale.id
  LEFT JOIN public.meli_order_sale_lines meli ON meli.sale_id = sale.id
  LEFT JOIN payment_components line_payment
    ON line_payment.org_id = sale.org_id
   AND line_payment.source_id = sale.id
  LEFT JOIN payment_components transaction_payment
    ON transaction_payment.org_id = sale.org_id
   AND transaction_payment.source_id = sale.sale_transaction_id
  LEFT JOIN ledger_components pos_ledger
    ON pos_ledger.org_id = sale.org_id
   AND pos_ledger.referencia_tipo = 'venta_pos'
   AND pos_ledger.referencia_id = sale.sale_transaction_id
  LEFT JOIN ledger_components store_ledger
    ON store_ledger.org_id = sale.org_id
   AND store_ledger.referencia_tipo = 'orden'
   AND store_ledger.referencia_id = sale.ecommerce_order_id
  LEFT JOIN LATERAL (
    SELECT candidate.tax_amount
    FROM public.invoices candidate
    WHERE candidate.org_id = sale.org_id
      AND (candidate.id = sale.invoice_id OR candidate.sale_id = sale.id)
    ORDER BY (candidate.id = sale.invoice_id) DESC, candidate.created_at DESC
    LIMIT 1
  ) invoice ON true
), operation_totals AS (
  SELECT
    base.*,
    sum(base.revenue_ars) OVER operation_window AS operation_revenue_ars,
    sum(coalesce(base.sale_cogs_ars, 0)) OVER operation_window AS operation_known_cogs_ars,
    sum(base.revenue_ars) FILTER (WHERE base.sale_cogs_ars IS NULL) OVER operation_window AS missing_cogs_revenue_ars,
    sum(CASE WHEN base.sale_cogs_ars IS NULL THEN 1 ELSE 0 END)
      OVER operation_ordered AS missing_cogs_position,
    count(*) FILTER (WHERE base.sale_cogs_ars IS NULL)
      OVER operation_window AS missing_cogs_count,
    row_number() OVER operation_ordered AS allocation_position,
    count(*) OVER operation_window AS allocation_count
  FROM base
  WINDOW
    operation_window AS (PARTITION BY base.org_id, base.operation_key),
    operation_ordered AS (
      PARTITION BY base.org_id, base.operation_key
      ORDER BY base.sale_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )
), provisional AS (
  SELECT
    operation_totals.*,
    CASE
      WHEN transaction_payment_fee_ars IS NOT NULL AND operation_revenue_ars > 0
      THEN round(transaction_payment_fee_ars * revenue_ars / operation_revenue_ars, 2)
    END AS transaction_payment_preliminary_ars,
    CASE
      WHEN ledger_tax_total_ars IS NOT NULL AND operation_revenue_ars > 0
      THEN round(ledger_tax_total_ars * revenue_ars / operation_revenue_ars, 2)
    END AS ledger_tax_preliminary_ars,
    CASE
      WHEN sale_cogs_ars IS NULL
       AND ledger_cogs_total_ars > operation_known_cogs_ars
       AND missing_cogs_revenue_ars > 0
      THEN round(
        (ledger_cogs_total_ars - operation_known_cogs_ars)
        * revenue_ars / missing_cogs_revenue_ars,
        2
      )
    END AS ledger_cogs_preliminary_ars
  FROM operation_totals
), allocated AS (
  SELECT
    provisional.*,
    CASE
      WHEN transaction_payment_fee_ars IS NULL OR operation_revenue_ars <= 0 THEN NULL
      WHEN allocation_position = allocation_count THEN round(
        transaction_payment_fee_ars
        - coalesce(sum(transaction_payment_preliminary_ars) OVER (
            PARTITION BY org_id, operation_key
            ORDER BY sale_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0),
        2
      )
      ELSE transaction_payment_preliminary_ars
    END AS transaction_payment_allocated_ars,
    CASE
      WHEN ledger_tax_total_ars IS NULL OR operation_revenue_ars <= 0 THEN NULL
      WHEN allocation_position = allocation_count THEN round(
        ledger_tax_total_ars
        - coalesce(sum(ledger_tax_preliminary_ars) OVER (
            PARTITION BY org_id, operation_key
            ORDER BY sale_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0),
        2
      )
      ELSE ledger_tax_preliminary_ars
    END AS ledger_tax_allocated_ars,
    CASE
      WHEN sale_cogs_ars IS NOT NULL THEN NULL
      WHEN ledger_cogs_total_ars <= operation_known_cogs_ars OR missing_cogs_revenue_ars <= 0 THEN NULL
      WHEN missing_cogs_position = missing_cogs_count THEN round(
        (ledger_cogs_total_ars - operation_known_cogs_ars)
        - coalesce(sum(ledger_cogs_preliminary_ars) FILTER (WHERE sale_cogs_ars IS NULL) OVER (
            PARTITION BY org_id, operation_key
            ORDER BY sale_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0),
        2
      )
      ELSE ledger_cogs_preliminary_ars
    END AS ledger_cogs_allocated_ars
  FROM provisional
), resolved AS (
  SELECT
    allocated.*,
    coalesce(sale_cogs_ars, ledger_cogs_allocated_ars) AS cogs_ars,
    CASE
      WHEN sale_cogs_ars IS NOT NULL THEN 'sale_snapshot'
      WHEN ledger_cogs_allocated_ars IS NOT NULL THEN 'ledger_operation_allocation'
    END AS cogs_source,
    CASE
      WHEN store_payment_fee_ars IS NOT NULL THEN store_payment_fee_ars
      WHEN meli_payment_fee_ars IS NOT NULL THEN meli_payment_fee_ars
      WHEN line_payment_fee_ars IS NOT NULL THEN line_payment_fee_ars
      WHEN payment_method = 'efectivo'
       AND (split_payments IS NULL OR split_payments = '[]'::jsonb OR split_payments = '{}'::jsonb)
        THEN 0::numeric
      ELSE transaction_payment_allocated_ars
    END AS payment_fee_ars,
    CASE
      WHEN store_payment_fee_ars IS NOT NULL THEN 'store_settlement'
      WHEN meli_payment_fee_ars IS NOT NULL THEN 'meli_settlement'
      WHEN line_payment_fee_ars IS NOT NULL THEN 'payment_transaction_line'
      WHEN payment_method = 'efectivo'
       AND (split_payments IS NULL OR split_payments = '[]'::jsonb OR split_payments = '{}'::jsonb)
        THEN 'cash_not_applicable'
      WHEN transaction_payment_allocated_ars IS NOT NULL THEN 'payment_transaction_allocation'
    END AS payment_fee_source,
    CASE
      WHEN store_shipping_cost_ars IS NOT NULL THEN store_shipping_cost_ars
      WHEN meli_shipping_cost_ars IS NOT NULL THEN meli_shipping_cost_ars
      WHEN recorded_source = 'pos' THEN 0::numeric
    END AS shipping_cost_ars,
    CASE
      WHEN store_shipping_cost_ars IS NOT NULL THEN 'carrier_settlement'
      WHEN meli_shipping_cost_ars IS NOT NULL THEN 'meli_settlement'
      WHEN recorded_source = 'pos' THEN 'pos_not_applicable'
    END AS shipping_cost_source,
    CASE
      WHEN store_tax_ars IS NOT NULL THEN store_tax_ars
      WHEN invoice_tax_ars IS NOT NULL THEN round(invoice_tax_ars, 2)
      ELSE ledger_tax_allocated_ars
    END AS tax_ars,
    CASE
      WHEN store_tax_ars IS NOT NULL THEN 'store_order_snapshot'
      WHEN invoice_tax_ars IS NOT NULL THEN 'invoice_snapshot'
      WHEN ledger_tax_allocated_ars IS NOT NULL THEN 'ledger_operation_allocation'
    END AS tax_source
  FROM allocated
), classified AS (
  SELECT
    resolved.*,
    (cogs_ars IS NOT NULL)::integer
      + (payment_fee_ars IS NOT NULL)::integer
      + (shipping_cost_ars IS NOT NULL)::integer
      + (tax_ars IS NOT NULL)::integer AS known_components,
    array_remove(ARRAY[
      CASE WHEN cogs_ars IS NULL THEN 'costo_mercaderia' END,
      CASE WHEN payment_fee_ars IS NULL THEN 'comision_cobro' END,
      CASE WHEN shipping_cost_ars IS NULL THEN 'costo_envio_real' END,
      CASE WHEN tax_ars IS NULL THEN 'iva' END
    ], NULL)::text[] AS missing_components
  FROM resolved
)
SELECT
  sale_id,
  org_id,
  product_id,
  product_name,
  quantity,
  sold_at,
  recorded_source,
  channel,
  operation_type,
  operation_id,
  operation_key,
  revenue_ars,
  cogs_ars,
  cogs_source,
  payment_fee_ars,
  payment_fee_source,
  shipping_cost_ars,
  shipping_cost_source,
  tax_ars,
  tax_source,
  CASE WHEN cogs_ars IS NOT NULL
    THEN round(revenue_ars - cogs_ars, 2)
  END AS gross_margin_ars,
  CASE WHEN known_components = 4
    THEN round(revenue_ars - cogs_ars - payment_fee_ars - shipping_cost_ars - tax_ars, 2)
  END AS contribution_margin_ars,
  known_components,
  known_components * 25 AS coverage_pct,
  missing_components,
  known_components = 4 AS is_explainable,
  CASE
    WHEN known_components = 4 THEN 'complete'
    WHEN known_components = 0 THEN 'unmeasured'
    ELSE 'partial'
  END AS quality_status,
  returned,
  returned_quantity
FROM classified;

REVOKE ALL ON TABLE public._sale_margin_facts_source FROM PUBLIC, anon, authenticated;

-- Superficie de la organización. Es deliberadamente security-definer con un
-- filtro de membresía explícito: la fuente interna está revocada y también la
-- reutiliza la vista agregada del Control Plane, sin abrir las ventas crudas al
-- staff de plataforma.
CREATE OR REPLACE VIEW public.sale_margin_facts
WITH (security_barrier = true)
AS
SELECT source.*
FROM public._sale_margin_facts_source source
WHERE public.is_org_member(source.org_id, auth.uid());

REVOKE ALL ON TABLE public.sale_margin_facts FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.sale_margin_facts TO authenticated;

COMMENT ON VIEW public.sale_margin_facts IS
  'Hechos canónicos por línea. Margen de contribución sólo cuando costo, comisión, envío real e IVA tienen evidencia persistida; null nunca significa cero.';

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

-- Superficie sanitizada para Merchant 360. No expone producto, cliente,
-- precio unitario ni costos por operación: sólo cobertura agregada.
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
LEFT JOIN public._sale_margin_facts_source facts ON facts.org_id = organization.id
WHERE public.is_platform_admin(auth.uid())
GROUP BY organization.id;

REVOKE ALL ON TABLE public.platform_org_margin_coverage FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.platform_org_margin_coverage TO authenticated;

COMMENT ON VIEW public.platform_org_margin_coverage IS
  'Cobertura agregada del margen canónico por organización para Control Plane; no expone detalle comercial ni PII.';

DO $verify$
DECLARE
  v_sales bigint;
  v_facts bigint;
  v_sensitive integer;
BEGIN
  SELECT count(*) INTO v_sales FROM public.sales;
  SELECT count(*) INTO v_facts FROM public._sale_margin_facts_source;
  IF v_sales <> v_facts THEN
    RAISE EXCEPTION 'Margen canónico perdió líneas: sales %, facts %', v_sales, v_facts;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public._sale_margin_facts_source
    WHERE is_explainable IS DISTINCT FROM (known_components = 4)
       OR contribution_margin_ars IS NOT NULL AND known_components <> 4
       OR coverage_pct <> known_components * 25
  ) THEN
    RAISE EXCEPTION 'La cobertura y el margen final no respetan el contrato de cuatro componentes';
  END IF;

  SELECT count(*) INTO v_sensitive
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'platform_org_margin_coverage'
    AND column_name IN (
      'product_id', 'product_name', 'customer_name', 'customer_email',
      'payment_method', 'cogs_ars', 'tax_ars', 'sale_id', 'operation_id'
    );
  IF v_sensitive <> 0 THEN
    RAISE EXCEPTION 'La cobertura de plataforma expone % columnas de detalle', v_sensitive;
  END IF;

  IF has_table_privilege('anon', 'public.sale_margin_facts', 'SELECT')
     OR has_table_privilege('anon', 'public.platform_org_margin_coverage', 'SELECT')
     OR has_table_privilege('authenticated', 'public._sale_margin_facts_source', 'SELECT') THEN
    RAISE EXCEPTION 'Las vistas de margen quedaron con privilegios inseguros';
  END IF;
END
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260822000004', 'canonical_margin_facts') ON CONFLICT DO NOTHING;
