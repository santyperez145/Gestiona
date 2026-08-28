-- Nada queda por debajo de lo que da la prueba gratis
--
-- ── El mismo defecto, en su segunda forma ─────────────────────────────────
--
-- Esta mañana (`20260828000010`) se corrigió que **pagar sacaba capacidades
-- que el trial regalaba**. El piso de los límites al cortar tenía el mismo
-- problema, y no se vio porque está escrito en otro lugar:
--
--     quien             usuarios  productos  ventas/mes
--     trial (gratis)           3        100  sin límite
--     piso al cortar           1         50          50
--
-- ⚠️ Un comercio que pagó y se le venció la suscripción quedaba **por debajo
-- de alguien que nunca pagó nada**. Y no es una diferencia abstracta: medido
-- hoy en `Exentry Imports`, el tope de 1 usuario dejó **al administrador del
-- comercio sin poder entrar** — `is_org_member` devuelve false para él.
--
-- 📌 El principio, que ahora vale para las dos cosas: **nada por debajo de la
-- prueba.** El corte apaga extras y baja límites, pero el piso es lo que
-- cualquiera tiene el primer día. Cobrar y después dejar peor que el día uno
-- no es un límite: es un castigo, y el comercio se va.
--
-- ⚠️ Y el límite sigue siendo real. Un `starter` cortado pasa de 1.000
-- productos a 100 y de 3 usuarios a 3: **baja de verdad**, que es lo que se
-- pidió. Lo que cambia es dónde toca fondo.
--
-- ── De dónde sale el piso ─────────────────────────────────────────────────
--
-- Del plan `trial`, leído de la tabla. No se escribe el número: si mañana la
-- prueba da 5 usuarios, el piso lo sigue solo. Un piso hardcodeado es cómo
-- estos dos lugares divergieron.
--
-- ⚠️ `max_sales_per_month` del trial es NULL —sin límite— y **eso no puede ser
-- el piso**: dejaría a un comercio cortado vendiendo sin tope. Ahí el piso es
-- el del plan cortado o 50, lo que sea mayor; el trial es un techo de
-- referencia, no una barra libre.

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
  v_base   public.plans;   -- el plan de prueba: el piso de todo
  v_dias   int := 0;
  v_motivo text := NULL;
  v_vigente boolean;
  v_nunca_se_cobro boolean;
  v_cupo   int;
  v_usado  int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE org_id = p_org;
  SELECT * INTO v_base FROM public.plans WHERE code = 'trial';

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
    IF v_sub.created_at > now() - interval '60 minutes' THEN
      v_vigente := true;
      v_motivo  := NULL;
    ELSE
      v_vigente := false;
      v_motivo  := 'sin_pagar';
    END IF;
  ELSIF v_sub.status = 'past_due' THEN
    v_dias := GREATEST(0, 7 - GREATEST(0,
      EXTRACT(day FROM now() - v_sub.current_period_end)::int));
    v_vigente := v_dias > 0;
    IF NOT v_vigente THEN v_motivo := 'impago'; END IF;
  ELSE
    v_vigente := true;
  END IF;

  IF v_nunca_se_cobro AND v_motivo = 'sin_pagar' THEN
    SELECT o.trial_ends_at IS NULL OR o.trial_ends_at > now()
      INTO v_vigente
      FROM public.organizations o WHERE o.id = p_org;
    v_vigente := COALESCE(v_vigente, false);
    IF NOT v_vigente THEN v_motivo := 'sin_pagar'; END IF;
  END IF;

  v_cupo  := v_plan.ai_monthly_credits;
  v_usado := public.ia_consumo_del_mes(p_org);

  RETURN jsonb_build_object(
    'plan',            v_plan.code,
    'vigente',         v_vigente,
    'motivo_de_corte', v_motivo,
    'dias_de_gracia',  v_dias,
    'estado',          v_sub.status,
    'plan_sin_pagar',  v_nunca_se_cobro,
    'ia',       v_vigente AND COALESCE(v_plan.ai_enabled, false),
    'backups',  v_vigente AND COALESCE(v_plan.backups_enabled, false),
    'branding', v_vigente AND COALESCE(v_plan.custom_branding, false),

    -- ── Los límites ────────────────────────────────────────────────────────
    -- Cortado, se baja al piso — y el piso es lo que da la prueba gratis, no
    -- menos. `LEAST` conserva que un plan más chico que la prueba no suba.
    --
    -- 📌 NULL en el plan es «sin límite», así que un COALESCE al piso lo
    -- convertiría en un tope donde no había ninguno: por eso el COALESCE va
    -- adentro del LEAST y no afuera.
    'max_products',        CASE WHEN v_vigente THEN v_plan.max_products
                                ELSE LEAST(COALESCE(v_plan.max_products, 2147483647),
                                           COALESCE(v_base.max_products, 100)) END,
    'max_users',           CASE WHEN v_vigente THEN v_plan.max_users
                                ELSE LEAST(COALESCE(v_plan.max_users, 2147483647),
                                           COALESCE(v_base.max_users, 3)) END,
    -- ⚠️ Acá el trial NO sirve de piso: tiene NULL (sin límite), y un comercio
    -- cortado no puede quedar vendiendo sin tope. Se usa el mayor entre lo que
    -- da su plan y 50.
    'max_sales_per_month', CASE WHEN v_vigente THEN v_plan.max_sales_per_month
                                ELSE GREATEST(LEAST(COALESCE(v_plan.max_sales_per_month, 50), 50), 50) END,

    'ia_cupo_mensual',  CASE WHEN v_vigente THEN v_cupo ELSE 0 END,
    'ia_usado',         v_usado,
    'ia_restante',      CASE
                          WHEN NOT v_vigente THEN 0
                          WHEN v_cupo IS NULL THEN NULL
                          ELSE GREATEST(0, v_cupo - v_usado)
                        END
  );
