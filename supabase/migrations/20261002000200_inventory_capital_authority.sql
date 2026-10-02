BEGIN;

-- Analytical FIFO over immutable movement costs, not a second stock or accounting ledger.
CREATE OR REPLACE VIEW public.inventory_capital_items WITH (security_barrier = true) AS
WITH items AS MATERIALIZED (
  SELECT p.org_id, p.id AS product_id, NULL::uuid AS variant_id, p.name AS product_name,
    NULL::text AS variant_name, p.sku, p.stock, false AS variant_gap
  FROM public.products p WHERE coalesce(p.maneja_stock, true)
    AND public.is_org_member(p.org_id, auth.uid())
    AND public.has_permission(p.org_id, 'inventory', 'view') AND public.has_permission(p.org_id, 'analytics', 'view')
    AND NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id AND v.org_id = p.org_id)
  UNION ALL
  SELECT p.org_id, p.id, v.id, p.name, v.variant_name, v.sku, v.stock,
    p.stock IS DISTINCT FROM (SELECT sum(v2.stock) FROM public.product_variants v2 WHERE v2.product_id = p.id AND v2.org_id = p.org_id)
      OR EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.org_id = p.org_id AND m.product_id = p.id AND m.variant_id IS NULL AND m.quantity <> 0)
  FROM public.products p JOIN public.product_variants v ON v.product_id = p.id AND v.org_id = p.org_id
  WHERE coalesce(p.maneja_stock, true) AND public.is_org_member(p.org_id, auth.uid())
    AND public.has_permission(p.org_id, 'inventory', 'view') AND public.has_permission(p.org_id, 'analytics', 'view')
), raw AS MATERIALIZED (
  SELECT m.* FROM public.stock_movements m JOIN items i ON i.org_id = m.org_id AND i.product_id = m.product_id
    AND i.variant_id IS NOT DISTINCT FROM m.variant_id
), transfers AS (
  SELECT org_id, product_id, variant_id, created_at,
    sum(quantity) <> 0 OR count(*) FILTER (WHERE movement_type = 'transfer_in') <> count(*) FILTER (WHERE movement_type = 'transfer_out') AS invalid
  FROM raw WHERE movement_type IN ('transfer_in', 'transfer_out') GROUP BY org_id, product_id, variant_id, created_at
), ordered AS MATERIALIZED (
  SELECT m.*, row_number() OVER w AS position,
    first_value(stock_before) OVER w AS opening,
    lag(stock_after) OVER w AS prior_after,
    count(*) OVER (PARTITION BY org_id, product_id, variant_id, created_at) AS simultaneous,
    sum(quantity) FILTER (WHERE quantity > 0) OVER w AS cumulative_in
  FROM raw m WHERE movement_type NOT IN ('transfer_in', 'transfer_out')
  WINDOW w AS (PARTITION BY org_id, product_id, variant_id ORDER BY created_at, id ROWS UNBOUNDED PRECEDING)
), checks AS MATERIALIZED (
  SELECT i.*, coalesce(max(m.opening), i.stock) AS opening,
    coalesce(sum(m.quantity), 0) AS delta,
    coalesce(-sum(m.quantity) FILTER (WHERE m.quantity < 0), 0) AS consumed,
    coalesce(bool_or(m.simultaneous > 1), false) AS ambiguous,
    coalesce(bool_or(m.stock_before < 0 OR m.stock_after < 0), false) AS negative_history,
    coalesce(bool_or(m.stock_before IS NULL OR m.stock_after IS NULL OR m.stock_after <> m.stock_before + m.quantity
      OR (m.position > 1 AND m.stock_before IS DISTINCT FROM m.prior_after)), false) AS broken_chain,
    EXISTS (SELECT 1 FROM transfers t WHERE t.org_id = i.org_id AND t.product_id = i.product_id
      AND t.variant_id IS NOT DISTINCT FROM i.variant_id AND t.invalid) AS broken_transfer
  FROM items i LEFT JOIN ordered m ON m.org_id = i.org_id AND m.product_id = i.product_id AND m.variant_id IS NOT DISTINCT FROM i.variant_id
  GROUP BY i.org_id, i.product_id, i.variant_id, i.product_name, i.variant_name, i.sku, i.stock, i.variant_gap
), classified AS MATERIALIZED (
  SELECT c.*, array_remove(ARRAY[
    CASE WHEN stock IS NULL OR stock < 0 THEN 'negative_stock' END,
    CASE WHEN variant_gap THEN 'variant_reconciliation' END,
    CASE WHEN opening < 0 OR negative_history THEN 'negative_history' END,
    CASE WHEN opening + delta IS DISTINCT FROM stock OR broken_chain THEN 'movement_reconciliation' END,
    CASE WHEN ambiguous THEN 'movement_order' END,
    CASE WHEN broken_transfer THEN 'transfer_reconciliation' END
  ], NULL) AS blockers FROM checks c
), incoming AS (
  SELECT c.org_id, c.product_id, c.variant_id, NULL::uuid AS movement_id, NULL::timestamptz AS received_at,
    'opening'::text AS source, c.opening AS units, NULL::numeric AS unit_cost_ars, c.opening::numeric AS cumulative_in
  FROM classified c WHERE c.opening > 0
  UNION ALL
  SELECT m.org_id, m.product_id, m.variant_id, m.id, m.created_at,
    CASE WHEN m.movement_type IN ('purchase', 'purchase_edited', 'initial', 'initial_stock', 'manual_in', 'adjustment_in', 'import')
      AND m.unit_cost_ars > 0 THEN 'movement_snapshot' ELSE 'unverified_entry' END,
    m.quantity,
    CASE WHEN m.movement_type IN ('purchase', 'purchase_edited', 'initial', 'initial_stock', 'manual_in', 'adjustment_in', 'import')
      AND m.unit_cost_ars > 0 THEN m.unit_cost_ars END,
    m.opening + coalesce(m.cumulative_in, 0)
  FROM ordered m WHERE m.quantity > 0
), remaining AS MATERIALIZED (
  SELECT incoming.*, least(incoming.units::numeric, greatest(0, incoming.cumulative_in - c.consumed))::integer AS remaining_units
  FROM incoming JOIN classified c USING (org_id, product_id)
  WHERE c.variant_id IS NOT DISTINCT FROM incoming.variant_id AND cardinality(c.blockers) = 0
), valuation AS MATERIALIZED (
  SELECT c.*,
    coalesce(sum(r.remaining_units) FILTER (WHERE r.unit_cost_ars IS NOT NULL), 0)::integer AS known_units,
    round(sum(r.remaining_units * r.unit_cost_ars) FILTER (WHERE r.unit_cost_ars IS NOT NULL), 2) AS measured_value_ars,
    coalesce(jsonb_agg(jsonb_build_object('movementId', r.movement_id, 'receivedAt', r.received_at, 'source', r.source,
      'remainingUnits', r.remaining_units, 'unitCostARS', r.unit_cost_ars,
      'valueARS', round(r.remaining_units * r.unit_cost_ars, 2)) ORDER BY r.received_at NULLS FIRST, r.movement_id)
      FILTER (WHERE r.remaining_units > 0), '[]'::jsonb) AS layers
  FROM classified c LEFT JOIN remaining r ON r.org_id = c.org_id AND r.product_id = c.product_id AND r.variant_id IS NOT DISTINCT FROM c.variant_id AND r.remaining_units > 0
  GROUP BY c.org_id, c.product_id, c.variant_id, c.product_name, c.variant_name, c.sku, c.stock, c.variant_gap,
    c.opening, c.delta, c.consumed, c.ambiguous, c.negative_history, c.broken_chain, c.broken_transfer, c.blockers
), sales AS (
  SELECT s.org_id, s.product_id, s.variant_id, max(s.date) FILTER (WHERE s.quantity > s.returned_quantity AND s.date <= now()) AS last_sold_at,
    coalesce(sum(s.quantity - s.returned_quantity) FILTER (WHERE s.date > now() - interval '90 days' AND s.date <= now()), 0) AS sold_units_90
  FROM public.sales s JOIN items i ON i.org_id = s.org_id AND i.product_id = s.product_id AND i.variant_id IS NOT DISTINCT FROM s.variant_id
  GROUP BY s.org_id, s.product_id, s.variant_id
)
SELECT v.org_id, v.product_id, v.variant_id, v.product_name, v.variant_name, nullif(v.sku, '') AS sku, v.stock AS stock_units,
  v.known_units, CASE WHEN stock > 0 THEN stock - known_units ELSE 0 END AS unvalued_units,
  CASE WHEN stock = 0 AND cardinality(blockers) = 0 THEN 0 ELSE measured_value_ars END AS measured_value_ars,
  CASE WHEN cardinality(blockers) = 0 AND stock = known_units THEN coalesce(measured_value_ars, 0) END AS value_ars,
  CASE WHEN stock > 0 THEN round(100.0 * known_units / stock, 1) END AS coverage_pct,
  blockers || CASE WHEN stock > known_units AND cardinality(blockers) = 0 THEN ARRAY['missing_cost'] ELSE ARRAY[]::text[] END AS reasons,
  layers, s.last_sold_at, coalesce(s.sold_units_90, 0) AS sold_units_90,
  CASE WHEN s.last_sold_at IS NOT NULL THEN (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - (s.last_sold_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date END AS days_without_sale,
  CASE WHEN stock >= 0 AND s.sold_units_90 > 0 THEN round(stock * 90.0 / s.sold_units_90, 1) END AS days_of_stock
FROM valuation v LEFT JOIN sales s ON s.org_id = v.org_id AND s.product_id = v.product_id AND s.variant_id IS NOT DISTINCT FROM v.variant_id;
REVOKE ALL ON public.inventory_capital_items FROM PUBLIC, anon;
GRANT SELECT ON public.inventory_capital_items TO authenticated;

ALTER TABLE public.inventory_snapshots ALTER COLUMN stock_value DROP NOT NULL;
ALTER TABLE public.inventory_snapshots ADD COLUMN IF NOT EXISTS valuation_version smallint;
ALTER TABLE public.inventory_snapshots ADD COLUMN IF NOT EXISTS valuation_details jsonb;
ALTER TABLE public.inventory_snapshots ADD COLUMN IF NOT EXISTS recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
-- Legacy zero-valued rows remain legacy; they are never promoted to proven capital.
DROP POLICY IF EXISTS org_inventory_snapshots ON public.inventory_snapshots;
DROP POLICY IF EXISTS inventory_snapshots_capital_read ON public.inventory_snapshots;
CREATE POLICY inventory_snapshots_capital_read ON public.inventory_snapshots FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()) AND public.has_permission(org_id, 'inventory', 'view') AND public.has_permission(org_id, 'analytics', 'view'));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.inventory_snapshots FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON public.inventory_snapshots FROM PUBLIC, anon;
GRANT SELECT ON public.inventory_snapshots TO authenticated;

