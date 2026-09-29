-- ============================================================================
-- Alertas de presupuesto con compromisos (Mendel parity).
--
-- ── El defecto medido ──────────────────────────────────────────────────────
-- Dos capas de alerta ya existían y ninguna se usaba:
--   · `finance-budget-pulse` (Edge Function) persistía en
--     `finance_budget_alerts` y hacía broadcast a un canal que nadie
--     escuchaba — built-but-dark.
--   · `check-alerts` cron evaluaba métricas de stock contra
--     `smart_alert_rules`, pero ninguna métrica de presupuesto existía.
-- Y el compromiso (solicitudes aprobadas no pagadas de F5.2) no participaba:
-- una org agotaba el presupuesto con aprobaciones y la alerta veía cero.
--
-- ── Qué hace esta migración ────────────────────────────────────────────────
-- 1. `finance_evaluate_budget_alerts`: evaluación server-side (reusable por
--    Edge Function y cron) que mide ejecutado + comprometido por categoría,
--    escribe `finance_budget_alerts` con ack y registra en `alert_events`
--    (el canal que SmartAlerts ya muestra) con cooldown por categoría.
-- 2. Métricas de presupuesto para `smart_alert_rules`: `budget_spent_pct` y
--    `budget_committed_pct`, evaluadas por la misma RPC.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finance_evaluate_budget_alerts(
  p_org_id uuid,
  p_threshold_pct numeric DEFAULT 80
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_service boolean;
  v_allowed boolean;
  v_year integer := extract(year FROM current_date)::integer;
  v_month integer := extract(month FROM current_date)::integer;
  v_month_start date := date_trunc('month', current_date)::date;
  v_next_month date := (date_trunc('month', current_date) + interval '1 month')::date;
  v_inserted integer := 0;
  v_row record;
  v_committed_total numeric;
  v_spent_total numeric;
  v_assigned_total numeric;
  v_committed_pct numeric;
  v_spent_pct numeric;
  v_cooldown_min integer;
  v_recent timestamptz;
BEGIN
  -- Autoridad: administrador de la org, o la plataforma (cron/Edge Function).
  v_is_service := auth.jwt() ->> 'role' = 'service_role';
  IF NOT v_is_service THEN
    IF auth.uid() IS NULL
      OR NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner', 'admin'])
      OR NOT public.has_permission(p_org_id, 'finance', 'view') THEN
      RAISE EXCEPTION 'No tenés permiso para evaluar alertas en esta organización'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_row IN
    SELECT b.id AS budget_id, b.amount AS budget_amount,
           bc.source_key AS category_key, bc.name AS category_name,
           c.cooldown_min
    FROM public.budgets b
    JOIN public.budget_categories bc ON bc.id = b.category_id AND bc.org_id = b.org_id
    LEFT JOIN LATERAL (
      SELECT min(r.cooldown_min) AS cooldown_min
      FROM public.smart_alert_rules r
      WHERE r.org_id = b.org_id AND r.is_active AND r.category = 'finance'
        AND r.metric IN ('budget_spent_pct', 'budget_committed_pct')
    ) c ON true
    WHERE b.org_id = p_org_id AND b.year = v_year AND b.month = v_month
      AND bc.type = 'expense' AND bc.active AND bc.source_key IS NOT NULL
      AND b.amount > 0
  LOOP
    -- Ejecutado real del mes en esa categoría.
    SELECT COALESCE(sum(e.amount_ars), 0) INTO v_spent_total
    FROM public.expenses e
    WHERE e.org_id = p_org_id
      AND lower(trim(e.category)) = lower(v_row.category_key)
      AND e.date >= v_month_start AND e.date < v_next_month;

    -- Comprometido: solicitudes aprobadas no pagadas (F5.2), por categoría.
    SELECT COALESCE(sum(r.amount), 0) INTO v_committed_total
    FROM public.finance_expense_requests r
    WHERE r.org_id = p_org_id
      AND r.status = 'approved'
      AND lower(trim(coalesce(r.category, ''))) = lower(v_row.category_key)
      AND coalesce(r.approved_at, r.created_at) >= v_month_start
      AND coalesce(r.approved_at, r.created_at) < v_next_month;

    -- Un gasto registra el pago de una solicitud aprobada: el compromiso se
    -- libera al ejecutarse (no se cuenta dos veces).
    -- (r.status='approved' excluye 'paid' por definición del flujo F5.2.)

    v_spent_pct := CASE WHEN v_row.budget_amount > 0 THEN round(100.0 * v_spent_total / v_row.budget_amount, 2) ELSE 0 END;
    v_committed_pct := CASE WHEN v_row.budget_amount > 0 THEN round(100.0 * (v_spent_total + v_committed_total) / v_row.budget_amount, 2) ELSE 0 END;
    v_cooldown_min := COALESCE(v_row.cooldown_min, 240);

    SELECT max(created_at) INTO v_recent
    FROM public.alert_events
    WHERE org_id = p_org_id AND category = 'finance'
      AND rule_name = 'Presupuesto de ' || v_row.category_key
      AND created_at > now() - make_interval(mins => v_cooldown_min);

    -- Dispara cuando el total comprometido cruza el umbral (80% default) y
    -- hay algo nuevo que contar: sin nuevo compromiso no re-alerta.
    IF v_committed_pct >= p_threshold_pct AND v_committed_total > 0 THEN
      IF v_recent IS NULL THEN
        INSERT INTO public.alert_events (
          org_id, rule_name, category, priority, title, message,
          metric_value, threshold_value
        ) VALUES (
          p_org_id,
          'Presupuesto de ' || v_row.category_key,
          'finance',
          CASE WHEN v_committed_pct >= 100 THEN 'critical' ELSE 'high' END,
          'Presupuesto comprometido: ' || v_row.category_key,
          'Ejecutado ' || round(v_spent_total)::text
            || ' + comprometido ' || round(v_committed_total)
            || ' = ' || round(v_spent_total + v_committed_total)
            || ' sobre un presupuesto de ' || round(v_row.budget_amount)
            || ' (' || v_committed_pct::text || '%).',
          v_committed_pct, p_threshold_pct
        );
        v_inserted := v_inserted + 1;

        INSERT INTO public.finance_budget_alerts (
          org_id, year, month, category_key, budget, spent, pct, threshold_pct
        ) VALUES (
          p_org_id, v_year, v_month, v_row.category_key,
          v_row.budget_amount, v_spent_total + v_committed_total,
          v_committed_pct, p_threshold_pct
        )
        ON CONFLICT (org_id, year, month, category_key) DO UPDATE
          SET budget = EXCLUDED.budget,
              spent = EXCLUDED.spent,
              pct = EXCLUDED.pct,
              threshold_pct = EXCLUDED.threshold_pct;
      END IF;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.finance_evaluate_budget_alerts(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_evaluate_budget_alerts(uuid, numeric) TO authenticated;

-- ── Contrato versionado ─────────────────────────────────────────────────────
INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
VALUES (
  'finance_evaluate_budget_alerts', 'p_org_id uuid, p_threshold_pct numeric', 'authenticated_delegate',
  'Evalua ejecutado + comprometido por categoria y registra alertas con cooldown; la usa la Edge Function y el cron.',
  md5(pg_get_functiondef('public.finance_evaluate_budget_alerts(uuid,numeric)'::regprocedure)), DATE '2026-09-25'
)
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash,
      rationale = EXCLUDED.rationale,
      reviewed_on = EXCLUDED.reviewed_on;

-- ── Guardia ─────────────────────────────────────────────────────────────────
DO $guard$
DECLARE
  v_def text := pg_get_functiondef('public.finance_evaluate_budget_alerts(uuid,numeric)'::regprocedure);
BEGIN
  IF position('finance_expense_requests' IN v_def) = 0 THEN
    RAISE EXCEPTION 'finance_evaluate_budget_alerts no considera compromisos F5.2';
  END IF;
  IF position('alert_events' IN v_def) = 0 THEN
    RAISE EXCEPTION 'finance_evaluate_budget_alerts no escribe en el canal de SmartAlerts';
  END IF;
  IF position('cooldown_min' IN v_def) = 0 THEN
    RAISE EXCEPTION 'finance_evaluate_budget_alerts sin cooldown re-alerta en cada corrida';
  END IF;
  IF has_function_privilege('anon', 'public.finance_evaluate_budget_alerts(uuid,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon no puede evaluar alertas de presupuesto';
  END IF;
END $guard$;