-- ============================================================================
-- Notificaciones consentidas del chat de campañas (fila 291 del estudio de
-- faltantes: «Quedan notificaciones push consentidas»).
--
-- ⚠️ El chat marca↔creador existe pero el mensaje que llega fuera de la
-- pantalla no llega por ningún canal: si el creador no entra al portal, el
-- mensaje de la marca no existe para él. GoMarz avisa; acá faltaba.
--
-- 📌 Consentimiento primero: nadie recibe correo ni push sin haberlos pedido.
-- La preferencia es por usuario, separada para el lado marca y el lado creador
-- (la misma persona puede estar en ambos lados con preferencias distintas).
-- Sin preferencia no hay cola: el aviso vive sólo dentro de la app.
--
-- Caminos de salida, ambos ya existentes:
--   - Correo: entra a la cola de `notifications` (enviar_por_correo) y el cron
--     `avisos-por-correo` lo manda con el remitente de la plataforma.
--   - Push: `push_subscriptions` por user_id + `send-push` (Web Push VAPID).
--
-- Lo que NO es: no es WhatsApp, no es un resumen diario, no avisa leídas.
-- ============================================================================

-- ── Preferencias de notificación ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.influencer_chat_notify_prefs (
  user_id       uuid    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Consentimiento explícito por canal. NULL o false = sin consentimiento.
  email_enabled boolean NOT NULL DEFAULT false,
  push_enabled  boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.influencer_chat_notify_prefs ENABLE ROW LEVEL SECURITY;

-- Cada uno ve y cambia únicamente su preferencia. Nadie la consiente por otro.
DROP POLICY IF EXISTS influencer_chat_notify_prefs_own ON public.influencer_chat_notify_prefs;
CREATE POLICY influencer_chat_notify_prefs_own ON public.influencer_chat_notify_prefs
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON TABLE public.influencer_chat_notify_prefs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.influencer_chat_notify_prefs TO authenticated;

-- ── Cola de notificaciones de chat ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.influencer_chat_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES public.influencer_campaign_messages(id) ON DELETE CASCADE,
  -- A quién: el usuario con sesión que pidió ese canal.
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('email', 'push')),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error  text,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_chat_notifications_pending
  ON public.influencer_chat_notifications (status, created_at)
  WHERE status = 'pending';

ALTER TABLE public.influencer_chat_notifications ENABLE ROW LEVEL SECURITY;

-- Los usuarios leen sus propias filas de cola. El resto (despacho, lectura
-- admin) es service_role, que no pasa por RLS.
DROP POLICY IF EXISTS influencer_chat_notifications_own ON public.influencer_chat_notifications;
CREATE POLICY influencer_chat_notifications_own ON public.influencer_chat_notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.influencer_chat_notifications FROM anon, authenticated;
GRANT SELECT ON TABLE public.influencer_chat_notifications TO authenticated;

-- ── Encolado al enviar un mensaje ───────────────────────────────────────────
-- Se llama desde `campaign_chat_send` con el mensaje ya insertado. Encola
-- según la preferencia del DESTINATARIO (el otro lado del hilo), nunca del
-- autor: el consentimiento que vale es el de quien recibe.
CREATE OR REPLACE FUNCTION public.campaign_chat_enqueue_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_recipient uuid;
  v_title     text;
