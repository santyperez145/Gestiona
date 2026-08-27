-- Los beneficios del plan se deciden en un solo lugar
--
-- ── Por qué ───────────────────────────────────────────────────────────────
--
-- El 2026-08-27 `useEntitlements` aprendió a cortar los beneficios cuando la
-- suscripción no está paga. Pero eso es el navegador: **orienta, no decide**.
-- Las funciones de IA cuestan plata por llamada —`ANTHROPIC_API_KEY`— y no
-- miraban el plan, así que un comercio impago podía seguir gastando con sólo
-- llamar la Edge Function.
--
-- Es la misma distinción que ya está escrita para permisos: la UI evita ofrecer
-- botones que van a fallar; la autorización la hace el servidor.
--
-- 📌 Y la decisión no puede escribirse dos veces. Este repo ya vio divergir la
-- misma regla en dos lugares —el mapa de permisos, el reparto de roles— así que
-- la ventana de gracia, el estado que corta y el piso de límites viven **acá**,
-- y tanto el hook como las Edge Functions leen esto.
--
-- ── Las reglas, en un lugar ───────────────────────────────────────────────
--
-- - `active` y `trialing` → con beneficios.
-- - `past_due` → con beneficios durante 7 días desde el fin del período.
--   MercadoPago reintenta un débito rechazado varios días, y `past_due` es
--   además el estado con el que **nace** toda suscripción recién contratada.
-- - `canceled` y `paused` → cortado.
-- - **Sin fila de suscripción → con beneficios.** Son los comercios anteriores
--   al cobro; cortarles algo que nunca se les vendió sería romperles el sistema
--   por una migración.
--
-- ⚠️ Cortar apaga los extras y baja los límites a un piso. **No borra ni
-- bloquea nada**: el comercio sigue entrando, viendo lo suyo y pudiendo pagar.
-- Dejarlo afuera de su propia información es una forma de perder al cliente,
-- no de cobrarle.

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
BEGIN
  -- Un usuario sólo puede preguntar por su propia organización. El servidor
  -- (`service_role`, con `auth.uid()` NULL) puede preguntar por cualquiera.
  IF auth.uid() IS NOT NULL AND NOT public.is_org_member(p_org, auth.uid()) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE org_id = p_org;

  SELECT * INTO v_plan FROM public.plans
   WHERE id = COALESCE(v_sub.plan_id,
                       (SELECT o.plan_id FROM public.organizations o WHERE o.id = p_org));

  IF v_sub.id IS NULL THEN
    -- Sin suscripción: se respeta lo que tenga el plan de la organización.
    v_vigente := true;
  ELSIF v_sub.status IN ('active', 'trialing') THEN
    v_vigente := true;
  ELSIF v_sub.status = 'canceled' THEN
    v_vigente := false; v_motivo := 'cancelado';
  ELSIF v_sub.status = 'paused' THEN
    v_vigente := false; v_motivo := 'pausado';
  ELSIF v_sub.status = 'past_due' THEN
    v_dias := GREATEST(0, 7 - GREATEST(0,
      EXTRACT(day FROM now() - COALESCE(v_sub.current_period_end, now()))::int));
    v_vigente := v_dias > 0;
    IF NOT v_vigente THEN v_motivo := 'impago'; END IF;
  ELSE
    v_vigente := true;
  END IF;

  RETURN jsonb_build_object(
    'plan',            v_plan.code,
    'vigente',         v_vigente,
    'motivo_de_corte', v_motivo,
    'dias_de_gracia',  v_dias,
    'estado',          v_sub.status,
    -- Los extras se apagan enteros cuando no está vigente.
    'ia',       v_vigente AND COALESCE(v_plan.ai_enabled, false),
    'backups',  v_vigente AND COALESCE(v_plan.backups_enabled, false),
    'branding', v_vigente AND COALESCE(v_plan.custom_branding, false),
    -- Los límites bajan a un piso con el que se puede seguir operando.
    'max_products',        CASE WHEN v_vigente THEN v_plan.max_products
                                ELSE LEAST(COALESCE(v_plan.max_products, 50), 50) END,
    'max_users',           CASE WHEN v_vigente THEN v_plan.max_users
                                ELSE LEAST(COALESCE(v_plan.max_users, 1), 1) END,
    'max_sales_per_month', CASE WHEN v_vigente THEN v_plan.max_sales_per_month
                                ELSE LEAST(COALESCE(v_plan.max_sales_per_month, 50), 50) END
  );
