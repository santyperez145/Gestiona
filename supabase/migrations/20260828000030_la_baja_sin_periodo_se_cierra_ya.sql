-- Una baja sin período no espera nada: se cierra
--
-- ── Lo que se vio en producción el 2026-08-28 ─────────────────────────────
--
-- ⚠️ Mi plan mostraba **tres mensajes contradictorios en la misma pantalla**:
--
--   1. Banner: «Estamos confirmando tu suscripción con MercadoPago.»
--   2. Cartel: «Cancelaste la suscripción. Como todavía no se había hecho
--      ningún cobro, no queda nada pendiente y no se te va a cobrar.»
--   3. Cartel, diez centímetros abajo: «Estamos esperando que MercadoPago
--      confirme tu primer cobro.»
--
-- La fila explicaba las tres:
--
--     status                past_due
--     cancel_at_period_end  true
--     current_period_end    NULL     ← nunca hubo período
--
-- 📌 **«Al final del período» no significa nada si no hubo período.**
-- `cancel-subscription` escribía `cancel_at_period_end: true` siempre, así que
-- una baja anterior al primer cobro dejaba la suscripción en `past_due`
-- esperando para siempre un cobro que nunca iba a llegar. Los dos mensajes de
-- «estamos confirmando» leen exactamente ese estado, y tenían razón: el dato
-- decía eso. El dato estaba mal.
--
-- ── Qué se corrige ────────────────────────────────────────────────────────
--
-- La función ya no lo escribe (mismo commit). Acá se reparan las filas que
-- quedaron en ese estado, con un predicado que describe **sólo** la huella del
-- bug: baja pedida, sin período, y todavía sin cerrar.
--
-- ⚠️ No se toca ninguna suscripción con período: ahí «al final del período» sí
-- quiere decir algo y el comercio pagó por ese tiempo.

UPDATE public.subscriptions
   SET status = 'canceled'
 WHERE cancel_at_period_end
   AND current_period_end IS NULL
   AND status <> 'canceled';

-- ═══════════════════════════════════════════════════════════════════════════
-- La guarda: este estado no puede volver
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.audit_baja_contradictoria AS
SELECT s.id,
       s.org_id,
       s.status,
       s.created_at,
       'baja pedida sin período: la pantalla dice a la vez que se canceló y '
       'que se está confirmando el primer cobro' AS problema
  FROM public.subscriptions s
 WHERE s.cancel_at_period_end
   AND s.current_period_end IS NULL
   AND s.status <> 'canceled';

COMMENT ON VIEW public.audit_baja_contradictoria IS
  'Suscripciones dadas de baja antes del primer cobro que quedaron sin cerrar. '
  'Tiene que estar vacía: cada fila es una pantalla que se contradice sola.';

REVOKE ALL ON public.audit_baja_contradictoria FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_malas int;
  v_org   uuid := gen_random_uuid();
  v_user  uuid;
  v_plan  uuid;
  v_e     jsonb;
  v_restos int;
BEGIN
  -- ── a. No quedó ninguna fila en el estado contradictorio ────────────────
  SELECT count(*) INTO v_malas FROM public.audit_baja_contradictoria;
  ASSERT v_malas = 0,
    v_malas || ' suscripción(es) siguen diciendo «cancelada» y «confirmando» a la vez';

  -- ── b. ⚠️ Y una baja CON período conserva su período ────────────────────
  -- Sin esta mitad, «arreglado» pasaría igual habiendo cerrado a alguien que
  -- pagó por el mes que le queda.
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  SELECT id INTO v_plan FROM public.plans WHERE code = 'pro';

  INSERT INTO public.organizations (id, name, slug, owner_user_id, plan_id)
  VALUES (v_org, 'ZZ baja con periodo', 'zz-bp-'||substr(v_org::text,1,8), v_user, v_plan);
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  INSERT INTO public.subscriptions
         (org_id, plan_id, status, provider, cancel_at_period_end, current_period_end)
  VALUES (v_org, v_plan, 'active', 'mercadopago', true, now() + interval '20 days');

  SELECT count(*) INTO v_malas
    FROM public.audit_baja_contradictoria WHERE org_id = v_org;
  ASSERT v_malas = 0, 'una baja con período quedó marcada como contradictoria';

  ASSERT (SELECT status FROM public.subscriptions WHERE org_id = v_org) = 'active',
    'se cerró una suscripción que todavía tiene período pago';

  -- Y sigue dando los beneficios hasta que el período termine.
  v_e := public.org_entitlements(v_org);
  ASSERT (v_e->>'vigente')::boolean,
    'se le cortó el servicio a quien pagó por el mes que le queda';

  -- ── c. Sin restos ───────────────────────────────────────────────────────
  DELETE FROM public.subscriptions WHERE org_id = v_org;
  DELETE FROM public.memberships   WHERE org_id = v_org;
  DELETE FROM public.organizations WHERE id = v_org;
  SELECT count(*) INTO v_restos FROM public.organizations WHERE name = 'ZZ baja con periodo';
  ASSERT v_restos = 0, 'quedaron restos ZZ';

  RAISE NOTICE 'OK: la baja sin período se cierra, y la que tiene período lo conserva';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000030', 'la_baja_sin_periodo_se_cierra_ya')
ON CONFLICT DO NOTHING;
