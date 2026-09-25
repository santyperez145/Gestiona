-- ============================================================================
-- Verificación reversible: notificaciones consentidas del chat (20260925000500).
--
--   node scripts/db.mjs --file supabase/verificaciones/20260925_influencer_chat_notifications.sql
--
-- Prueba de punta a punta dentro de UNA transacción con ROLLBACK:
--   1. Sin consentimiento: el mensaje del RPC no encola nada.
--   2. El creador consiente email + push (RPC de preferencias).
--   3. El mensaje siguiente de la marca encola exactamente email+push.
--   4. La cola de despacho (service_role) ve 2 filas con los datos de envío.
--   5. Consentimiento retirado: el mensaje siguiente no encola.
--   6. RLS: un outsider no ve filas de la cola ni escribe preferencias ajenas.
--
-- ⚠️ El anti-spam del RPC compara created_at con now() - 10 s. now() es el
-- inicio de la TRANSACCIÓN y no avanza con pg_sleep, así que el segundo
-- mensaje del mismo autor chocaría. En producción cada RPC corre en su propia
-- transacción (cada request), así que el verificador retrocede el created_at
-- del mensaje anterior por SQL para representar fielmente el tiempo real.
-- ============================================================================

BEGIN;
DO $verify$
DECLARE
  v_org    uuid := gen_random_uuid();
  v_user   uuid;
  v_infl   uuid;
  v_camp   uuid;
  v_prefs  record;
  v_channel text;
  v_count  int;
  v_denied boolean;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'requires existing user';

  RAISE NOTICE '═══ Notificaciones consentidas del chat — verificación ═══';

  -- ── 0. Precondiciones ────────────────────────────────────────────────────
  ASSERT to_regclass('public.influencer_chat_notify_prefs') IS NOT NULL, 'no existe influencer_chat_notify_prefs';
  ASSERT to_regclass('public.influencer_chat_notifications') IS NOT NULL, 'no existe influencer_chat_notifications';
  ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_campaign_chat_enqueue' AND NOT tgisinternal),
    'no existe el trigger de encolado';
  ASSERT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'campaign_chat_notifications_pending'),
    'no existe campaign_chat_notifications_pending';
  RAISE NOTICE 'OK: tabla, cola, trigger y despacho presentes';

  -- ── 1. Ambiente: org efímera + la misma cuenta como marca y creador ──────
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Chat notif verification', 'zz-chatn-' || v_org, v_user);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  INSERT INTO public.role_permissions(org_id, role, module, can_view, can_edit)
  VALUES (v_org, 'admin', 'influencers', true, true)
  ON CONFLICT (org_id, role, module) DO UPDATE SET can_view = true, can_edit = true;

  INSERT INTO public.influencers(id, org_id, user_id, name, email, referral_code, status)
  VALUES (gen_random_uuid(), v_org, v_user, 'QA Creador notif', 'qa-chatn-' || v_org || '@example.com', 'qn' || substr(v_org::text, 1, 8), 'active')
  RETURNING id INTO v_infl;

  INSERT INTO public.creator_accounts(user_id, email) VALUES (v_user, 'qa-chatn-' || v_org || '@example.com');

  INSERT INTO public.influencer_campaigns (org_id, title, brief, objective, channel, budget_ars, status, created_by)
  VALUES (v_org, 'QA notif campaña', 'prueba reversible de notificaciones', 'awareness', 'instagram', 0, 'active', v_user)
  RETURNING id INTO v_camp;

  INSERT INTO public.influencer_campaign_creators (org_id, campaign_id, influencer_id)
    VALUES (v_org, v_camp, v_infl);
  RAISE NOTICE 'OK: ambiente listo';

  -- ── 2. Sin consentimiento: el mensaje no encola nada ────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.influencer_chat_notify_prefs WHERE user_id = v_user;
  PERFORM public.campaign_chat_send(v_camp, 'mensaje sin preferencias', v_infl);

  SELECT count(*) INTO v_count FROM public.influencer_chat_notifications;
  ASSERT v_count = 0, 'sin consentimiento la cola tiene que estar vacía';
  RAISE NOTICE 'OK: sin consentimiento no hay cola';

  -- ── 3. El creador consiente email + push ─────────────────────────────────
  SELECT * INTO v_prefs FROM public.campaign_chat_notify_set(true, true);
  ASSERT v_prefs.email_enabled AND v_prefs.push_enabled, 'la preferencia no quedó guardada';
  RESET ROLE;
  RAISE NOTICE 'OK: consentimiento guardado (email+push)';

  -- ── 4. Marca escribe: se encola email+push para el creador ───────────────
  -- El verificador retrocede el created_at del mensaje previo ANTES de ponerse
  -- el rol authenticated (la tabla sólo es editable por dueño): representa el
  -- tiempo real entre dos requests, porque el anti-spam usa now() de inicio
  -- de transacción y adentro de la transacción no avanza.
  UPDATE public.influencer_campaign_messages
     SET created_at = created_at - interval '1 hour';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.campaign_chat_send(v_camp, 'mensaje con consentimiento', v_infl);
  SELECT count(*) INTO v_count FROM public.influencer_chat_notifications
   WHERE user_id = v_user;
  ASSERT v_count = 2, 'con consentimiento esperaba email+push (2 filas), hay ' || v_count;
  RESET ROLE;
  RAISE NOTICE 'OK: la marca escribe y se encolan 2 canales';

  -- ── 4.1. El mensaje del creador encola push a la marca ──────────────────
  -- La marca ajusta sus preferencias a push-only (misma cuenta, doble rol) y
  -- el creador responde: se encola exactamente 1 fila por el canal push.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.campaign_chat_notify_set(false, true);
  RESET ROLE;
  UPDATE public.influencer_campaign_messages
     SET created_at = created_at - interval '1 hour';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.campaign_chat_send(v_camp, 'respuesta del creador');

  -- El creador escribió: la cola gana filas sólo para los dueños/admins de la
  -- marca con preferencia (aquí, el mismo usuario: owner con email+push=false →
  -- push únicamente).
  SELECT count(*) INTO v_count
    FROM public.influencer_chat_notifications n
    JOIN public.influencer_campaign_messages m ON m.id = n.message_id
   WHERE m.body = 'respuesta del creador' AND m.author_role = 'creator';
  ASSERT v_count = 1, 'la marca con push consiente debió recibir 1 fila push, hay ' || v_count;
  SELECT n.channel INTO v_channel FROM public.influencer_chat_notifications n
    JOIN public.influencer_campaign_messages m ON m.id = n.message_id
   WHERE m.body = 'respuesta del creador';
  ASSERT v_channel = 'push', 'el canal encolado debe ser push';
  RESET ROLE;
  RAISE NOTICE 'OK: el mensaje del creador encola push a la marca';

  -- ── 5. La cola de despacho (service_role) ve lo justo ────────────────────
  -- Pendientes encolados en ESTA verificación: 2 (email+push creador) + 1
  -- (push marca). El despacho sólo expone email con correo conocido y push
  -- con suscripción web push registrada: sin destino real no hay fila.
  SELECT count(*) INTO v_count
    FROM public.campaign_chat_notifications_pending() q
   WHERE q.message_id IN (SELECT id FROM public.influencer_campaign_messages WHERE campaign_id = v_camp);
  ASSERT v_count = 1, 'sin suscripción push registrada la cola debe exponer sólo el email (1), devuelve ' || v_count;
  ASSERT EXISTS (
    SELECT 1 FROM public.campaign_chat_notifications_pending() q
    WHERE q.channel = 'email' AND q.email IS NOT NULL AND q.campaign_title = 'QA notif campaña'
  ), 'la fila email debe traer el correo destino y el título de campaña';
  -- Las 2 filas push siguen en la cola (visibles a service_role) pero sin
  -- destino expuesto: no se envían al vacío.
  SELECT count(*) INTO v_count
    FROM public.influencer_chat_notifications
   WHERE channel = 'push' AND status = 'pending';
  ASSERT v_count = 2, 'deben existir 2 filas push pendientes sin despacho, hay ' || v_count;
  RAISE NOTICE 'OK: despacho expone sólo filas con destino real';

  -- ── 6. Consentimiento retirado: el mensaje siguiente no encola ───────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.campaign_chat_notify_set(false, false);
  RESET ROLE;

  UPDATE public.influencer_campaign_messages
     SET created_at = created_at - interval '1 hour';
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.campaign_chat_send(v_camp, 'mensaje tras retirar consentimiento', v_infl);
  SELECT count(*) INTO v_count
    FROM public.influencer_chat_notifications n
    JOIN public.influencer_campaign_messages m ON m.id = n.message_id
   WHERE m.body = 'mensaje tras retirar consentimiento';
  ASSERT v_count = 0, 'el consentimiento retirado no debió encolar nada';
  RESET ROLE;
  RAISE NOTICE 'OK: consentimiento retirado, sin cola';

  -- ── 7. Aislamiento: outsider sin filas y sin preferencias ajenas ────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.influencer_chat_notifications;
  ASSERT v_count = 0, 'RLS: un outsider no debe ver la cola';
  v_denied := false;
  BEGIN
    INSERT INTO public.influencer_chat_notify_prefs (user_id, email_enabled, push_enabled)
    VALUES (v_user, true, true);
  EXCEPTION WHEN OTHERS THEN v_denied := true;
  END;
  ASSERT v_denied, 'un outsider no debió escribir la preferencia de otro';
  RESET ROLE;
  RAISE NOTICE 'OK: aislamiento por RLS';

  RAISE NOTICE '═══ Notificaciones del chat verificadas de punta a punta ═══';
END;
$verify$;
ROLLBACK;