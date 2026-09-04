-- D5.21 / analítica honesta de Commerce.
--
-- La pantalla cargaba como máximo 200 pedidos y los rotulaba "totales";
-- también sumaba como revenue cualquier orden creada hoy aunque siguiera
-- pendiente. El embudo, por su lado, mezclaba sesiones anteriores al carrito
-- canónico con pedidos que nunca tuvieron cart_session_id. Este snapshot hace
-- la agregación en servidor, con autorización por organización y un corte de
-- atribución explícito desde que el checkout empezó a enlazar carrito + orden.

CREATE INDEX IF NOT EXISTS idx_ecommerce_orders_cart_session
  ON public.ecommerce_orders (cart_session_id)
  WHERE cart_session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_store_performance_snapshot(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_attribution_start constant timestamptz := '2026-09-03 00:00:00+00';
  v_result jsonb;
BEGIN
  IF p_org_id IS NULL OR v_actor IS NULL
     OR NOT public.is_org_member(p_org_id, v_actor) THEN
    RAISE EXCEPTION 'No autorizado para consultar esta organización'
      USING ERRCODE = '42501';
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
  ),
  cart_metrics AS (
    SELECT
      count(DISTINCT cs.id)::bigint AS sessions_total,
      count(DISTINCT cs.id) FILTER (
        WHERE jsonb_typeof(cs.items) = 'array'
          AND jsonb_array_length(cs.items) > 0
      )::bigint AS sessions_with_items,
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
  )
  SELECT jsonb_build_object(
    'orders_total', om.orders_total,
    'orders_paid', om.orders_paid,
    'paid_revenue_ars', om.paid_revenue_ars,
    'attributed_orders', om.attributed_orders,
    'sessions_total', cm.sessions_total,
    'sessions_with_items', cm.sessions_with_items,
    'converted_sessions', cm.converted_sessions,
    'recoverable_carts', cm.recoverable_carts,
    'attribution_started_at', v_attribution_start,
    'snapshot_at', now()
  )
  INTO v_result
  FROM order_metrics om
  CROSS JOIN cart_metrics cm;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_store_performance_snapshot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_store_performance_snapshot(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_store_performance_snapshot(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_store_performance_snapshot(uuid) IS
  'KPI server-side de Commerce: pedidos y cobros exactos, embudo atribuible y carritos recuperables por organización.';

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_store_performance_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Verificación falló: anon puede ejecutar el snapshot privado';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_store_performance_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Verificación falló: authenticated no puede ejecutar el snapshot';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260904000010', 'store_performance_snapshot')
ON CONFLICT DO NOTHING;
