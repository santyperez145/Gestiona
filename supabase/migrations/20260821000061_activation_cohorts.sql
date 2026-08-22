-- Cohortes de activación y costo de acompañamiento.
--
-- Una lista de organizaciones ordenada por fecha no es una cohorte. Esta
-- migración mide por mes la primera venta en el canal que el comercio eligió,
-- separa activación autoservicio de activación acompañada y registra minutos
-- de soporte sin notas libres, PII ni acceso al negocio del tenant.

CREATE TABLE IF NOT EXISTS public.activation_interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  milestone text NOT NULL,
  intervention_type text NOT NULL,
  minutes_spent integer NOT NULL,
  outcome text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid,
  CONSTRAINT activation_interventions_actor_key_unique
    UNIQUE (actor_user_id, idempotency_key),
  CONSTRAINT activation_interventions_milestone_check
    CHECK (milestone IN (
      'identity', 'catalog', 'stock', 'channel', 'payment',
      'shipping', 'fiscal', 'sale', 'general'
    )),
  CONSTRAINT activation_interventions_type_check
    CHECK (intervention_type IN (
      'onboarding_call', 'data_import', 'configuration', 'training',
      'bug_workaround', 'commercial_followup', 'other'
    )),
  CONSTRAINT activation_interventions_minutes_check
    CHECK (minutes_spent BETWEEN 1 AND 480),
  CONSTRAINT activation_interventions_outcome_check
    CHECK (outcome IN ('resolved', 'follow_up', 'blocked_external', 'no_change')),
  CONSTRAINT activation_interventions_void_check
    CHECK ((voided_at IS NULL AND voided_by IS NULL) OR (voided_at IS NOT NULL AND voided_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_activation_interventions_org_time
  ON public.activation_interventions (org_id, occurred_at DESC)
  WHERE voided_at IS NULL;

COMMENT ON TABLE public.activation_interventions IS
  'Eventos estructurados de acompañamiento a la primera venta. No admite notas libres ni datos de clientes.';
COMMENT ON COLUMN public.activation_interventions.idempotency_key IS
  'Clave del intento de UI; repetirla con los mismos datos devuelve el evento existente.';

ALTER TABLE public.activation_interventions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activation_interventions FROM PUBLIC, anon, authenticated;

-- Un cero anterior al inicio de la medición significa "no instrumentado", no
-- "cero ayuda". El watermark impide presentar activaciones históricas como
-- autoservicio sólo porque todavía no existía esta tabla.
CREATE TABLE IF NOT EXISTS public.platform_metric_watermarks (
  metric_key text PRIMARY KEY,
  reliable_from timestamptz NOT NULL,
  definition text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_metric_watermarks (metric_key, reliable_from, definition)
VALUES (
  'activation_support_cost',
  now(),
  'Activación autoservicio y minutos de ayuda son confiables sólo para organizaciones creadas después de este instante.'
)
ON CONFLICT (metric_key) DO NOTHING;

ALTER TABLE public.platform_metric_watermarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_metric_watermarks FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_activation_intervention(
  p_org_id uuid,
  p_idempotency_key uuid,
  p_milestone text,
  p_intervention_type text,
  p_minutes_spent integer,
  p_outcome text,
  p_occurred_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_org_created_at timestamptz;
  v_existing public.activation_interventions;
  v_saved public.activation_interventions;
  v_occurred_at timestamptz := COALESCE(p_occurred_at, now());
BEGIN
  IF v_actor IS NULL OR NOT public.has_platform_role(ARRAY['support'], v_actor) THEN
    RAISE EXCEPTION 'Unauthorized: requires platform support role';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required';
  END IF;
  IF p_milestone IS NULL OR p_milestone NOT IN (
    'identity', 'catalog', 'stock', 'channel', 'payment',
    'shipping', 'fiscal', 'sale', 'general'
  ) THEN
    RAISE EXCEPTION 'Invalid activation milestone';
  END IF;
  IF p_intervention_type IS NULL OR p_intervention_type NOT IN (
    'onboarding_call', 'data_import', 'configuration', 'training',
    'bug_workaround', 'commercial_followup', 'other'
  ) THEN
    RAISE EXCEPTION 'Invalid intervention type';
  END IF;
  IF p_minutes_spent IS NULL OR p_minutes_spent NOT BETWEEN 1 AND 480 THEN
    RAISE EXCEPTION 'Minutes must be between 1 and 480';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN (
    'resolved', 'follow_up', 'blocked_external', 'no_change'
  ) THEN
    RAISE EXCEPTION 'Invalid intervention outcome';
  END IF;

  SELECT created_at INTO v_org_created_at
  FROM public.organizations
  WHERE id = p_org_id;

  IF v_org_created_at IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;
  IF v_occurred_at < v_org_created_at OR v_occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Intervention time is outside the organization lifecycle';
  END IF;

  SELECT * INTO v_existing
  FROM public.activation_interventions
  WHERE actor_user_id = v_actor
    AND idempotency_key = p_idempotency_key;

  IF v_existing.id IS NOT NULL THEN
    IF ROW(
      v_existing.org_id, v_existing.milestone, v_existing.intervention_type,
      v_existing.minutes_spent, v_existing.outcome
    ) IS DISTINCT FROM ROW(
      p_org_id, p_milestone, p_intervention_type,
      p_minutes_spent, p_outcome
    ) OR (
      p_occurred_at IS NOT NULL
      AND v_existing.occurred_at IS DISTINCT FROM p_occurred_at
    ) THEN
      RAISE EXCEPTION 'Idempotency key was already used with different data';
    END IF;
    v_saved := v_existing;
  ELSE
    INSERT INTO public.activation_interventions (
      org_id, actor_user_id, idempotency_key, milestone,
      intervention_type, minutes_spent, outcome, occurred_at
    ) VALUES (
      p_org_id, v_actor, p_idempotency_key, p_milestone,
      p_intervention_type, p_minutes_spent, p_outcome, v_occurred_at
    )
    RETURNING * INTO v_saved;
  END IF;

  RETURN jsonb_build_object(
    'id', v_saved.id,
    'org_id', v_saved.org_id,
    'milestone', v_saved.milestone,
    'intervention_type', v_saved.intervention_type,
    'minutes_spent', v_saved.minutes_spent,
    'outcome', v_saved.outcome,
    'occurred_at', v_saved.occurred_at,
    'created_at', v_saved.created_at,
    'voided_at', v_saved.voided_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.void_activation_intervention(p_intervention_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_saved public.activation_interventions;
BEGIN
  IF v_actor IS NULL OR NOT public.has_platform_role(ARRAY['support'], v_actor) THEN
    RAISE EXCEPTION 'Unauthorized: requires platform support role';
  END IF;

  UPDATE public.activation_interventions
  SET voided_at = COALESCE(voided_at, now()),
      voided_by = COALESCE(voided_by, v_actor)
  WHERE id = p_intervention_id
  RETURNING * INTO v_saved;

  IF v_saved.id IS NULL THEN
    RAISE EXCEPTION 'Activation intervention not found';
  END IF;

  RETURN jsonb_build_object(
    'id', v_saved.id,
    'org_id', v_saved.org_id,
    'voided_at', v_saved.voided_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_activation_intervention(
  uuid, uuid, text, text, integer, text, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_activation_intervention(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_activation_intervention(
  uuid, uuid, text, text, integer, text, timestamptz
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_activation_intervention(uuid) TO authenticated;

-- Lectura segura para Merchant 360. Los identificadores de staff permanecen
-- en la tabla de auditoría y no llegan al navegador.
CREATE OR REPLACE VIEW public.platform_activation_interventions AS
SELECT
  i.id,
  i.org_id,
  i.milestone,
  i.intervention_type,
  i.minutes_spent,
  i.outcome,
  i.occurred_at,
  i.created_at,
  i.voided_at,
  (i.voided_at IS NULL) AS is_active
FROM public.activation_interventions i
WHERE public.is_platform_admin(auth.uid());

ALTER VIEW public.platform_activation_interventions SET (security_invoker = false);
REVOKE ALL ON public.platform_activation_interventions FROM PUBLIC, anon;
GRANT SELECT ON public.platform_activation_interventions TO authenticated;

COMMENT ON VIEW public.platform_activation_interventions IS
  'Acompañamiento estructurado visible a staff; excluye actor, idempotency key, PII y notas libres.';

-- Una fila por organización. `activated` usa la primera venta del canal
-- objetivo; vender por otro canal no infla la conversión del onboarding.
CREATE OR REPLACE VIEW public.platform_activation_cohort_members AS
WITH readiness AS (
  SELECT
    o.id AS org_id,
    o.name AS org_name,
    o.slug,
    o.created_at AS org_created_at,
    date_trunc('month', o.created_at)::date AS cohort_month,
    r.onboarding_goal,
    r.identity_ready,
    r.legal_ready,
    r.catalog_ready,
    r.stock_ready,
    r.online_channel_ready,
    r.online_payment_ready,
    r.online_shipping_ready,
    r.fiscal_ready,
    r.pos_sales_total,
    r.online_orders_total,
    r.first_pos_sale_at,
    r.first_online_sale_at,
    CASE
      WHEN r.onboarding_goal = 'pos' THEN r.first_pos_sale_at
      WHEN r.onboarding_goal = 'online' THEN r.first_online_sale_at
      ELSE NULL
    END AS first_target_sale_at
  FROM public.organizations o
  JOIN public.organization_activation_readiness r ON r.org_id = o.id
  WHERE public.is_platform_admin(auth.uid())
), scored AS (
  SELECT
    r.*,
    (
      CASE WHEN COALESCE(r.identity_ready, false)
                  AND (r.onboarding_goal <> 'online' OR COALESCE(r.legal_ready, false)) THEN 1 ELSE 0 END
      + CASE WHEN COALESCE(r.catalog_ready, false) THEN 1 ELSE 0 END
      + CASE WHEN COALESCE(r.stock_ready, false) THEN 1 ELSE 0 END
      + CASE WHEN r.onboarding_goal IN ('pos', 'online')
                  AND (r.onboarding_goal <> 'online' OR COALESCE(r.online_channel_ready, false)) THEN 1 ELSE 0 END
      + CASE WHEN r.onboarding_goal IN ('pos', 'online')
                  AND (r.onboarding_goal <> 'online' OR COALESCE(r.online_payment_ready, false)) THEN 1 ELSE 0 END
      + CASE WHEN r.onboarding_goal IN ('pos', 'online')
                  AND (r.onboarding_goal <> 'online' OR COALESCE(r.online_shipping_ready, false)) THEN 1 ELSE 0 END
      + CASE WHEN COALESCE(r.fiscal_ready, false) THEN 1 ELSE 0 END
      + CASE
          WHEN r.onboarding_goal = 'pos' AND COALESCE(r.pos_sales_total, 0) > 0 THEN 1
          WHEN r.onboarding_goal = 'online' AND COALESCE(r.online_orders_total, 0) > 0 THEN 1
          ELSE 0
        END
    )::integer AS readiness_done_count
  FROM readiness r
), measurement AS (
  SELECT reliable_from AS support_measurement_started_at
  FROM public.platform_metric_watermarks
  WHERE metric_key = 'activation_support_cost'
), intervention_cost AS (
  SELECT
    s.org_id,
    COUNT(i.id) FILTER (
      WHERE i.voided_at IS NULL
        AND (s.first_target_sale_at IS NULL OR i.occurred_at <= s.first_target_sale_at)
    )::integer AS activation_intervention_count,
    COALESCE(SUM(i.minutes_spent) FILTER (
      WHERE i.voided_at IS NULL
        AND (s.first_target_sale_at IS NULL OR i.occurred_at <= s.first_target_sale_at)
    ), 0)::integer AS activation_intervention_minutes,
    MIN(i.occurred_at) FILTER (WHERE i.voided_at IS NULL) AS first_intervention_at,
    MAX(i.occurred_at) FILTER (WHERE i.voided_at IS NULL) AS last_intervention_at
  FROM scored s
  LEFT JOIN public.activation_interventions i ON i.org_id = s.org_id
  GROUP BY s.org_id
)
SELECT
  -- La expresión conserva UUID pero corta el linaje FK automático de PostgREST:
  -- de otro modo esta vista Platform aparece como relación inversa de cada
  -- tabla tenant en los tipos generados.
  (s.org_id::text || '')::uuid AS org_id,
  s.org_name,
  s.slug,
  s.org_created_at,
  s.cohort_month,
  s.onboarding_goal,
  s.readiness_done_count,
  8::integer AS readiness_total,
  s.first_target_sale_at,
  (s.first_target_sale_at IS NOT NULL) AS activated,
  CASE WHEN s.first_target_sale_at IS NULL THEN NULL ELSE
    round((GREATEST(0, EXTRACT(EPOCH FROM (s.first_target_sale_at - s.org_created_at))) / 86400.0)::numeric, 1)
  END AS days_to_first_sale,
  COALESCE(c.activation_intervention_count, 0) AS activation_intervention_count,
  COALESCE(c.activation_intervention_minutes, 0) AS activation_intervention_minutes,
  c.first_intervention_at,
  c.last_intervention_at,
  (
    s.org_created_at >= measurement.support_measurement_started_at
    AND s.first_target_sale_at IS NOT NULL
    AND COALESCE(c.activation_intervention_count, 0) = 0
  ) AS self_service_activated,
  (
    s.org_created_at >= measurement.support_measurement_started_at
    AND s.first_target_sale_at IS NOT NULL
    AND COALESCE(c.activation_intervention_count, 0) > 0
  ) AS supported_activated,
  measurement.support_measurement_started_at,
  (s.org_created_at >= measurement.support_measurement_started_at) AS support_measurement_eligible
FROM scored s
CROSS JOIN measurement
LEFT JOIN intervention_cost c ON c.org_id = s.org_id;

ALTER VIEW public.platform_activation_cohort_members SET (security_invoker = false);
REVOKE ALL ON public.platform_activation_cohort_members FROM PUBLIC, anon;
GRANT SELECT ON public.platform_activation_cohort_members TO authenticated;

COMMENT ON VIEW public.platform_activation_cohort_members IS
  'Una fila por organización con primera venta del canal objetivo, hitos y costo de ayuda previo a activar.';

-- Tasas 7/14/30 sólo usan cohortes maduras: una alta de ayer todavía no puede
-- entrar en el denominador de 30 días.
CREATE OR REPLACE VIEW public.platform_activation_cohorts AS
SELECT
  m.cohort_month,
  COUNT(*)::integer AS organizations_total,
  COUNT(*) FILTER (WHERE m.activated)::integer AS activated_total,
  COUNT(*) FILTER (WHERE NOT m.activated)::integer AS pending_total,
  COUNT(*) FILTER (WHERE m.self_service_activated)::integer AS self_service_activated_total,
  COUNT(*) FILTER (WHERE m.supported_activated)::integer AS supported_activated_total,
  COUNT(*) FILTER (WHERE m.org_created_at <= now() - interval '7 days')::integer AS eligible_7d_total,
  COUNT(*) FILTER (
    WHERE m.org_created_at <= now() - interval '7 days'
      AND m.days_to_first_sale <= 7
  )::integer AS activated_7d_total,
  COUNT(*) FILTER (WHERE m.org_created_at <= now() - interval '14 days')::integer AS eligible_14d_total,
  COUNT(*) FILTER (
    WHERE m.org_created_at <= now() - interval '14 days'
      AND m.days_to_first_sale <= 14
  )::integer AS activated_14d_total,
  COUNT(*) FILTER (WHERE m.org_created_at <= now() - interval '30 days')::integer AS eligible_30d_total,
  COUNT(*) FILTER (
    WHERE m.org_created_at <= now() - interval '30 days'
      AND m.days_to_first_sale <= 30
  )::integer AS activated_30d_total,
  round(100.0 * COUNT(*) FILTER (WHERE m.activated) / NULLIF(COUNT(*), 0), 1) AS activation_rate_pct,
  round(100.0 * COUNT(*) FILTER (WHERE m.self_service_activated)
    / NULLIF(COUNT(*) FILTER (WHERE m.activated AND m.support_measurement_eligible), 0), 1) AS self_service_rate_pct,
  round(100.0 * COUNT(*) FILTER (WHERE m.org_created_at <= now() - interval '7 days' AND m.days_to_first_sale <= 7)
    / NULLIF(COUNT(*) FILTER (WHERE m.org_created_at <= now() - interval '7 days'), 0), 1) AS activation_7d_rate_pct,
  round(100.0 * COUNT(*) FILTER (WHERE m.org_created_at <= now() - interval '14 days' AND m.days_to_first_sale <= 14)
    / NULLIF(COUNT(*) FILTER (WHERE m.org_created_at <= now() - interval '14 days'), 0), 1) AS activation_14d_rate_pct,
  round(100.0 * COUNT(*) FILTER (WHERE m.org_created_at <= now() - interval '30 days' AND m.days_to_first_sale <= 30)
    / NULLIF(COUNT(*) FILTER (WHERE m.org_created_at <= now() - interval '30 days'), 0), 1) AS activation_30d_rate_pct,
  COALESCE(SUM(m.activation_intervention_count) FILTER (WHERE m.support_measurement_eligible), 0)::integer AS activation_interventions_total,
  COALESCE(SUM(m.activation_intervention_minutes) FILTER (WHERE m.support_measurement_eligible), 0)::integer AS activation_intervention_minutes,
  round(
    COALESCE(SUM(m.activation_intervention_minutes) FILTER (WHERE m.support_measurement_eligible), 0)::numeric
    / NULLIF(COUNT(*) FILTER (WHERE m.support_measurement_eligible), 0),
    1
  ) AS avg_support_minutes_per_org,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY m.days_to_first_sale)::numeric, 1) AS median_days_to_first_sale,
  COUNT(*) FILTER (WHERE m.support_measurement_eligible)::integer AS support_measurement_eligible_total
FROM public.platform_activation_cohort_members m
GROUP BY m.cohort_month
ORDER BY m.cohort_month DESC;

ALTER VIEW public.platform_activation_cohorts SET (security_invoker = false);
REVOKE ALL ON public.platform_activation_cohorts FROM PUBLIC, anon;
GRANT SELECT ON public.platform_activation_cohorts TO authenticated;

COMMENT ON VIEW public.platform_activation_cohorts IS
  'Conversión mensual a primera venta del canal objetivo, tasas maduras y costo estructurado de acompañamiento.';

DO $$
DECLARE
  v_sensitive_columns integer;
BEGIN
  SELECT count(*) INTO v_sensitive_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN (
      'platform_activation_interventions',
      'platform_activation_cohort_members',
      'platform_activation_cohorts'
    )
    AND column_name IN (
      'actor_user_id', 'voided_by', 'idempotency_key', 'notes', 'email',
      'customer_name', 'customer_phone', 'customer_address', 'cuit',
      'access_token', 'refresh_token', 'api_key', 'private_key', 'certificate'
    );

  IF v_sensitive_columns <> 0 THEN
    RAISE EXCEPTION 'Las vistas de cohortes exponen % columnas sensibles', v_sensitive_columns;
  END IF;
  IF has_table_privilege('anon', 'public.activation_interventions', 'SELECT')
     OR has_table_privilege('anon', 'public.platform_activation_interventions', 'SELECT')
     OR has_table_privilege('anon', 'public.platform_activation_cohort_members', 'SELECT')
     OR has_table_privilege('anon', 'public.platform_activation_cohorts', 'SELECT') THEN
    RAISE EXCEPTION 'Las cohortes de plataforma quedaron visibles para anon';
  END IF;
  IF has_table_privilege('authenticated', 'public.activation_interventions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.activation_interventions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.activation_interventions', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated puede mutar la auditoría sin RPC';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260821000061', 'activation_cohorts') ON CONFLICT DO NOTHING;
