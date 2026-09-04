-- D5.23 / período y comparación honesta para Commerce.
--
-- Conserva un único snapshot. Al seleccionar fechas, los pedidos se agrupan
-- por fecha de creación y las sesiones por cohorte de creación; la comparación
-- usa inmediatamente el mismo número de días anterior. Los límites de día son
-- Argentina, no UTC accidental del navegador.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_ecommerce_orders_org_created_at
  ON public.ecommerce_orders (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cart_sessions_org_created_at
  ON public.ecommerce_cart_sessions (org_id, created_at DESC);

DROP FUNCTION IF EXISTS public.get_store_performance_snapshot(uuid);

CREATE FUNCTION public.get_store_performance_snapshot(
  p_org_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_attribution_start constant timestamptz := '2026-09-03 00:00:00+00';
  v_checkout_tracking_start constant timestamptz := '2026-09-04 03:41:11+00';
  v_timezone constant text := 'America/Argentina/Buenos_Aires';
  v_filtered boolean := p_from IS NOT NULL OR p_to IS NOT NULL;
  v_from_date date := COALESCE(p_from, p_to);
  v_to_date date := COALESCE(p_to, p_from);
  v_days integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_previous_from_date date;
  v_previous_to_date date;
  v_previous_start timestamptz;
  v_previous_end timestamptz;
  v_result jsonb;
BEGIN
  IF p_org_id IS NULL OR v_actor IS NULL
     OR NOT public.is_org_member(p_org_id, v_actor) THEN
    RAISE EXCEPTION 'No autorizado para consultar esta organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_filtered THEN
    IF v_from_date IS NULL OR v_to_date IS NULL OR v_to_date < v_from_date THEN
      RAISE EXCEPTION 'El período de Commerce no es válido' USING ERRCODE = '22023';
    END IF;
    v_days := (v_to_date - v_from_date) + 1;
    v_period_start := v_from_date::timestamp AT TIME ZONE v_timezone;
    v_period_end := (v_to_date + 1)::timestamp AT TIME ZONE v_timezone;
    v_previous_from_date := v_from_date - v_days;
    v_previous_to_date := v_from_date - 1;
    v_previous_start := v_previous_from_date::timestamp AT TIME ZONE v_timezone;
    v_previous_end := v_period_start;
  END IF;

  WITH order_metrics AS (
    SELECT
      count(*)::bigint AS orders_total,
      count(*) FILTER (WHERE payment_status = 'paid')::bigint AS orders_paid,
      COALESCE(sum(total) FILTER (WHERE payment_status = 'paid'), 0)::numeric
        AS paid_revenue_ars,
      count(DISTINCT cart_session_id)
        FILTER (WHERE cart_session_id IS NOT NULL)::bigint AS attributed_orders
    FROM public.ecommerce_orders
    WHERE org_id = p_org_id
      AND (
        NOT v_filtered
        OR (created_at >= v_period_start AND created_at < v_period_end)
      )
  ),
  previous_order_metrics AS (
    SELECT
      count(*)::bigint AS orders_total,
      count(*) FILTER (WHERE payment_status = 'paid')::bigint AS orders_paid,
      COALESCE(sum(total) FILTER (WHERE payment_status = 'paid'), 0)::numeric
        AS paid_revenue_ars
    FROM public.ecommerce_orders
    WHERE org_id = p_org_id
      AND v_filtered
      AND created_at >= v_previous_start
      AND created_at < v_previous_end
  ),
  cart_metrics AS (
    SELECT
      count(DISTINCT cs.id)::bigint AS sessions_total,
      count(DISTINCT cs.id) FILTER (
        WHERE jsonb_typeof(cs.items) = 'array'
          AND jsonb_array_length(cs.items) > 0
      )::bigint AS sessions_with_items,
      count(DISTINCT cs.id) FILTER (
        WHERE cs.checkout_started_at IS NOT NULL OR linked.id IS NOT NULL
      )::bigint AS checkout_started_sessions,
      count(DISTINCT cs.id) FILTER (
        WHERE cs.status = 'converted' OR linked.id IS NOT NULL
      )::bigint AS converted_sessions,
      count(DISTINCT cs.id) FILTER (
        WHERE jsonb_typeof(cs.items) = 'array'
          AND jsonb_array_length(cs.items) > 0
          AND cs.expires_at > now()
          AND (
            cs.status = 'abandoned'
            OR (
              cs.status = 'active'
              AND NULLIF(btrim(cs.customer_email), '') IS NOT NULL
              AND cs.updated_at < now() - interval '1 hour'
            )
          )
      )::bigint AS recoverable_carts
    FROM public.ecommerce_cart_sessions cs
    LEFT JOIN public.ecommerce_orders linked
      ON linked.cart_session_id = cs.id
     AND linked.org_id = p_org_id
    WHERE cs.org_id = p_org_id
      AND cs.created_at >= v_attribution_start
      AND (
        NOT v_filtered
        OR (cs.created_at >= v_period_start AND cs.created_at < v_period_end)
      )
  )
  SELECT jsonb_build_object(
    'orders_total', om.orders_total,
    'orders_paid', om.orders_paid,
    'paid_revenue_ars', om.paid_revenue_ars,
    'attributed_orders', om.attributed_orders,
    'sessions_total', cm.sessions_total,
    'sessions_with_items', cm.sessions_with_items,
    'checkout_started_sessions', cm.checkout_started_sessions,
    'converted_sessions', cm.converted_sessions,
    'recoverable_carts', cm.recoverable_carts,
    'period_from', CASE WHEN v_filtered THEN v_from_date ELSE NULL END,
    'period_to', CASE WHEN v_filtered THEN v_to_date ELSE NULL END,
    'comparison', CASE WHEN v_filtered THEN jsonb_build_object(
      'period_from', v_previous_from_date,
      'period_to', v_previous_to_date,
      'orders_total', pom.orders_total,
      'orders_paid', pom.orders_paid,
      'paid_revenue_ars', pom.paid_revenue_ars
    ) ELSE NULL END,
    'attribution_started_at', v_attribution_start,
    'checkout_tracking_started_at', v_checkout_tracking_start,
    'snapshot_at', now()
  )
  INTO v_result
  FROM order_metrics om
  CROSS JOIN previous_order_metrics pom
  CROSS JOIN cart_metrics cm;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_store_performance_snapshot(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_store_performance_snapshot(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_store_performance_snapshot(uuid, date, date)
  TO authenticated;

COMMENT ON FUNCTION public.get_store_performance_snapshot(uuid, date, date) IS
  'KPI Commerce por organización y período argentino, con comparación anterior equivalente y embudo atribuible.';

DO $$
BEGIN
  IF to_regprocedure('public.get_store_performance_snapshot(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Verificación falló: sobrevivió la firma anterior del snapshot';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.get_store_performance_snapshot(uuid,date,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Verificación falló: anon puede ejecutar el snapshot privado';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.get_store_performance_snapshot(uuid,date,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Verificación falló: authenticated no puede ejecutar el snapshot';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260904000030', 'store_performance_period')
ON CONFLICT DO NOTHING;

COMMIT;