BEGIN
  -- El destinatario es el otro lado: si escribe la marca, avisa al creador.
  IF NEW.author_role = 'brand' THEN
    SELECT ca.user_id INTO v_recipient
      FROM public.creator_accounts ca
      JOIN public.influencers i ON lower(i.email) = lower(ca.email)
     WHERE i.id = NEW.influencer_id
     LIMIT 1;
  ELSE
    -- El creador escribe: avisa a los miembros de la marca con permiso.
    -- Sin preferencia no hay fila: no hay consentimiento, no hay aviso.
    SELECT DISTINCT ON (m.user_id) m.user_id INTO v_recipient
      FROM public.memberships m
      JOIN public.influencer_chat_notify_prefs p ON p.user_id = m.user_id
     WHERE m.org_id = NEW.org_id
       AND m.role::text IN ('owner', 'admin')
       AND (p.email_enabled OR p.push_enabled)
     ORDER BY m.user_id;
  END IF;

  IF v_recipient IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.title INTO v_title
    FROM public.influencer_campaigns c WHERE c.id = NEW.campaign_id;

  IF NEW.author_role = 'brand' THEN
    -- Creador: usa sus preferencias propias.
    INSERT INTO public.influencer_chat_notifications (message_id, user_id, channel)
    SELECT NEW.id, v_recipient, ch.ch
      FROM (VALUES ('email'), ('push')) AS ch(ch)
     WHERE EXISTS (
       SELECT 1 FROM public.influencer_chat_notify_prefs p
        WHERE p.user_id = v_recipient
          AND ((ch.ch = 'email' AND p.email_enabled) OR (ch.ch = 'push' AND p.push_enabled))
     )
    ON CONFLICT (message_id, user_id, channel) DO NOTHING;
  ELSE
    -- Marca: cada miembro owner/admin con preferencia recibe su fila.
    INSERT INTO public.influencer_chat_notifications (message_id, user_id, channel)
    SELECT DISTINCT NEW.id, m.user_id, ch.ch
      FROM public.memberships m
      JOIN public.influencer_chat_notify_prefs p ON p.user_id = m.user_id
      CROSS JOIN (VALUES ('email'), ('push')) AS ch(ch)
     WHERE m.org_id = NEW.org_id
       AND m.role::text IN ('owner', 'admin')
       AND m.suspendido_por_plan IS NOT TRUE
       AND ((ch.ch = 'email' AND p.email_enabled) OR (ch.ch = 'push' AND p.push_enabled))
    ON CONFLICT (message_id, user_id, channel) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.campaign_chat_enqueue_notifications()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_campaign_chat_enqueue ON public.influencer_campaign_messages;
CREATE TRIGGER trg_campaign_chat_enqueue
  AFTER INSERT ON public.influencer_campaign_messages
  FOR EACH ROW EXECUTE FUNCTION public.campaign_chat_enqueue_notifications();

