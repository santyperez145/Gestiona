-- Una suscripción vencida se marca sola, sin depender de que llegue el webhook
--
-- ── Qué faltaba ───────────────────────────────────────────────────────────
--
-- El circuito de cobro quedó completo el 2026-08-27: se contrata, MercadoPago
-- crea el `preapproval`, y el webhook mueve el estado —
-- `suscripcion_registrar_pago` corre el `current_period_end` y activa,
-- `suscripcion_actualizar_estado` traduce lo que dice MercadoPago.
--
-- ⚠️ Todo eso depende de que **llegue el webhook**. Si no llega —se perdió, el
-- proveedor lo reintentó y nos encontró caídos, o MercadoPago simplemente dejó
-- de cobrar sin avisar— la suscripción se queda en `active` para siempre, con
-- el período vencido hace meses. Y como los beneficios se cortan por estado, un
-- comercio que dejó de pagar conserva todo.
--
-- CLAUDE.md, principio de sistemas externos: **no son confiables**. Un estado
-- que sólo cambia cuando un tercero avisa no es un estado, es una esperanza.
--
-- ── Qué ya existía ────────────────────────────────────────────────────────
--
-- `expire_overdue_trials`, que corre cada hora por cron, pero **sólo vence
-- trials**: mira `status = 'trialing'` contra `organizations.trial_ends_at`.
-- Una suscripción paga con el período terminado no la toca nadie.
--
-- Se extiende esa misma función en vez de agregar otra: el cron ya está
-- agendado y dos barridos que hacen lo mismo con nombres distintos es cómo se
-- terminan contradiciendo.
--
-- 📌 Se saca la condición `stripe_subscription_id IS NULL`. Es de cuando el
-- cobro iba a ser por Stripe; hoy esa columna es NULL en todas las filas, así
-- que no filtraba nada — pero el día que alguien la escriba, dejaría de vencer
-- trials sin que nadie entienda por qué.
--
-- ── Por qué marca `past_due` y no corta directamente ──────────────────────
--
-- Marcar es un hecho: el período terminó y no consta un pago. Cortar es una
-- decisión, y vive en `useEntitlements`, que da 7 días de gracia — MercadoPago
-- reintenta un débito rechazado varios días, y `past_due` es además el estado
-- con el que NACE toda suscripción recién contratada.
--
-- Y si el webhook llega tarde, `suscripcion_registrar_pago` la vuelve a activar
-- y corre el período: este barrido no rompe nada al adelantarse.

CREATE OR REPLACE FUNCTION public.expire_overdue_trials()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_trials int;
  v_pagas  int;
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

  -- ── 2. La suscripción paga cuyo período terminó sin cobro ───────────────
  --
  -- El margen de un día es para no correr una carrera contra el webhook:
  -- MercadoPago cobra el día del vencimiento y avisa después. Sin margen, una
  -- suscripción al día podría marcarse vencida por unas horas.
  UPDATE public.subscriptions s
     SET status = 'past_due'
   WHERE s.status = 'active'
     AND s.current_period_end IS NOT NULL
     AND s.current_period_end < now() - interval '1 day';
  GET DIAGNOSTICS v_pagas = ROW_COUNT;

  IF v_trials > 0 OR v_pagas > 0 THEN
    RAISE NOTICE 'vencidas: % trial(s), % paga(s)', v_trials, v_pagas;
  END IF;
END $$;

COMMENT ON FUNCTION public.expire_overdue_trials() IS
  'Marca past_due lo que venció: trials terminados y suscripciones pagas con '
  'el período cumplido sin cobro. Corre por cron cada hora. Existe porque el '
  'estado no puede depender de que llegue un webhook: si no llega, un comercio '
  'que dejó de pagar conserva todos los beneficios.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — en los dos sentidos
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org    uuid := gen_random_uuid();
  v_user   uuid;
  v_plan   uuid;
  v_vencida uuid := gen_random_uuid();
  v_alDia   uuid := gen_random_uuid();
  v_estado_vencida text;
  v_estado_al_dia  text;
  v_restos int;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  SELECT id INTO v_plan FROM public.plans WHERE code = 'starter';

  -- Dos organizaciones ZZ: una con el período cumplido, otra al día.
  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (v_vencida, 'ZZ vencida', 'zz-venc-'||substr(v_vencida::text,1,8), v_user),
         (v_alDia,   'ZZ al dia',  'zz-aldia-'||substr(v_alDia::text,1,8),  v_user);

  INSERT INTO public.subscriptions (org_id, plan_id, status, provider, current_period_end)
  VALUES (v_vencida, v_plan, 'active', 'mercadopago', now() - interval '10 days'),
         (v_alDia,   v_plan, 'active', 'mercadopago', now() + interval '20 days');

  PERFORM public.expire_overdue_trials();

  SELECT status INTO v_estado_vencida FROM public.subscriptions WHERE org_id = v_vencida;
  SELECT status INTO v_estado_al_dia  FROM public.subscriptions WHERE org_id = v_alDia;

  -- ── a. La vencida se marca ──────────────────────────────────────────────
  ASSERT v_estado_vencida = 'past_due',
    'una suscripcion con el periodo cumplido siguio en ' || v_estado_vencida;

  -- ── b. ⚠️ Y la que está al día NO ───────────────────────────────────────
  -- Sin esta mitad, un barrido demasiado ancho pasaria el punto (a) igual y
  -- le cortaria los beneficios a todos los que si pagan.
  ASSERT v_estado_al_dia = 'active',
    'una suscripcion al dia quedo marcada ' || v_estado_al_dia || ': el barrido corta de mas';

  -- ── c. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.subscriptions WHERE org_id IN (v_vencida, v_alDia);
  DELETE FROM public.organizations WHERE id IN (v_vencida, v_alDia);
  SELECT count(*) INTO v_restos FROM public.organizations WHERE name LIKE 'ZZ %';
  ASSERT v_restos = 0, 'quedaron ' || v_restos || ' organizaciones ZZ';

  RAISE NOTICE 'OK: la vencida se marca, la que esta al dia no, sin restos';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827000140', 'la_suscripcion_vencida_se_marca_sola')
ON CONFLICT DO NOTHING;
