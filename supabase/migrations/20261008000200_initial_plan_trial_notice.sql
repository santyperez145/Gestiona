BEGIN;

-- The hourly cron marks expired trials past_due. A free trial is not unpaid debt.
CREATE OR REPLACE FUNCTION public.org_entitlements(p_org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_sub public.subscriptions;
  v_plan public.plans;
  v_base public.plans;
  v_dias int := 0;
  v_motivo text := NULL;
  v_vigente boolean;
  v_nunca_se_cobro boolean;
  v_trial_ends timestamptz;
  v_cupo int;
  v_usado int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta organización' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_sub FROM public.subscriptions WHERE org_id = p_org;
  SELECT * INTO v_base FROM public.plans WHERE code = 'trial';
  SELECT trial_ends_at INTO v_trial_ends FROM public.organizations WHERE id = p_org;
  v_nunca_se_cobro := v_sub.id IS NOT NULL AND v_sub.current_period_end IS NULL
    AND v_sub.status NOT IN ('active', 'trialing') AND v_sub.created_at <= now() - interval '60 minutes';
  SELECT * INTO v_plan FROM public.plans WHERE id = CASE
    WHEN v_nunca_se_cobro THEN (SELECT plan_id FROM public.organizations WHERE id = p_org)
    ELSE COALESCE(v_sub.plan_id, (SELECT plan_id FROM public.organizations WHERE id = p_org)) END;

  IF v_sub.id IS NULL THEN
    v_vigente := true;
  ELSIF v_sub.status IN ('active', 'trialing') THEN
    v_vigente := true;
  ELSIF v_sub.status = 'canceled' THEN
    v_vigente := false; v_motivo := 'cancelado';
  ELSIF v_sub.status = 'paused' THEN
    v_vigente := false; v_motivo := 'pausado';
  ELSIF v_sub.status = 'past_due' AND v_sub.current_period_end IS NULL THEN
    v_vigente := v_sub.created_at > now() - interval '60 minutes';
    IF NOT v_vigente THEN v_motivo := 'sin_pagar'; END IF;
  ELSIF v_sub.status = 'past_due' THEN
    v_dias := GREATEST(0, 7 - GREATEST(0, EXTRACT(day FROM now() - v_sub.current_period_end)::int));
    v_vigente := v_dias > 0;
    IF NOT v_vigente THEN v_motivo := 'impago'; END IF;
  ELSE
    v_vigente := true;
  END IF;
  IF v_nunca_se_cobro AND v_motivo = 'sin_pagar' THEN
    v_vigente := v_trial_ends IS NOT NULL AND v_trial_ends > now();
  END IF;
  IF v_plan.code = 'trial' AND (v_trial_ends IS NULL OR v_trial_ends <= now()) THEN
    v_vigente := false;
    v_motivo := CASE WHEN v_motivo = 'impago' THEN 'prueba_finalizada'
      ELSE COALESCE(v_motivo, 'prueba_finalizada') END;
  END IF;
  v_cupo := v_plan.ai_monthly_credits;
  v_usado := public.ia_consumo_del_mes(p_org);
  RETURN jsonb_build_object(
    'plan', v_plan.code, 'vigente', v_vigente, 'motivo_de_corte', v_motivo,
    'dias_de_gracia', v_dias, 'estado', v_sub.status, 'plan_sin_pagar', v_nunca_se_cobro,
    'commerce_gratuito', NOT v_vigente OR v_plan.code = 'trial',
    'ia', v_vigente AND COALESCE(v_plan.ai_enabled, false),
    'backups', v_vigente AND COALESCE(v_plan.backups_enabled, false),
    'branding', v_vigente AND COALESCE(v_plan.custom_branding, false),
    'max_products', CASE WHEN v_vigente THEN v_plan.max_products ELSE v_base.max_products END,
    'max_users', CASE WHEN v_vigente THEN v_plan.max_users ELSE v_base.max_users END,
    'max_sales_per_month', CASE WHEN v_vigente THEN v_plan.max_sales_per_month ELSE v_base.max_sales_per_month END,
    'ia_cupo_mensual', CASE WHEN v_vigente THEN v_cupo ELSE 0 END,
    'ia_usado', v_usado,
    'ia_restante', CASE WHEN NOT v_vigente THEN 0 WHEN v_cupo IS NULL THEN NULL ELSE GREATEST(0, v_cupo - v_usado) END
  );
END $$;
REVOKE ALL ON FUNCTION public.org_entitlements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_entitlements(uuid) TO authenticated, service_role;

UPDATE public.security_function_contracts
SET definition_hash = md5(pg_get_functiondef('public.org_entitlements(uuid)'::regprocedure)),
  reviewed_on = DATE '2026-10-08'
WHERE function_name = 'org_entitlements';

COMMIT;