-- ── RPC de preferencias ─────────────────────────────────────────────────────
-- La preferencia es por persona, no por org: la misma cuenta puede ser miembro
-- de una marca y creador de otra, y el canal se decide una vez.
CREATE OR REPLACE FUNCTION public.campaign_chat_notify_get()
RETURNS TABLE (email_enabled boolean, push_enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.email_enabled, p.push_enabled
    FROM public.influencer_chat_notify_prefs p
   WHERE p.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.campaign_chat_notify_get() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_chat_notify_get() TO authenticated;

CREATE OR REPLACE FUNCTION public.campaign_chat_notify_set(
  p_email boolean,
  p_push  boolean
)
RETURNS TABLE (email_enabled boolean, push_enabled boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_email boolean := COALESCE(p_email, false);
  v_push  boolean := COALESCE(p_push, false);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- Consentimiento explícito: la fila se crea sólo cuando el usuario decide.
  INSERT INTO public.influencer_chat_notify_prefs (user_id, email_enabled, push_enabled)
  VALUES (auth.uid(), v_email, v_push)
  ON CONFLICT (user_id) DO UPDATE
    SET email_enabled = EXCLUDED.email_enabled,
        push_enabled  = EXCLUDED.push_enabled,
        updated_at    = now();

  RETURN QUERY SELECT v_email, v_push;
END;
$fn$;

REVOKE ALL ON FUNCTION public.campaign_chat_notify_set(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_chat_notify_set(boolean, boolean) TO authenticated;

-- ── Despacho: lo que lee el Edge ────────────────────────────────────────────
-- service_role lee la cola con los datos necesarios para enviar. Marca el
-- resultado real; un envío fallido vuelve a la cola con el motivo anotado.
CREATE OR REPLACE FUNCTION public.campaign_chat_notifications_pending()
RETURNS TABLE (
  id          uuid,
  message_id  uuid,
  user_id     uuid,
  channel     text,
  body        text,
  author_role text,
  campaign_title text,
  org_name    text,
  email       text,
  endpoint    text,
  p256dh      text,
  auth_key    text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Correo: destino = email de la cuenta que pidió ese canal.
  SELECT n.id, n.message_id, n.user_id, n.channel,
         m.body, m.author_role, c.title, o.name, u.email,
         NULL::text, NULL::text, NULL::text
    FROM public.influencer_chat_notifications n
    JOIN public.influencer_campaign_messages m ON m.id = n.message_id
    JOIN public.influencer_campaigns c ON c.id = m.campaign_id
    JOIN public.organizations o ON o.id = m.org_id
    JOIN auth.users u ON u.id = n.user_id
   WHERE n.channel = 'email' AND n.status = 'pending'
     AND n.created_at > now() - interval '3 days'
   UNION ALL
  -- Push: destino = la suscripción web push del dispositivo.
  SELECT n.id, n.message_id, n.user_id, n.channel,
         m.body, m.author_role, c.title, o.name, NULL::text,
         s.endpoint, s.p256dh, s.auth
    FROM public.influencer_chat_notifications n
    JOIN public.influencer_campaign_messages m ON m.id = n.message_id
    JOIN public.influencer_campaigns c ON c.id = m.campaign_id
    JOIN public.organizations o ON o.id = m.org_id
    JOIN public.push_subscriptions s ON s.user_id = n.user_id
   WHERE n.channel = 'push' AND n.status = 'pending'
     AND n.created_at > now() - interval '3 days';
$$;

REVOKE ALL ON FUNCTION public.campaign_chat_notifications_pending()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_chat_notifications_pending() TO service_role;

CREATE OR REPLACE FUNCTION public.campaign_chat_notification_result(
  p_id uuid, p_ok boolean, p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.influencer_chat_notifications
     SET status    = CASE WHEN p_ok THEN 'sent' ELSE 'failed' END,
         attempts  = attempts + 1,
         sent_at   = CASE WHEN p_ok THEN now() ELSE sent_at END,
         last_error = CASE WHEN p_ok THEN NULL ELSE left(COALESCE(p_error, 'sin detalle'), 500) END
   WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.campaign_chat_notification_result(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_chat_notification_result(uuid, boolean, text) TO service_role;

-- Los fallidos se reintentan: la cola vuelve a exponerlos hasta 3 intentos.
CREATE OR REPLACE FUNCTION public.campaign_chat_notifications_retry()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.influencer_chat_notifications
     SET status = 'pending'
   WHERE status = 'failed' AND attempts < 3;
$$;

REVOKE ALL ON FUNCTION public.campaign_chat_notifications_retry()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_chat_notifications_retry() TO service_role;

-- ── Contrato de seguridad ───────────────────────────────────────────────────
INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT 'campaign_chat_notify_get', '', 'authenticated_delegate',
  'Lee la preferencia de notificación del chat del propio usuario; sin fila no hay consentimiento.',
  md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-25'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public' AND procedure.proname = 'campaign_chat_notify_get'
  AND pg_get_function_identity_arguments(procedure.oid) = ''
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT 'campaign_chat_notify_set', 'p_email boolean, p_push boolean', 'authenticated_delegate',
  'Escribe la preferencia de notificación del propio usuario: el consentimiento es del titular.',
  md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-25'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public' AND procedure.proname = 'campaign_chat_notify_set'
  AND pg_get_function_identity_arguments(procedure.oid) = 'p_email boolean, p_push boolean'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

-- ── Certificación ───────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF to_regclass('public.influencer_chat_notify_prefs') IS NULL THEN
    RAISE EXCEPTION 'influencer_chat_notify_prefs no existe';
  END IF;
  IF to_regclass('public.influencer_chat_notifications') IS NULL THEN
    RAISE EXCEPTION 'influencer_chat_notifications no existe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgname = 'trg_campaign_chat_enqueue' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'trigger de encolado no existe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'campaign_chat_notifications_pending'
  ) THEN
    RAISE EXCEPTION 'campaign_chat_notifications_pending no existe';
  END IF;
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260925000500', 'influencer_chat_notifications')
ON CONFLICT DO NOTHING;