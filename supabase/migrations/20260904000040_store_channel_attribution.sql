-- D5.25 / adquisición propia, medible y sin píxeles publicitarios.
--
-- Un carrito dura hasta 30 días para poder recuperarse; una visita de analítica
-- dura 30 minutos. Usar `ecommerce_cart_sessions` como si fueran visitas hacía
-- que una persona que volvía durante un mes contara una sola vez y, peor, que
-- "Sesiones" significara en realidad "carritos con productos". Esta migración
-- separa ambos conceptos sin crear otro catálogo, checkout ni pedido.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ecommerce_store_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.ecommerce_stores(id) ON DELETE CASCADE,
  -- La capacidad que vive en el navegador nunca se guarda en claro.
  visit_token_hash text NOT NULL UNIQUE CHECK (length(visit_token_hash) = 64),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  -- Sólo hostname: nunca path, query string, email ni otra URL completa.
  referrer_host text,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  converted_at timestamptz,
  retained_until timestamptz NOT NULL DEFAULT now() + interval '13 months'
);

ALTER TABLE public.ecommerce_store_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ecommerce_store_visits FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_store_visits_org_started
  ON public.ecommerce_store_visits (org_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_visits_retention
  ON public.ecommerce_store_visits (retained_until);

ALTER TABLE public.ecommerce_cart_sessions
  ADD COLUMN IF NOT EXISTS visit_session_id uuid
    REFERENCES public.ecommerce_store_visits(id) ON DELETE SET NULL;

ALTER TABLE public.ecommerce_orders
  ADD COLUMN IF NOT EXISTS visit_session_id uuid
    REFERENCES public.ecommerce_store_visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cart_sessions_visit
  ON public.ecommerce_cart_sessions (visit_session_id)
  WHERE visit_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ecommerce_orders_visit
  ON public.ecommerce_orders (visit_session_id)
  WHERE visit_session_id IS NOT NULL;

-- Clasificación conservadora de primera interacción. Una fuente desconocida
-- queda en "other": no se fuerza a search/social para mejorar una métrica.
CREATE OR REPLACE FUNCTION public.store_traffic_channel(
  p_source text,
  p_medium text,
  p_referrer_host text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN lower(COALESCE(p_medium, '')) ~
      '(^|[^a-z])(cpc|ppc|paid|paidsearch|paid_social|paidsocial|display|cpm|cpv|cpa|affiliate)([^a-z]|$)'
      THEN 'paid'
    WHEN lower(COALESCE(p_medium, '')) ~ 'email|newsletter'
      OR lower(COALESCE(p_source, '')) ~ 'email|newsletter|mailchimp|klaviyo'
      THEN 'email'
    WHEN lower(COALESCE(p_medium, '')) ~ 'social|social-network|social-media'
      OR lower(COALESCE(p_source, '')) ~
        'facebook|instagram|tiktok|linkedin|pinterest|youtube|twitter|whatsapp'
      OR lower(COALESCE(p_referrer_host, '')) ~
        'facebook|instagram|tiktok|linkedin|pinterest|youtube|twitter|t\.co|wa\.me'
      THEN 'social'
    WHEN lower(COALESCE(p_medium, '')) = 'organic'
      OR lower(COALESCE(p_source, '')) ~
        '(^|\.)(google|bing|yahoo|duckduckgo|ecosia)(\.|$)'
      OR lower(COALESCE(p_referrer_host, '')) ~
        '(^|\.)(google|bing|yahoo|duckduckgo|ecosia)(\.|$)'
      THEN 'organic_search'
    WHEN NULLIF(btrim(p_referrer_host), '') IS NOT NULL THEN 'referral'
    WHEN NULLIF(btrim(p_source), '') IS NOT NULL
      OR NULLIF(btrim(p_medium), '') IS NOT NULL THEN 'other'
    ELSE 'direct'
  END;
$$;

REVOKE ALL ON FUNCTION public.store_traffic_channel(text, text, text) FROM PUBLIC;

-- Una llamada por carga pública. El servidor valida, minimiza y conserva la
-- primera fuente no vacía. No recibe IP, user-agent, URL ni identidad.
CREATE OR REPLACE FUNCTION public.record_store_visit(
  p_slug text,
  p_visit_token text,
  p_attribution jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store record;
  v_hash text;
  v_source text;
  v_medium text;
  v_campaign text;
  v_referrer text;
  v_visit public.ecommerce_store_visits%ROWTYPE;
BEGIN
  IF p_visit_token IS NULL OR length(p_visit_token) < 32
     OR length(p_visit_token) > 128
     OR p_visit_token !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Identificador de visita inválido' USING ERRCODE = '22023';
  END IF;
  IF p_attribution IS NULL OR jsonb_typeof(p_attribution) <> 'object' THEN
    RAISE EXCEPTION 'Atribución de visita inválida' USING ERRCODE = '22023';
  END IF;

  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores
  WHERE lower(slug) = lower(p_slug) AND is_active
  LIMIT 1;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada o inactiva';
  END IF;

  IF NOT public.rate_limit_publico('store_visit', p_slug, 120, interval '1 minute') THEN
    RAISE EXCEPTION 'Demasiadas visitas. Esperá un minuto.' USING ERRCODE = '53400';
  END IF;

  v_hash := encode(
    extensions.digest(convert_to(p_visit_token, 'UTF8'), 'sha256'::text),
    'hex'
  );
  v_source := NULLIF(left(lower(btrim(regexp_replace(
    COALESCE(p_attribution->>'utm_source', ''), '[[:cntrl:]]', '', 'g'
  ))), 100), '');
  v_medium := NULLIF(left(lower(btrim(regexp_replace(
    COALESCE(p_attribution->>'utm_medium', ''), '[[:cntrl:]]', '', 'g'
  ))), 100), '');
  v_campaign := NULLIF(left(btrim(regexp_replace(
    COALESCE(p_attribution->>'utm_campaign', ''), '[[:cntrl:]]', '', 'g'
  )), 160), '');
  v_referrer := NULLIF(left(lower(btrim(
    COALESCE(p_attribution->>'referrer_host', '')
  )), 253), '');
  IF v_referrer IS NOT NULL AND v_referrer !~ '^[a-z0-9.-]+$' THEN
    v_referrer := NULL;
  END IF;

  INSERT INTO public.ecommerce_store_visits (
    org_id, store_id, visit_token_hash, utm_source, utm_medium,
    utm_campaign, referrer_host
  ) VALUES (
    v_store.org_id, v_store.id, v_hash, v_source, v_medium,
    v_campaign, v_referrer
  )
  ON CONFLICT (visit_token_hash) DO NOTHING;

  SELECT * INTO v_visit
  FROM public.ecommerce_store_visits
  WHERE visit_token_hash = v_hash
  FOR UPDATE;

  IF v_visit.id IS NULL OR v_visit.store_id <> v_store.id THEN
    RAISE EXCEPTION 'La visita pertenece a otra tienda' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ecommerce_store_visits
  SET last_seen_at = now(),
      utm_source = COALESCE(utm_source, v_source),
      utm_medium = COALESCE(utm_medium, v_medium),
      utm_campaign = COALESCE(utm_campaign, v_campaign),
      referrer_host = COALESCE(referrer_host, v_referrer)
  WHERE id = v_visit.id
  RETURNING * INTO v_visit;

  RETURN jsonb_build_object(
    'ok', true,
    'channel', public.store_traffic_channel(
      v_visit.utm_source, v_visit.utm_medium, v_visit.referrer_host
    ),
    'started_at', v_visit.started_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_store_visit(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_store_visit(text, text, jsonb)
  TO anon, authenticated;

-- Ventana de despliegue: v3 enlaza el carrito a la visita real y conserva v2
-- intacta para pestañas que todavía tienen el bundle anterior.
CREATE OR REPLACE FUNCTION public.save_store_cart_v3(
  p_slug text,
  p_token text,
  p_items jsonb,
  p_email text DEFAULT NULL,
  p_visit_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_saved jsonb;
  v_visit uuid;
  v_cart uuid;
BEGIN
  v_saved := public.save_store_cart_v2(p_slug, p_token, p_items, p_email);
  v_cart := NULLIF(v_saved->>'id', '')::uuid;

  IF v_cart IS NOT NULL AND p_visit_token IS NOT NULL THEN
    SELECT v.id INTO v_visit
    FROM public.ecommerce_store_visits v
    JOIN public.ecommerce_stores s ON s.id = v.store_id
    WHERE lower(s.slug) = lower(p_slug)
      AND v.visit_token_hash = encode(
        extensions.digest(convert_to(p_visit_token, 'UTF8'), 'sha256'::text),
        'hex'
      )
    LIMIT 1;

    IF v_visit IS NOT NULL THEN
      UPDATE public.ecommerce_cart_sessions
      SET visit_session_id = COALESCE(visit_session_id, v_visit)
      WHERE id = v_cart;
    END IF;
  END IF;

  RETURN v_saved || jsonb_build_object('visit_linked', v_visit IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.save_store_cart_v3(text, text, jsonb, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_store_cart_v3(text, text, jsonb, text, text)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_store_checkout_v2(
  p_slug text,
  p_token text,
  p_items jsonb,
  p_email text DEFAULT NULL,
  p_visit_token text DEFAULT NULL
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
  v_saved := public.save_store_cart_v3(
    p_slug, p_token, p_items, p_email, p_visit_token
  );
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

REVOKE ALL ON FUNCTION public.start_store_checkout_v2(text, text, jsonb, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_store_checkout_v2(text, text, jsonb, text, text)
  TO anon, authenticated;

-- La orden sigue naciendo en la autoridad existente. Sólo se propaga el vínculo
-- ya probado carrito→visita; no se confía en una fuente enviada en checkout.
CREATE OR REPLACE FUNCTION public.create_store_order_from_cart_idem(
  p_slug text,
  p_items jsonb,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text DEFAULT NULL,
  p_shipping jsonb DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_coupon text DEFAULT NULL,
  p_shipping_option text DEFAULT NULL,
  p_fiscal jsonb DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_cart_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_store record;
  v_store_customer uuid;
  v_cart uuid;
  v_visit uuid;
  v_order_number text;
BEGIN
  v_result := public.create_store_order_idem(
    p_slug, p_items, p_customer_name, p_customer_email, p_customer_phone,
    p_shipping, p_payment_method, p_notes, p_coupon, p_shipping_option,
    p_fiscal, p_idempotency_key);

  SELECT id, org_id INTO v_store
  FROM public.ecommerce_stores
  WHERE lower(slug) = lower(p_slug) AND is_active
  LIMIT 1;

  IF auth.uid() IS NOT NULL THEN
    SELECT id INTO v_store_customer
    FROM public.store_customers
    WHERE store_id = v_store.id AND user_id = auth.uid()
    LIMIT 1;
  END IF;

  SELECT cs.id, cs.visit_session_id INTO v_cart, v_visit
  FROM public.ecommerce_cart_sessions cs
  WHERE cs.store_id = v_store.id
    AND cs.status <> 'converted'
    AND (
      (p_cart_token IS NOT NULL AND cs.session_token = p_cart_token
        AND (cs.store_customer_id IS NULL OR cs.store_customer_id = v_store_customer)
        AND (cs.customer_email IS NULL OR
             lower(cs.customer_email) = lower(btrim(COALESCE(p_customer_email, '')))))
      OR (v_store_customer IS NOT NULL AND cs.store_customer_id = v_store_customer)
    )
  ORDER BY (cs.session_token = p_cart_token) DESC, cs.updated_at DESC
  LIMIT 1
  FOR UPDATE;

  v_order_number := v_result->>'order_number';
  IF v_cart IS NOT NULL AND v_order_number IS NOT NULL THEN
    UPDATE public.ecommerce_cart_sessions
    SET status = 'converted', converted_at = now(), revision = revision + 1,
        updated_at = now()
    WHERE id = v_cart;

    UPDATE public.ecommerce_orders o
    SET cart_session_id = v_cart,
        visit_session_id = COALESCE(o.visit_session_id, v_visit),
        utm_source = COALESCE(
          o.utm_source,
          (SELECT sv.utm_source FROM public.ecommerce_store_visits sv
           WHERE sv.id = v_visit)
        )
    WHERE o.store_id = v_store.id
      AND o.order_number = v_order_number
      AND (o.cart_session_id IS NULL OR o.cart_session_id = v_cart);

    UPDATE public.ecommerce_store_visits
    SET converted_at = COALESCE(converted_at, now())
    WHERE id = v_visit;
  END IF;

  RETURN v_result || jsonb_build_object(
    'cart_linked', v_cart IS NOT NULL,
    'visit_linked', v_visit IS NOT NULL
  );
END;
$$;

-- Snapshot único de Commerce: órdenes por fecha de orden y embudo/canales por
-- cohorte de visita. La conversión por canal nunca puede superar sus visitas.
CREATE OR REPLACE FUNCTION public.get_store_performance_snapshot(
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
  v_visit_tracking_start constant timestamptz := '2026-09-04 00:00:00+00';
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

  WITH visit_scope AS (
    SELECT
      v.id,
      public.store_traffic_channel(
        v.utm_source, v.utm_medium, v.referrer_host
      ) AS channel
    FROM public.ecommerce_store_visits v
    WHERE v.org_id = p_org_id
      AND v.started_at >= v_visit_tracking_start
      AND (
        NOT v_filtered
        OR (v.started_at >= v_period_start AND v.started_at < v_period_end)
      )
  ),
  visit_facts AS (
    SELECT
      vs.id,
      vs.channel,
      EXISTS (
        SELECT 1 FROM public.ecommerce_cart_sessions cs
        WHERE cs.visit_session_id = vs.id
          AND jsonb_typeof(cs.items) = 'array'
          AND jsonb_array_length(cs.items) > 0
      ) OR EXISTS (
        SELECT 1 FROM public.ecommerce_orders o
        WHERE o.visit_session_id = vs.id
      ) AS with_items,
      EXISTS (
        SELECT 1 FROM public.ecommerce_cart_sessions cs
        WHERE cs.visit_session_id = vs.id
          AND cs.checkout_started_at IS NOT NULL
      ) OR EXISTS (
        SELECT 1 FROM public.ecommerce_orders o
        WHERE o.visit_session_id = vs.id
      ) AS checkout_started,
      EXISTS (
        SELECT 1 FROM public.ecommerce_orders o
        WHERE o.visit_session_id = vs.id
      ) AS converted
    FROM visit_scope vs
  ),
  order_metrics AS (
    SELECT
      count(*)::bigint AS orders_total,
      count(*) FILTER (WHERE payment_status = 'paid')::bigint AS orders_paid,
      COALESCE(sum(total) FILTER (WHERE payment_status = 'paid'), 0)::numeric
        AS paid_revenue_ars,
      count(*) FILTER (WHERE visit_session_id IS NOT NULL)::bigint
        AS attributed_orders
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
  visit_metrics AS (
    SELECT
      count(*)::bigint AS sessions_total,
      count(*) FILTER (WHERE with_items)::bigint AS sessions_with_items,
      count(*) FILTER (WHERE checkout_started)::bigint AS checkout_started_sessions,
      count(*) FILTER (WHERE converted)::bigint AS converted_sessions
    FROM visit_facts
  ),
  recovery_metrics AS (
    SELECT count(*)::bigint AS recoverable_carts
    FROM public.ecommerce_cart_sessions cs
    WHERE cs.org_id = p_org_id
      AND jsonb_typeof(cs.items) = 'array'
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
  ),
  channel_metrics AS (
    SELECT
      vf.channel,
      count(DISTINCT vf.id)::bigint AS sessions,
      count(DISTINCT vf.id) FILTER (WHERE vf.with_items)::bigint AS sessions_with_items,
      count(DISTINCT vf.id) FILTER (WHERE vf.checkout_started)::bigint AS checkout_started_sessions,
      count(DISTINCT vf.id) FILTER (WHERE vf.converted)::bigint AS converted_sessions,
      count(o.id)::bigint AS orders,
      count(o.id) FILTER (WHERE o.payment_status = 'paid')::bigint AS orders_paid,
      COALESCE(sum(o.total) FILTER (WHERE o.payment_status = 'paid'), 0)::numeric
        AS paid_revenue_ars
    FROM visit_facts vf
    LEFT JOIN public.ecommerce_orders o ON o.visit_session_id = vf.id
    GROUP BY vf.channel
  ),
  channels AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'channel', channel,
        'sessions', sessions,
        'sessions_with_items', sessions_with_items,
        'checkout_started_sessions', checkout_started_sessions,
        'converted_sessions', converted_sessions,
        'orders', orders,
        'orders_paid', orders_paid,
        'paid_revenue_ars', paid_revenue_ars
      ) ORDER BY paid_revenue_ars DESC, sessions DESC, channel
    ), '[]'::jsonb) AS rows
    FROM channel_metrics
  )
  SELECT jsonb_build_object(
    'orders_total', om.orders_total,
    'orders_paid', om.orders_paid,
    'paid_revenue_ars', om.paid_revenue_ars,
    'attributed_orders', om.attributed_orders,
    'sessions_total', vm.sessions_total,
    'sessions_with_items', vm.sessions_with_items,
    'checkout_started_sessions', vm.checkout_started_sessions,
    'converted_sessions', vm.converted_sessions,
    'recoverable_carts', rm.recoverable_carts,
    'channels', ch.rows,
    'period_from', CASE WHEN v_filtered THEN v_from_date ELSE NULL END,
    'period_to', CASE WHEN v_filtered THEN v_to_date ELSE NULL END,
    'comparison', CASE WHEN v_filtered THEN jsonb_build_object(
      'period_from', v_previous_from_date,
      'period_to', v_previous_to_date,
      'orders_total', pom.orders_total,
      'orders_paid', pom.orders_paid,
      'paid_revenue_ars', pom.paid_revenue_ars
    ) ELSE NULL END,
    'attribution_started_at', v_visit_tracking_start,
    'checkout_tracking_started_at', v_checkout_tracking_start,
    'visit_retention_months', 13,
    'snapshot_at', now()
  )
  INTO v_result
  FROM order_metrics om
  CROSS JOIN previous_order_metrics pom
  CROSS JOIN visit_metrics vm
  CROSS JOIN recovery_metrics rm
  CROSS JOIN channels ch;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.prune_store_visits()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  DELETE FROM public.ecommerce_store_visits
  WHERE retained_until < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_store_visits() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'podar-visitas-tienda',
      '41 4 * * *',
      'SELECT public.prune_store_visits()'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_store_performance_snapshot(uuid, date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_store_performance_snapshot(uuid, date, date)
  TO authenticated;

COMMENT ON TABLE public.ecommerce_store_visits IS
  'Sesiones first-party de 30 minutos generadas por la tienda; token hasheado, atribución mínima y retención de 13 meses.';
COMMENT ON FUNCTION public.record_store_visit(text, text, jsonb) IS
  'Registra una visita first-party sin PII, IP, user-agent ni URL completa; conserva la primera fuente observada.';
COMMENT ON FUNCTION public.get_store_performance_snapshot(uuid, date, date) IS
  'KPI Commerce: órdenes por fecha y embudo/canales por cohorte de visita real, tenant-safe.';

DO $$
BEGIN
  IF has_function_privilege(
    'anon', 'public.get_store_performance_snapshot(uuid,date,date)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Verificación falló: anon puede leer analytics privados';
  END IF;
  IF NOT has_function_privilege(
    'anon', 'public.record_store_visit(text,text,jsonb)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Verificación falló: anon no puede registrar la visita pública';
  END IF;
  IF has_table_privilege('anon', 'public.ecommerce_store_visits', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ecommerce_store_visits', 'SELECT') THEN
    RAISE EXCEPTION 'Verificación falló: la tabla de visitas tiene lectura directa';
  END IF;
  IF public.store_traffic_channel('google', 'cpc', NULL) <> 'paid'
     OR public.store_traffic_channel(NULL, NULL, NULL) <> 'direct'
     OR public.store_traffic_channel(NULL, NULL, 'google.com') <> 'organic_search' THEN
    RAISE EXCEPTION 'Verificación falló: clasificación de canal inesperada';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260904000040', 'store_channel_attribution')
ON CONFLICT DO NOTHING;

COMMIT;