END $$;

GRANT EXECUTE ON FUNCTION public.org_entitlements(uuid) TO authenticated, service_role;

-- Con el piso nuevo, quien estaba suspendido por un tope más bajo que la
-- prueba vuelve solo. `aplicar_limites_del_plan` es idempotente.
DO $reaplicar$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT org_id FROM public.memberships WHERE suspendido_por_plan
  LOOP
    PERFORM public.aplicar_limites_del_plan(r.org_id);
  END LOOP;
END $reaplicar$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — el piso sube, pero el límite sigue siendo real
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org   uuid := gen_random_uuid();
  v_user  uuid;
  v_start uuid;
  v_e     jsonb;
  v_base  public.plans;
  v_restos int;
BEGIN
  SELECT * INTO v_base FROM public.plans WHERE code = 'trial';
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  SELECT id INTO v_start FROM public.plans WHERE code = 'starter';

  INSERT INTO public.organizations (id, name, slug, owner_user_id, plan_id)
  VALUES (v_org, 'ZZ piso', 'zz-piso-'||substr(v_org::text,1,8), v_user, v_start);
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');

  -- ── a. Vigente: los límites del plan contratado ─────────────────────────
  INSERT INTO public.subscriptions (org_id, plan_id, status, provider, current_period_end)
  VALUES (v_org, v_start, 'active', 'mercadopago', now() + interval '20 days');

  v_e := public.org_entitlements(v_org);
  ASSERT (v_e->>'max_products')::int = 1000,
    'un starter vigente perdió sus productos: ' || (v_e->>'max_products');

  -- ── b. Cortado: baja de verdad… ─────────────────────────────────────────
  UPDATE public.subscriptions SET status = 'canceled' WHERE org_id = v_org;
  v_e := public.org_entitlements(v_org);
  ASSERT (v_e->>'max_products')::int < 1000,
    'el límite no bajó al cortar: sigue en ' || (v_e->>'max_products');

  -- ── c. …pero nunca por debajo de la prueba gratis ───────────────────────
  -- ⚠️ Es el defecto que motivó esta migración: quien pagó y se le venció
  -- quedaba peor que quien nunca pagó nada.
  ASSERT (v_e->>'max_products')::int >= COALESCE(v_base.max_products, 100),
    'cortado quedó con menos productos que la prueba gratis: '
    || (v_e->>'max_products') || ' vs ' || COALESCE(v_base.max_products, 100);
  ASSERT (v_e->>'max_users')::int >= COALESCE(v_base.max_users, 3),
    'cortado quedó con menos usuarios que la prueba gratis: '
    || (v_e->>'max_users') || ' vs ' || COALESCE(v_base.max_users, 3);

  -- ── d. ⚠️ Pero las ventas SÍ tienen tope ────────────────────────────────
  -- El trial las tiene en NULL (sin límite) y usarlo de piso dejaría a un
  -- comercio cortado vendiendo sin tope, que es lo contrario de un corte.
  ASSERT (v_e->>'max_sales_per_month')::int = 50,
    'un comercio cortado quedó sin tope de ventas: ' || (v_e->>'max_sales_per_month');

  -- ── e. Y los extras siguen apagados ─────────────────────────────────────
  -- Bajar el piso de los límites no puede regalar las capacidades.
  ASSERT NOT (v_e->>'ia')::boolean, 'un plan cortado conservó la IA';
  ASSERT (v_e->>'ia_restante')::int = 0, 'un plan cortado conservó cupo de IA';

  -- ── f. Nadie quedó suspendido por debajo de la prueba ───────────────────
  SELECT count(*) INTO v_restos
    FROM public.memberships m
    JOIN public.organizations o ON o.id = m.org_id
   WHERE m.suspendido_por_plan
     AND (SELECT count(*) FROM public.memberships x WHERE x.org_id = m.org_id)
         <= COALESCE(v_base.max_users, 3);
  ASSERT v_restos = 0,
    v_restos || ' persona(s) siguen suspendidas en comercios que caben en la prueba gratis';

  -- ── g. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.subscriptions WHERE org_id = v_org;
  DELETE FROM public.memberships   WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;
  SELECT count(*) INTO v_restos FROM public.organizations WHERE name = 'ZZ piso';
  ASSERT v_restos = 0, 'quedaron restos ZZ';

  RAISE NOTICE 'OK: el límite baja de verdad, pero nunca por debajo de la prueba gratis';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000040', 'nunca_por_debajo_de_la_prueba')
ON CONFLICT DO NOTHING;
