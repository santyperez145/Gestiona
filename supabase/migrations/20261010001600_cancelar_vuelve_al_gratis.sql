-- ═══════════════════════════════════════════════════════════════════════════
-- Cancelar el plan pago vuelve solo al plan gratis
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hasta hoy una suscripción cancelada quedaba «cortada»: un cartel rojo
-- «Tu suscripción está cancelada» y el plan pago mostrado en Mi plan. Pero
-- darse de baja no es deberle nada a Nerqia. Desde esta migración una
-- suscripción cancelada se resuelve como el plan Inicial (precio 0): ventas,
-- stock, caja y tienda siguen; los extras pagos se apagan; nada se borra.
--
-- No se reescriben filas: la baja queda registrada tal cual (historial y
-- webhooks de Mercado Pago intactos). Cambia cómo se lee:
--   · org_entitlements: plan Inicial; si la prueba de extras ya venció,
--     motivo «prueba_finalizada» (el mismo aviso suave del plan gratis).
--   · suscripcion_de_organizacion: devuelve el plan Inicial, sin precio ni
--     renovación, con estado «plan_gratis».
--
-- Reversible: volver a aplicar 20261008000200 y 20260827000180.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

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
    -- Darse de baja no es una deuda: el comercio vuelve solo al plan Inicial
    -- (gratis). Si la prueba de extras sigue corriendo, la conserva.
    v_plan := v_base;
    v_vigente := true;
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

CREATE OR REPLACE FUNCTION public.suscripcion_de_organizacion(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_r jsonb;
BEGIN
  IF NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esa organización';
  END IF;

  -- Una baja se lee como el plan Inicial: no hay precio ni renovación.
  SELECT CASE WHEN s.status = 'canceled' THEN jsonb_build_object(
    'subscription_id', s.id,
    'estado', 'plan_gratis',
    'provider', s.provider,
    'ciclo', NULL, 'renueva_el', NULL, 'cancela_al_final', false,
    'trial_hasta', NULL, 'precio_ars', NULL, 'precio_ars_desde', NULL,
    'plan', (SELECT jsonb_build_object(
      'code', b.code, 'name', b.name,
      'price_ars_monthly', b.price_ars_monthly,
      'price_ars_yearly', b.price_ars_yearly,
      'max_products', b.max_products, 'max_users', b.max_users,
      'ai_enabled', b.ai_enabled) FROM public.plans b WHERE b.code = 'trial'),
    'dias_restantes', NULL)
  ELSE jsonb_build_object(
    'subscription_id', s.id,
    'estado', s.status,
    'provider', s.provider,
    'ciclo', s.ciclo,
    'renueva_el', s.current_period_end,
    'cancela_al_final', s.cancel_at_period_end,
    'trial_hasta', s.trial_end,
    -- Lo que este comercio autorizó en MercadoPago. NULL = no consta, que NO
    -- es lo mismo que gratis: la pantalla tiene que poder decir «no consta».
    'precio_ars', s.precio_ars,
    'precio_ars_desde', s.precio_ars_desde,
    'plan', jsonb_build_object(
      'code', p.code, 'name', p.name,
      'price_ars_monthly', p.price_ars_monthly,
      'price_ars_yearly', p.price_ars_yearly,
      'max_products', p.max_products, 'max_users', p.max_users,
      'ai_enabled', p.ai_enabled),
    -- Cuánto falta para que venza. Negativo = ya venció.
    'dias_restantes', CASE WHEN s.current_period_end IS NULL THEN NULL
      ELSE EXTRACT(day FROM s.current_period_end - now())::int END) END
  INTO v_r
  FROM public.subscriptions s
  LEFT JOIN public.plans p ON p.id = s.plan_id
  WHERE s.org_id = p_org
  ORDER BY s.created_at DESC LIMIT 1;

  RETURN COALESCE(v_r, jsonb_build_object('estado', 'sin_suscripcion'));
END;
$function$;


UPDATE public.security_function_contracts
SET definition_hash = md5(pg_get_functiondef('public.org_entitlements(uuid)'::regprocedure)),
  reviewed_on = DATE '2026-10-10'
WHERE function_name = 'org_entitlements';

COMMIT;
