-- «Nunca se cobró» no es lo mismo que «rebotó un cobro»
--
-- ── El agujero ────────────────────────────────────────────────────────────
--
-- ⚠️ Encontrado por el dueño el 2026-08-27: apretó contratar, **canceló el pago
-- en MercadoPago**, y el sistema le dio el plan igual.
--
-- Medido:
--
--     status               past_due
--     current_period_end   NULL        ← nunca se cobró
--     tiene_beneficios     true
--     dias_de_gracia       7
--
-- La ventana de gracia se escribió para un caso: **el cobro rebotó**.
-- MercadoPago reintenta un débito rechazado varios días, y cortar en el primer
-- rechazo dejaría sin sistema a alguien que ya venía pagando.
--
-- Pero `past_due` es **también** el estado con el que nace toda suscripción,
-- antes del primer cobro. Al tratar los dos casos igual, la gracia se convirtió
-- en siete días de plan pago gratis para cualquiera que apriete contratar y
-- abandone el checkout. Y es repetible.
--
-- 📌 La diferencia está en `current_period_end`: **NULL significa que nunca
-- hubo un período pago**. Con eso alcanza para separarlos.
--
-- ── Las dos ventanas, que son distintas ───────────────────────────────────
--
-- - **Confirmando el primer cobro** (`current_period_end IS NULL`): dura
--   minutos, no días. MercadoPago cobra y avisa por webhook casi enseguida.
--   ⚠️ Tiene que existir igual: sin ella, quien acaba de pagar de verdad se
--   queda sin sistema hasta que llegue el webhook.
-- - **Un cobro que rebotó** (hubo período y terminó): 7 días, porque hay un
--   historial de pago y MercadoPago reintenta.
--
-- 📌 Y cortar por «nunca pagó» no deja al comercio sin nada: cae a lo que tenía
-- **antes** de contratar —su trial, o el plan de la organización—. Perder el
-- plan que no se pagó no es lo mismo que perder el acceso.