END $$;

COMMENT ON FUNCTION public.org_entitlements(uuid) IS
  'Qué puede hacer una organización según su plan Y el estado de su '
  'suscripción. Única autoridad: la lee el hook del navegador (para orientar) '
  'y las Edge Functions (para decidir). La ventana de gracia y el piso de '
  'límites viven acá y en ningún otro lado.';

GRANT EXECUTE ON FUNCTION public.org_entitlements(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org  uuid := gen_random_uuid();
  v_user uuid;
  v_plan uuid;
  v_e    jsonb;
  v_ajeno boolean;
  v_restos int;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  -- `pro` tiene IA, backups y branding: sirve para ver el corte.
  SELECT id INTO v_plan FROM public.plans WHERE code = 'pro';

  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ beneficios', 'zz-ben-'||substr(v_org::text,1,8), v_user);
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');

  -- ── a. Al día: con todo ─────────────────────────────────────────────────
  INSERT INTO public.subscriptions (org_id, plan_id, status, provider, current_period_end)
  VALUES (v_org, v_plan, 'active', 'mercadopago', now() + interval '20 days');

  v_e := public.org_entitlements(v_org);
  ASSERT (v_e->>'vigente')::boolean, 'una suscripcion activa quedo sin beneficios';
  ASSERT (v_e->>'ia')::boolean,      'una suscripcion activa quedo sin IA';

  -- ── b. Impaga hace 30 días: cortada ─────────────────────────────────────
  UPDATE public.subscriptions
     SET status = 'past_due', current_period_end = now() - interval '30 days'
   WHERE org_id = v_org;

  v_e := public.org_entitlements(v_org);
  ASSERT NOT (v_e->>'vigente')::boolean, 'una suscripcion impaga hace 30 dias sigue vigente';
  ASSERT NOT (v_e->>'ia')::boolean,      'una suscripcion impaga conserva la IA: gastar cuesta plata';
  ASSERT v_e->>'motivo_de_corte' = 'impago', 'el motivo del corte no se informa';

  -- ── c. ⚠️ Impaga hace 2 días: TODAVÍA con beneficios ────────────────────
  -- Sin la gracia, quien acaba de contratar —o a quien le rebotó la tarjeta
  -- una vez— se queda sin sistema al instante.
  UPDATE public.subscriptions SET current_period_end = now() - interval '2 days'
   WHERE org_id = v_org;

  v_e := public.org_entitlements(v_org);
  ASSERT (v_e->>'vigente')::boolean,
    'se corto dentro de la ventana de gracia: quedan ' || (v_e->>'dias_de_gracia');

  -- ── d. ⚠️ Y no se puede espiar la de otro comercio ──────────────────────
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', gen_random_uuid(), 'role','authenticated')::text, true);
    PERFORM public.org_entitlements(v_org);
    v_ajeno := true;
  EXCEPTION WHEN insufficient_privilege THEN
    v_ajeno := false;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
  ASSERT NOT v_ajeno, 'un usuario ajeno pudo leer los beneficios de otra organizacion';

  -- ── e. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.subscriptions WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;
  SELECT count(*) INTO v_restos FROM public.organizations WHERE name = 'ZZ beneficios';
  ASSERT v_restos = 0, 'quedaron restos ZZ';

  RAISE NOTICE 'OK: activa con todo, impaga cortada, gracia respetada, sin fugas';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000150', 'una_sola_autoridad_de_beneficios')
ON CONFLICT DO NOTHING;
