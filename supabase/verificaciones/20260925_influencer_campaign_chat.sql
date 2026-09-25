-- ============================================================================
-- Verificación reversible: chat por colaboración (20260925000400).
-- Correr con `npx supabase db query --linked --file <este archivo>`.
-- Todo corre dentro de un bloque con ROLLBACK: no deja datos.
-- ============================================================================

BEGIN;
DO $verify$
DECLARE
  v_org   uuid := gen_random_uuid();
  v_user  uuid;
  v_infl  uuid;
  v_camp  uuid;
  v_msg   uuid;
  v_body  text;
  v_role  text;
  v_total int;
  v_denied boolean;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'requires existing user';

  RAISE NOTICE '═══ Chat por colaboración — verificación ═══';

  -- ── 0. Precondiciones ────────────────────────────────────────────────────
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'influencer_campaign_messages'),
    'FALLO: no existe influencer_campaign_messages';
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'campaign_chat_list'), 'no existe campaign_chat_list';
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'campaign_chat_send'), 'no existe campaign_chat_send';
  RAISE NOTICE 'OK: tabla y RPCs presentes';

  -- ── 1. Ambiente: org efímera + creador con el email de la cuenta dueña ──
  -- Así la misma cuenta actúa como marca (dueño) y como creador (match por
  -- email), ejercitando los dos lados del hilo.
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Campaign chat verification', 'zz-chat-' || v_org, v_user);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  INSERT INTO public.role_permissions(org_id, role, module, can_view, can_edit)
  VALUES (v_org, 'admin', 'influencers', true, true)
  ON CONFLICT (org_id, role, module) DO UPDATE SET can_view = true, can_edit = true;

  INSERT INTO public.influencers(id, org_id, user_id, name, email, referral_code, status)
  VALUES (gen_random_uuid(), v_org, v_user, 'QA Creador chat', 'qa-chat-' || v_org || '@example.com', 'qa' || substr(v_org::text, 1, 8), 'active')
  RETURNING id INTO v_infl;

  -- Cuenta de creador con el mismo email: habilita el lado creador de la
  -- conversación (los RPC del creador resuelven por creator_accounts).
  INSERT INTO public.creator_accounts(user_id, email) VALUES (v_user, 'qa-chat-' || v_org || '@example.com');

  INSERT INTO public.influencer_campaigns (org_id, title, brief, objective, channel, budget_ars, status, created_by)
  VALUES (v_org, 'QA chat campaña', 'prueba reversible del hilo', 'awareness', 'instagram', 0, 'active', v_user)
  RETURNING id INTO v_camp;

  INSERT INTO public.influencer_campaign_creators (org_id, campaign_id, influencer_id)
  VALUES (v_org, v_camp, v_infl);

  -- ── 2. Marca escribe el primer mensaje ──────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_msg := (public.campaign_chat_send(v_camp, 'Hola! Te comparto el brief actualizado', v_infl)).id;
  ASSERT v_msg IS NOT NULL, 'la marca no pudo escribir el primer mensaje';
  RAISE NOTICE 'OK: marca escribió mensaje %', v_msg;

  -- ── 3. Creador lee el hilo (resuelto por email) y responde ──────────────
  ASSERT (SELECT count(*) FROM public.campaign_chat_list(v_camp)) = 1,
    'el creador deberia ver el mensaje de la marca';
  v_msg := (public.campaign_chat_send(v_camp, 'Recibido, arranco esta semana')).id;
  ASSERT v_msg IS NOT NULL, 'el creador no pudo responder';
  ASSERT (SELECT count(*) FROM public.campaign_chat_list(v_camp)) = 2,
    'el hilo deberia tener 2 mensajes';
  RAISE NOTICE 'OK: creador leyó y respondió';

  -- ── 4. Vista del creador expone el resumen del chat ─────────────────────
  SELECT cc.chat_last_body, cc.chat_last_at, cc.chat_total INTO v_body, v_role, v_total
  FROM public.creator_campaigns() cc WHERE cc.id = v_camp;
  ASSERT v_body = 'Recibido, arranco esta semana', 'chat_last_body no es el ultimo mensaje';
  ASSERT v_total = 2, 'chat_total deberia ser 2';
  RAISE NOTICE 'OK: creator_campaigns expone chat_last_body/chat_total';

  -- ── 5. Anti-spam: segundo mensaje inmediato del mismo autor, rechazo ────
  v_denied := false;
  BEGIN
    PERFORM public.campaign_chat_send(v_camp, 'otro mensaje al toque', v_infl);
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  ASSERT v_denied, 'se permitio mandar dos mensajes en menos de 10s';
  RAISE NOTICE 'OK: anti-spam por hilo+autor';

  -- ── 6. La marca no puede chatear con un creador no asignado ─────────────
  DECLARE
    v_otro uuid;
  BEGIN
    INSERT INTO public.influencers(id, org_id, user_id, name, email, referral_code, status)
    VALUES (gen_random_uuid(), v_org, v_user, 'QA Creador fuera', 'qa-chat2-' || v_org || '@example.com', 'qa2' || substr(v_org::text, 1, 8), 'active')
    RETURNING id INTO v_otro;

    v_denied := false;
    BEGIN
      PERFORM public.campaign_chat_send(v_camp, 'hola de nada', v_otro);
    EXCEPTION WHEN OTHERS THEN v_denied := true; END;
    ASSERT v_denied, 'se permitio chatear con un creador no asignado';
  END;
  RAISE NOTICE 'OK: chat sólo con creadores asignados';

  -- ── 7. Cuerpo inválido: rechazo ─────────────────────────────────────────
  v_denied := false;
  BEGIN
    PERFORM public.campaign_chat_send(v_camp, '   ', v_infl);
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  ASSERT v_denied, 'se acepto un mensaje vacio';
  RAISE NOTICE 'OK: cuerpo vacío rechazado';

  RAISE NOTICE '═══ Todo el chat pasó dentro de la transacción ═══';
  RAISE EXCEPTION 'rollback_intencional';
END;
$verify$;

ROLLBACK;
SELECT 'chat por colaboración verificado y revertido' AS resultado;