DROP FUNCTION IF EXISTS public.get_inventory_capital(uuid,text,integer,integer,integer);
CREATE OR REPLACE FUNCTION public.get_inventory_capital(p_org_id uuid, p_search text, p_page integer, p_page_size integer, p_history_page integer, p_layer_page integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_org_id IS NULL OR NOT public.is_org_member(p_org_id, auth.uid())
    OR NOT public.has_permission(p_org_id, 'inventory', 'view') OR NOT public.has_permission(p_org_id, 'analytics', 'view') THEN
    RAISE EXCEPTION 'No permission to read inventory capital' USING ERRCODE = '42501';
  END IF;
  IF p_search IS NULL OR length(p_search) > 120 OR p_page IS NULL OR p_page < 1 OR p_history_page IS NULL OR p_history_page < 1 OR p_layer_page IS NULL OR p_layer_page < 1
    OR p_page_size IS NULL OR p_page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid capital filters' USING ERRCODE = '22023';
  END IF;
  WITH population AS MATERIALIZED (
    SELECT * FROM public.inventory_capital_items WHERE org_id = p_org_id AND (stock_units IS NULL OR stock_units <> 0)
      AND (p_search = '' OR position(lower(p_search) IN lower(concat_ws(' ', product_name, variant_name, sku))) > 0)
  ), counters AS (
    SELECT count(*) AS items, coalesce(sum(stock_units), 0) AS units,
      coalesce(sum(stock_units) FILTER (WHERE stock_units > 0), 0) AS positive_units,
      coalesce(sum(known_units), 0) AS known_units, coalesce(sum(unvalued_units), 0) AS unvalued_units,
      count(*) FILTER (WHERE reasons && ARRAY['negative_stock','variant_reconciliation','negative_history','movement_reconciliation','movement_order','transfer_reconciliation']) AS blocked_items,
      CASE WHEN count(*) > 0 AND bool_and(value_ars IS NOT NULL) THEN sum(value_ars) END AS value_ars,
      sum(measured_value_ars) AS measured_value_ars,
      sum(measured_value_ars) FILTER (WHERE days_without_sale > 90) AS slow_capital_ars
    FROM population
  ), page AS (
    SELECT * FROM population ORDER BY product_name, product_id, variant_id NULLS FIRST
    LIMIT p_page_size OFFSET (least(p_page, greatest(1, (SELECT ceil(items::numeric / p_page_size)::integer FROM counters))) - 1) * p_page_size
  ), layers AS MATERIALIZED (
    SELECT p.product_id, p.variant_id, p.product_name, p.variant_name, p.sku, layer.value AS layer, layer.ordinality AS layer_position
    FROM population p CROSS JOIN LATERAL jsonb_array_elements(p.layers) WITH ORDINALITY layer
  ), layer_page AS (
    SELECT * FROM layers ORDER BY product_name, product_id, variant_id NULLS FIRST, layer_position LIMIT p_page_size
    OFFSET (least(p_layer_page, greatest(1, (SELECT ceil(count(*)::numeric / p_page_size)::integer FROM layers))) - 1) * p_page_size
  ), history AS MATERIALIZED (
    SELECT snapshot_date, max(created_at) AS captured_at, count(*) AS products,
      bool_and(valuation_version = 1 AND valuation_details IS NOT NULL) AND count(*) FILTER (WHERE valuation_version IS NULL) = 0 AS verified,
      sum(stock_quantity) AS units,
      CASE WHEN bool_and(stock_value IS NOT NULL AND valuation_version = 1) AND count(*) FILTER (WHERE valuation_version IS NULL) = 0 THEN sum(stock_value) END AS value_ars,
      CASE WHEN bool_and(valuation_version = 1) AND count(*) FILTER (WHERE valuation_version IS NULL) = 0 THEN sum((valuation_details->>'measuredValueARS')::numeric) END AS measured_value_ars
    FROM public.inventory_snapshots WHERE org_id = p_org_id GROUP BY snapshot_date
  ), history_page AS (
    SELECT * FROM history ORDER BY snapshot_date DESC LIMIT p_page_size
    OFFSET (least(p_history_page, greatest(1, (SELECT ceil(count(*)::numeric / p_page_size)::integer FROM history))) - 1) * p_page_size
  )
  SELECT jsonb_build_object('version', 1, 'orgId', p_org_id, 'currency', 'ARS', 'method', 'fifo_movement_snapshot',
    'asOf', now(), 'snapshotDate', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, 'search', p_search,
    'pageSize', p_page_size, 'itemCount', c.items, 'page', least(p_page, greatest(1, ceil(c.items::numeric / p_page_size)::integer)),
    'summary', jsonb_build_object('stockUnits', c.units, 'positiveUnits', c.positive_units, 'knownUnits', c.known_units,
      'unvaluedUnits', c.unvalued_units, 'blockedItems', c.blocked_items, 'valueARS', c.value_ars, 'measuredValueARS', c.measured_value_ars,
      'slowCapitalARS', c.slow_capital_ars, 'coveragePct', CASE WHEN c.positive_units > 0 THEN round(100.0 * c.known_units / c.positive_units, 1) END),
    'items', coalesce((SELECT jsonb_agg(to_jsonb(page) - 'org_id' - 'layers' ORDER BY product_name, product_id, variant_id NULLS FIRST) FROM page), '[]'::jsonb),
    'layerCount', (SELECT count(*) FROM layers),
    'layerPage', least(p_layer_page, greatest(1, (SELECT ceil(count(*)::numeric / p_page_size)::integer FROM layers))),
    'layers', coalesce((SELECT jsonb_agg((to_jsonb(layer_page) - 'layer' - 'layer_position') || layer ORDER BY product_name, product_id, variant_id NULLS FIRST, layer_position) FROM layer_page), '[]'::jsonb),
    'historyCount', (SELECT count(*) FROM history),
    'historyPage', least(p_history_page, greatest(1, (SELECT ceil(count(*)::numeric / p_page_size)::integer FROM history))),
    'history', coalesce((SELECT jsonb_agg(to_jsonb(history_page) ORDER BY snapshot_date DESC) FROM history_page), '[]'::jsonb)) INTO v_result FROM counters c;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_inventory_capital(uuid,text,integer,integer,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_inventory_capital(uuid,text,integer,integer,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.capture_inventory_capital(p_org_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL OR p_org_id IS NULL OR NOT public.is_org_member(p_org_id, auth.uid()) OR NOT public.has_permission(p_org_id, 'analytics', 'view')
    OR NOT public.has_permission(p_org_id, 'inventory', 'view') OR NOT public.has_permission(p_org_id, 'inventory', 'create') THEN
    RAISE EXCEPTION 'No permission to capture capital' USING ERRCODE = '42501';
  END IF;
  IF p_date IS NULL OR p_date <> (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date THEN
    RAISE EXCEPTION 'Refresh capital before capturing another day' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':inventory-capital:' || p_date, 0));
  IF EXISTS (SELECT 1 FROM public.inventory_snapshots WHERE org_id = p_org_id AND snapshot_date = p_date) THEN
    RETURN jsonb_build_object('orgId', p_org_id, 'date', p_date, 'status', 'already_recorded');
  END IF;
  INSERT INTO public.inventory_snapshots(org_id, snapshot_date, product_id, stock_quantity, stock_value, valuation_version, valuation_details, recorded_by)
  SELECT p_org_id, p_date, product_id, sum(stock_units),
    CASE WHEN bool_and(value_ars IS NOT NULL) THEN sum(value_ars) END, 1,
    jsonb_build_object('method', 'fifo_movement_snapshot', 'currency', 'ARS', 'knownUnits', sum(known_units), 'unvaluedUnits', sum(unvalued_units),
      'measuredValueARS', sum(measured_value_ars), 'items', jsonb_agg(to_jsonb(i) - 'org_id' ORDER BY variant_id NULLS FIRST)), auth.uid()
  FROM public.inventory_capital_items i WHERE org_id = p_org_id AND (stock_units IS NULL OR stock_units <> 0)
  GROUP BY product_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('orgId', p_org_id, 'date', p_date, 'status', CASE WHEN v_count > 0 THEN 'recorded' ELSE 'empty' END);
END;
$function$;
REVOKE ALL ON FUNCTION public.capture_inventory_capital(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.capture_inventory_capital(uuid,date) TO authenticated;

INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES ('20261002000200', 'inventory_capital_authority', ARRAY[]::text[]) ON CONFLICT (version) DO NOTHING;
NOTIFY pgrst, 'reload schema';
COMMIT;