CREATE OR REPLACE FUNCTION public.org_entitlements(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sub    public.subscriptions;
  v_plan   public.plans;
  v_dias   int := 0;
  v_motivo text := NULL;
  v_vigente boolean;
  v_nunca_se_cobro boolean;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE org_id = p_org;

  -- ⚠️ Una suscripción que nunca se cobró no da el plan que promete. Se resuelve
  -- con el plan de la organización, que es lo que el comercio tenía antes.
  --
  -- 📌 Pero NO durante la ventana de confirmación: ahí el cobro puede estar en
  -- curso, y mostrarle el plan viejo a quien acaba de pagar sería decirle que
  -- su pago no sirvió. La primera versión de esto lo mandaba al plan de la
  -- organización desde el minuto cero, y la verificación lo atajó.
  v_nunca_se_cobro := v_sub.id IS NOT NULL
                      AND v_sub.current_period_end IS NULL
                      AND v_sub.status NOT IN ('active', 'trialing')
                      AND v_sub.created_at <= now() - interval '60 minutes';

  SELECT * INTO v_plan FROM public.plans
   WHERE id = CASE
     WHEN v_nunca_se_cobro THEN (SELECT o.plan_id FROM public.organizations o WHERE o.id = p_org)
     ELSE COALESCE(v_sub.plan_id,
                   (SELECT o.plan_id FROM public.organizations o WHERE o.id = p_org))
   END;

  IF v_sub.id IS NULL THEN
    v_vigente := true;
  ELSIF v_sub.status IN ('active', 'trialing') THEN
    v_vigente := true;
  ELSIF v_sub.status = 'canceled' THEN
    v_vigente := false; v_motivo := 'cancelado';
  ELSIF v_sub.status = 'paused' THEN
    v_vigente := false; v_motivo := 'pausado';
  ELSIF v_sub.status = 'past_due' AND v_sub.current_period_end IS NULL THEN
    -- Todavía no se cobró nunca. La ventana es de minutos: lo que tarda
    -- MercadoPago en confirmar y avisar. Pasada, el plan contratado no rige.
    IF v_sub.created_at > now() - interval '60 minutes' THEN
      v_vigente := true;
      v_motivo  := NULL;
    ELSE
      v_vigente := false;
      v_motivo  := 'sin_pagar';
    END IF;
  ELSIF v_sub.status = 'past_due' THEN
    -- Hubo un período pago y terminó: acá sí corresponde la gracia.
    v_dias := GREATEST(0, 7 - GREATEST(0,
      EXTRACT(day FROM now() - v_sub.current_period_end)::int));
    v_vigente := v_dias > 0;
    IF NOT v_vigente THEN v_motivo := 'impago'; END IF;
  ELSE
    v_vigente := true;
  END IF;

  -- Cuando nunca se cobró, lo que rige es el plan de la organización — lo que
  -- el comercio tenía antes de contratar. Pierde el plan que no pagó, no el
  -- acceso a lo suyo.
  --
  -- ⚠️ Pero **respetando el vencimiento del trial**. Sin esta parte, un
  -- comercio con la prueba ya vencida contrataba, cancelaba el pago, y volvía a
  -- tener el trial vigente para siempre: el agujero se arreglaba por un lado y
  -- se abría por el otro.
  IF v_nunca_se_cobro AND v_motivo = 'sin_pagar' THEN
    SELECT o.trial_ends_at IS NULL OR o.trial_ends_at > now()
      INTO v_vigente
      FROM public.organizations o WHERE o.id = p_org;
    v_vigente := COALESCE(v_vigente, false);
    IF NOT v_vigente THEN v_motivo := 'sin_pagar'; END IF;
  END IF;

  RETURN jsonb_build_object(
    'plan',            v_plan.code,
    'vigente',         v_vigente,
    'motivo_de_corte', v_motivo,
    'dias_de_gracia',  v_dias,
    'estado',          v_sub.status,
    -- Qué plan se está aplicando de verdad, para que la pantalla no prometa
    -- el contratado cuando rige otro.
    'plan_sin_pagar',  v_nunca_se_cobro,
    'ia',       v_vigente AND COALESCE(v_plan.ai_enabled, false),
    'backups',  v_vigente AND COALESCE(v_plan.backups_enabled, false),
    'branding', v_vigente AND COALESCE(v_plan.custom_branding, false),
    'max_products',        CASE WHEN v_vigente THEN v_plan.max_products
                                ELSE LEAST(COALESCE(v_plan.max_products, 50), 50) END,
    'max_users',           CASE WHEN v_vigente THEN v_plan.max_users
                                ELSE LEAST(COALESCE(v_plan.max_users, 1), 1) END,
    'max_sales_per_month', CASE WHEN v_vigente THEN v_plan.max_sales_per_month
                                ELSE LEAST(COALESCE(v_plan.max_sales_per_month, 50), 50) END
  );
END $$;

GRANT EXECUTE ON FUNCTION public.org_entitlements(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — las tres situaciones, que se veían iguales
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org  uuid := gen_random_uuid();
  v_user uuid;
  v_pro  uuid;
  v_trial uuid;
  v_e    jsonb;
  v_restos int;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  SELECT id INTO v_pro   FROM public.plans WHERE code = 'pro';
  SELECT id INTO v_trial FROM public.plans WHERE code = 'trial';

  INSERT INTO public.organizations (id, name, slug, owner_user_id, plan_id)
  VALUES (v_org, 'ZZ sin pagar', 'zz-sp-'||substr(v_org::text,1,8), v_user, v_trial);
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');

  -- ── a. Recién contratada: se le da el beneficio mientras se confirma ────
  -- ⚠️ Sin esta ventana, quien acaba de pagar de verdad se queda sin sistema
  -- hasta que llegue el webhook.
  INSERT INTO public.subscriptions (org_id, plan_id, status, provider, created_at)
  VALUES (v_org, v_pro, 'past_due', 'mercadopago', now());

  v_e := public.org_entitlements(v_org);
  ASSERT (v_e->>'ia')::boolean,
    'a quien acaba de contratar se le cortó antes de que MercadoPago confirme';
  ASSERT v_e->>'plan' = 'pro', 'no se está aplicando el plan contratado durante la confirmación';

  -- ── b. ⚠️ Contratada hace horas y nunca cobrada: NO da el plan ──────────
  -- Es el agujero que encontró el dueño: apretar contratar, cancelar el pago,
  -- y llevarse siete días de plan pago gratis. Repetible.
  UPDATE public.subscriptions SET created_at = now() - interval '5 hours'
   WHERE org_id = v_org;

  v_e := public.org_entitlements(v_org);
  -- ⚠️ Acá había un `ASSERT NOT ia`, y era una mala prueba: el plan `trial`
  -- **también** tiene IA, así que no distingue si se aplicó el plan pago o el
  -- de la organización. Lo que lo prueba es cuál plan rige y con qué límites.
  ASSERT v_e->>'plan' = 'trial',
    'no cayó al plan de la organización: quedó en ' || COALESCE(v_e->>'plan','?');
  ASSERT (v_e->>'plan_sin_pagar')::boolean,
    'la pantalla no puede saber que el plan contratado no rige';

  -- ── c. ⚠️ Y el comercio NO se queda sin nada ────────────────────────────
  -- Pierde el plan que no pagó, no el acceso a lo suyo.
  ASSERT (v_e->>'vigente')::boolean,
    'se cortó al comercio entero por no pagar un plan que nunca empezó';
  ASSERT (v_e->>'max_products')::int = 100,
    'no conservó los límites de su propio plan: quedó en ' || (v_e->>'max_products');

  -- ── d. Un cobro que SÍ ocurrió y venció conserva la gracia ──────────────
  UPDATE public.subscriptions
     SET current_period_end = now() - interval '2 days' WHERE org_id = v_org;
  v_e := public.org_entitlements(v_org);
  ASSERT (v_e->>'ia')::boolean,
    'se perdió la gracia de quien venía pagando y le rebotó un cobro';

  -- ── e. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.subscriptions WHERE org_id = v_org;
  DELETE FROM public.memberships   WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;
  SELECT count(*) INTO v_restos FROM public.organizations WHERE name = 'ZZ sin pagar';
  ASSERT v_restos = 0, 'quedaron restos ZZ';

  RAISE NOTICE 'OK: se confirma por minutos, sin pagar no da el plan, y el comercio conserva lo suyo';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000270', 'nunca_se_cobro_no_es_lo_mismo_que_reboto')
ON CONFLICT DO NOTHING;
