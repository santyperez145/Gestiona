-- Una baja se cierra sola cuando termina el período que el comercio pagó
--
-- ── El agujero que esto tapa ──────────────────────────────────────────────
--
-- ⚠️ Medido el 2026-08-27: **cancelar la suscripción era imposible**.
-- `cancel-subscription` era 100% Stripe —que nunca se usó para cobrar— y
-- fallaba de tres formas a la vez: `requireEnv("STRIPE_SECRET_KEY")` lanza al
-- cargar el módulo, buscaba por `stripe_subscription_id` (0 de 2 filas la
-- tienen) y **nunca le avisaba a MercadoPago**. El comercio apretaba «cancelar»,
-- veía un error, y el débito seguía saliendo todos los meses.
--
-- La función ya se reescribió contra MercadoPago. Lo que falta es el otro
-- extremo: **que la baja se cierre cuando corresponde**.
--
-- ── Por qué no se corta el día que cancela ────────────────────────────────
--
-- El comercio pagó un mes. Cortarle el servicio el día que avisa que se va es
-- quedarse con plata por algo que no se prestó. Se marca
-- `cancel_at_period_end`, MercadoPago deja de cobrar, y el plan sigue vigente
-- hasta que termina el período.
--
-- 📌 Y sin esto quedaría en el aire: `expire_overdue_trials` marcaba `past_due`
-- todo lo vencido. Una suscripción **dada de baja** que vence no es un impago
-- —no debe nada— y decirle «pago pendiente» a quien se dio de baja en regla es
-- acusarlo de algo que no hizo. Se separan los dos casos.

CREATE OR REPLACE FUNCTION public.expire_overdue_trials()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_trials int;
  v_pagas  int;
  v_bajas  int;
BEGIN
  -- ── 1. El trial que se terminó ──────────────────────────────────────────
  UPDATE public.subscriptions s
     SET status = 'past_due'
    FROM public.organizations o
   WHERE s.org_id = o.id
     AND s.status = 'trialing'
     AND o.trial_ends_at IS NOT NULL
     AND o.trial_ends_at < now();
  GET DIAGNOSTICS v_trials = ROW_COUNT;

  -- ── 2. La baja pedida, cuyo período ya terminó ──────────────────────────
  --
  -- ⚠️ Va ANTES del barrido de impagos. Al revés, una suscripción dada de baja
  -- que vence caería en `past_due` y el comercio vería «pago pendiente» por
  -- algo que canceló en regla.
  UPDATE public.subscriptions s
     SET status = 'canceled'
   WHERE s.cancel_at_period_end IS TRUE
     AND s.status <> 'canceled'
     AND (s.current_period_end IS NULL OR s.current_period_end < now());
  GET DIAGNOSTICS v_bajas = ROW_COUNT;

  -- ── 3. La suscripción paga cuyo período terminó sin cobro ───────────────
  --
  -- El margen de un día es para no correr una carrera contra el webhook:
  -- MercadoPago cobra el día del vencimiento y avisa después.
  UPDATE public.subscriptions s
     SET status = 'past_due'
   WHERE s.status = 'active'
     AND s.cancel_at_period_end IS NOT TRUE
     AND s.current_period_end IS NOT NULL
     AND s.current_period_end < now() - interval '1 day';
  GET DIAGNOSTICS v_pagas = ROW_COUNT;

  IF v_trials > 0 OR v_pagas > 0 OR v_bajas > 0 THEN
    RAISE NOTICE 'vencidas: % trial(s), % paga(s), % baja(s)', v_trials, v_pagas, v_bajas;
  END IF;
END $$;

COMMENT ON FUNCTION public.expire_overdue_trials() IS
  'Cierra lo que venció: trials terminados, bajas pedidas cuyo período ya pasó, '
  'y suscripciones pagas sin cobro. Corre por cron cada hora. Una baja NO se '
  'marca past_due: quien canceló en regla no debe nada.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_user uuid;
  v_plan uuid;
  v_baja_vencida uuid := gen_random_uuid();
  v_baja_vigente uuid := gen_random_uuid();
  v_impaga       uuid := gen_random_uuid();
  v_e1 text; v_e2 text; v_e3 text;
  v_restos int;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  SELECT id INTO v_plan FROM public.plans WHERE code = 'starter';

  INSERT INTO public.organizations (id, name, slug, owner_user_id) VALUES
    (v_baja_vencida, 'ZZ baja vencida', 'zz-bv-'||substr(v_baja_vencida::text,1,8), v_user),
    (v_baja_vigente, 'ZZ baja vigente', 'zz-bg-'||substr(v_baja_vigente::text,1,8), v_user),
    (v_impaga,       'ZZ impaga',       'zz-im-'||substr(v_impaga::text,1,8),       v_user);

  INSERT INTO public.subscriptions
    (org_id, plan_id, status, provider, cancel_at_period_end, current_period_end) VALUES
    (v_baja_vencida, v_plan, 'active', 'mercadopago', true,  now() - interval '5 days'),
    (v_baja_vigente, v_plan, 'active', 'mercadopago', true,  now() + interval '20 days'),
    (v_impaga,       v_plan, 'active', 'mercadopago', false, now() - interval '10 days');

  PERFORM public.expire_overdue_trials();

  SELECT status INTO v_e1 FROM public.subscriptions WHERE org_id = v_baja_vencida;
  SELECT status INTO v_e2 FROM public.subscriptions WHERE org_id = v_baja_vigente;
  SELECT status INTO v_e3 FROM public.subscriptions WHERE org_id = v_impaga;

  -- ── a. La baja cuyo período terminó queda cancelada ─────────────────────
  ASSERT v_e1 = 'canceled',
    'una baja con el periodo terminado quedo en ' || v_e1;

  -- ── b. ⚠️ Y NO como impaga: no debe nada ────────────────────────────────
  ASSERT v_e1 <> 'past_due',
    'a quien se dio de baja en regla se le dice que tiene un pago pendiente';

  -- ── c. ⚠️ La baja cuyo período SIGUE se respeta ─────────────────────────
  -- Pagó el mes. Cortarle antes es quedarse con plata por un servicio que no
  -- se prestó.
  ASSERT v_e2 = 'active',
    'se corto una baja cuyo periodo pago todavia no termino: quedo en ' || v_e2;

  -- ── d. Y el impago sigue marcándose ─────────────────────────────────────
  ASSERT v_e3 = 'past_due',
    'dejo de marcarse el impago: quedo en ' || v_e3;

  -- ── e. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.subscriptions WHERE org_id IN (v_baja_vencida, v_baja_vigente, v_impaga);
  DELETE FROM public.organizations WHERE id IN (v_baja_vencida, v_baja_vigente, v_impaga);
  SELECT count(*) INTO v_restos FROM public.organizations WHERE name LIKE 'ZZ %';
  ASSERT v_restos = 0, 'quedaron ' || v_restos || ' restos ZZ';

  RAISE NOTICE 'OK: la baja vencida se cierra, la vigente se respeta, el impago sigue marcandose';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000190', 'la_baja_se_cierra_sola')
ON CONFLICT DO NOTHING;
