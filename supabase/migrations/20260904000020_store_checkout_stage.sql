-- D5.22 / etapa real de checkout para el embudo Commerce.
--
-- `begin_checkout` ya se enviaba a herramientas externas, pero el comercio no
-- podía verlo en Nerqia. La señal queda ahora en la misma sesión canónica del
-- carrito: el navegador manda referencias y un token de capacidad; el servidor
-- vuelve a resolver precio/stock mediante `save_store_cart_v2` y marca la etapa
-- una sola vez. No se crea una tabla de analytics ni otro checkout paralelo.

ALTER TABLE public.ecommerce_cart_sessions
  ADD COLUMN IF NOT EXISTS checkout_started_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cart_sessions_org_checkout_started
  ON public.ecommerce_cart_sessions (org_id, checkout_started_at)
  WHERE checkout_started_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.start_store_checkout(
  p_slug text,
  p_token text,
  p_items jsonb,
  p_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_saved jsonb;
  v_cart_id uuid;
  v_started_at timestamptz;
BEGIN
  -- Reutiliza la autoridad del carrito: valida tienda/token, rate limit,
  -- normaliza líneas contra el Core y nunca confía en precios del navegador.
  v_saved := public.save_store_cart_v2(p_slug, p_token, p_items, p_email);
  IF COALESCE((v_saved->>'empty')::boolean, false)
     OR NULLIF(v_saved->>'id', '') IS NULL THEN
    RETURN v_saved || jsonb_build_object('checkout_started', false);
  END IF;

  v_cart_id := (v_saved->>'id')::uuid;
  UPDATE public.ecommerce_cart_sessions
  SET checkout_started_at = COALESCE(checkout_started_at, now())
  WHERE id = v_cart_id
    AND jsonb_typeof(items) = 'array'
    AND jsonb_array_length(items) > 0
  RETURNING checkout_started_at INTO v_started_at;

  RETURN v_saved || jsonb_build_object(
    'checkout_started', v_started_at IS NOT NULL,
    'checkout_started_at', v_started_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_store_checkout(text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_store_checkout(text, text, jsonb, text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.start_store_checkout(text, text, jsonb, text) IS
  'Persiste el carrito contra el Business Core y registra de forma idempotente el inicio del checkout.';

-- Conserva la firma consumida por la UI y agrega la etapa. Una orden enlazada
-- prueba que hubo checkout aunque se haya confirmado durante la ventana de
-- despliegue antes de que el marcador nuevo estuviera disponible.
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
  v_checkout_tracking_start constant timestamptz := '2026-09-04 03:41:11+00';
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
    'attribution_started_at', v_attribution_start,
    'checkout_tracking_started_at', v_checkout_tracking_start,
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

DO $$
BEGIN
  IF to_regprocedure('public.start_store_checkout(text,text,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'Verificación falló: falta start_store_checkout';
  END IF;
  IF has_function_privilege('anon', 'public.get_store_performance_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Verificación falló: anon puede ejecutar el snapshot privado';
  END IF;
  IF NOT has_function_privilege('anon', 'public.start_store_checkout(text,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Verificación falló: el comprador anónimo no puede marcar el checkout';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260904000020', 'store_checkout_stage')
ON CONFLICT DO NOTHING;
