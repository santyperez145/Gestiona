-- Soporte Nerqia: conversación trazable entre un comercio y la plataforma.
--
-- No reutiliza portal_tickets: esos tickets pertenecen a la relación
-- comprador -> comercio. Mezclar ambos canales expondría conversaciones de
-- plataforma en el portal público y haría imposible medir el costo de soporte.

CREATE TABLE IF NOT EXISTS public.platform_support_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 5 AND 120),
  category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('general', 'technical', 'billing', 'account', 'integration')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')),
  assigned_to uuid,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_read_by_org_at timestamptz,
  last_read_by_support_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.platform_support_threads(id) ON DELETE CASCADE,
  sender_user_id uuid,
  sender_kind text NOT NULL CHECK (sender_kind IN ('merchant', 'support', 'system')),
  sender_name text NOT NULL,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_support_threads_org_status_idx
  ON public.platform_support_threads(org_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS platform_support_threads_queue_idx
  ON public.platform_support_threads(status, priority, last_message_at DESC);
CREATE INDEX IF NOT EXISTS platform_support_messages_thread_idx
  ON public.platform_support_messages(thread_id, created_at);

ALTER TABLE public.platform_support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_support_threads_read ON public.platform_support_threads;
CREATE POLICY platform_support_threads_read
  ON public.platform_support_threads FOR SELECT TO authenticated
  USING (
    public.has_permission(org_id, 'support', 'view')
    OR public.has_platform_role(ARRAY['support']::text[])
  );

DROP POLICY IF EXISTS platform_support_messages_read ON public.platform_support_messages;
CREATE POLICY platform_support_messages_read
  ON public.platform_support_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
      FROM public.platform_support_threads thread
     WHERE thread.id = platform_support_messages.thread_id
       AND (
         public.has_permission(thread.org_id, 'support', 'view')
         OR public.has_platform_role(ARRAY['support']::text[])
       )
  ));

-- Las tablas no tienen políticas INSERT/UPDATE/DELETE: toda mutación pasa por
-- estas RPC para que tenant, rol, transición y auditoría se decidan juntos.

CREATE OR REPLACE FUNCTION public.create_platform_support_thread(
  p_org_id uuid,
  p_subject text,
  p_category text DEFAULT 'general',
  p_priority text DEFAULT 'normal',
  p_message text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_thread uuid;
  v_sender_name text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Iniciá sesión para contactar a soporte' USING ERRCODE = '28000';
  END IF;
  IF p_org_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.memberships WHERE org_id = p_org_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'La organización no pertenece a tu cuenta' USING ERRCODE = '42501';
  END IF;
  PERFORM public.exigir_permiso(p_org_id, 'support', 'create', 'contactar a soporte');

  p_subject := btrim(COALESCE(p_subject, ''));
  p_message := btrim(COALESCE(p_message, ''));
  p_category := lower(btrim(COALESCE(p_category, 'general')));
  p_priority := lower(btrim(COALESCE(p_priority, 'normal')));
  IF char_length(p_subject) NOT BETWEEN 5 AND 120 THEN
    RAISE EXCEPTION 'El asunto debe tener entre 5 y 120 caracteres';
  END IF;
  IF char_length(p_message) NOT BETWEEN 2 AND 4000 THEN
    RAISE EXCEPTION 'Contanos el problema con al menos 2 caracteres';
  END IF;
  IF p_category NOT IN ('general', 'technical', 'billing', 'account', 'integration') THEN
    RAISE EXCEPTION 'La categoría elegida no es válida';
  END IF;
  IF p_priority NOT IN ('normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'La prioridad elegida no es válida';
  END IF;

  SELECT COALESCE(NULLIF(btrim(display_name), ''), split_part(auth.jwt()->>'email', '@', 1), 'Comercio')
    INTO v_sender_name
    FROM public.profiles
   WHERE user_id = v_actor
   LIMIT 1;
  v_sender_name := COALESCE(v_sender_name, split_part(auth.jwt()->>'email', '@', 1), 'Comercio');

  INSERT INTO public.platform_support_threads (
    org_id, created_by, subject, category, priority, last_read_by_org_at
  ) VALUES (
    p_org_id, v_actor, p_subject, p_category, p_priority, now()
  ) RETURNING id INTO v_thread;

  INSERT INTO public.platform_support_messages (
    thread_id, sender_user_id, sender_kind, sender_name, body
  ) VALUES (v_thread, v_actor, 'merchant', v_sender_name, p_message);

  INSERT INTO public.notifications (
    user_id, org_id, title, message, type, entity_type, entity_id
  )
  SELECT admin.user_id, p_org_id, 'Nueva conversación de soporte', p_subject,
         'soporte', 'platform_support_thread', v_thread
    FROM public.platform_admins admin
   WHERE admin.role IN ('superadmin', 'support');

  RETURN v_thread;
END $$;

CREATE OR REPLACE FUNCTION public.list_platform_support_threads(p_org_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  org_id uuid,
  org_name text,
  org_slug text,
  subject text,
  category text,
  priority text,
  status text,
  created_by uuid,
  requester_name text,
  assigned_to uuid,
  assigned_name text,
  last_message_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  unread_count bigint,
  latest_message text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_staff boolean := public.has_platform_role(ARRAY['support']::text[]);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Iniciá sesión para ver soporte' USING ERRCODE = '28000';
  END IF;
  IF NOT v_staff AND (
    p_org_id IS NULL OR NOT public.has_permission(p_org_id, 'support', 'view')
  ) THEN
    RAISE EXCEPTION 'No tenés permiso para ver soporte' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT thread.id, thread.org_id, organization.name, organization.slug,
         thread.subject, thread.category, thread.priority, thread.status,
         thread.created_by,
         COALESCE(requester.display_name, split_part(requester_identity.email, '@', 1), 'Comercio'),
         thread.assigned_to,
         COALESCE(assignee.display_name, split_part(assignee_identity.email, '@', 1)),
         thread.last_message_at, thread.created_at, thread.updated_at,
         (SELECT count(*)
            FROM public.platform_support_messages message
           WHERE message.thread_id = thread.id
             AND message.sender_kind = CASE WHEN v_staff THEN 'merchant' ELSE 'support' END
             AND message.created_at > COALESCE(
               CASE WHEN v_staff THEN thread.last_read_by_support_at ELSE thread.last_read_by_org_at END,
               '-infinity'::timestamptz
             )),
         (SELECT message.body
            FROM public.platform_support_messages message
           WHERE message.thread_id = thread.id
           ORDER BY message.created_at DESC LIMIT 1)
    FROM public.platform_support_threads thread
    JOIN public.organizations organization ON organization.id = thread.org_id
    LEFT JOIN public.profiles requester ON requester.user_id = thread.created_by
    LEFT JOIN auth.users requester_identity ON requester_identity.id = thread.created_by
    LEFT JOIN public.profiles assignee ON assignee.user_id = thread.assigned_to
    LEFT JOIN auth.users assignee_identity ON assignee_identity.id = thread.assigned_to
   WHERE (v_staff AND (p_org_id IS NULL OR thread.org_id = p_org_id))
      OR (NOT v_staff AND thread.org_id = p_org_id)
   ORDER BY
     CASE thread.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
     thread.last_message_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.list_platform_support_messages(p_thread_id uuid)
RETURNS TABLE (
  id uuid,
  sender_kind text,
  sender_name text,
  body text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_org uuid;
BEGIN
  SELECT thread.org_id INTO v_org
    FROM public.platform_support_threads thread WHERE thread.id = p_thread_id;
  IF v_org IS NULL OR NOT (
    public.has_permission(v_org, 'support', 'view')
    OR public.has_platform_role(ARRAY['support']::text[])
  ) THEN
    RAISE EXCEPTION 'No tenés acceso a esta conversación' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT message.id, message.sender_kind, message.sender_name, message.body, message.created_at
    FROM public.platform_support_messages message
   WHERE message.thread_id = p_thread_id
   ORDER BY message.created_at;
END $$;

CREATE OR REPLACE FUNCTION public.send_platform_support_message(
  p_thread_id uuid,
  p_message text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_staff boolean := public.has_platform_role(ARRAY['support']::text[]);
  v_sender_name text;
  v_message_id uuid;
BEGIN
  SELECT thread.org_id INTO v_org
    FROM public.platform_support_threads thread
   WHERE thread.id = p_thread_id
   FOR UPDATE;
  IF v_actor IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'La conversación no existe o ya fue cerrada';
  END IF;
  IF NOT v_staff AND NOT public.has_permission(v_org, 'support', 'create') THEN
    RAISE EXCEPTION 'No tenés permiso para responder esta conversación' USING ERRCODE = '42501';
  END IF;
  p_message := btrim(COALESCE(p_message, ''));
  IF char_length(p_message) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'El mensaje debe tener entre 1 y 4000 caracteres';
  END IF;

  SELECT COALESCE(NULLIF(btrim(display_name), ''), split_part(auth.jwt()->>'email', '@', 1),
                  CASE WHEN v_staff THEN 'Soporte Nerqia' ELSE 'Comercio' END)
    INTO v_sender_name
    FROM public.profiles WHERE user_id = v_actor LIMIT 1;
  v_sender_name := COALESCE(v_sender_name, split_part(auth.jwt()->>'email', '@', 1),
                            CASE WHEN v_staff THEN 'Soporte Nerqia' ELSE 'Comercio' END);

  INSERT INTO public.platform_support_messages (
    thread_id, sender_user_id, sender_kind, sender_name, body
  ) VALUES (
    p_thread_id, v_actor, CASE WHEN v_staff THEN 'support' ELSE 'merchant' END,
    v_sender_name, p_message
  ) RETURNING id INTO v_message_id;

  UPDATE public.platform_support_threads
     SET last_message_at = now(), updated_at = now(),
         status = CASE WHEN v_staff THEN 'waiting_customer' ELSE 'open' END,
         assigned_to = CASE WHEN v_staff THEN COALESCE(assigned_to, v_actor) ELSE assigned_to END,
         last_read_by_support_at = CASE WHEN v_staff THEN now() ELSE last_read_by_support_at END,
         last_read_by_org_at = CASE WHEN v_staff THEN last_read_by_org_at ELSE now() END,
         resolved_at = NULL
   WHERE id = p_thread_id;

  IF v_staff THEN
    PERFORM public.avisar_a_los_que_mandan(
      v_org, 'Soporte respondió tu consulta', left(p_message, 180), 'soporte',
      'platform_support_thread', p_thread_id
    );
  ELSE
    INSERT INTO public.notifications (
      user_id, org_id, title, message, type, entity_type, entity_id
    )
    SELECT admin.user_id, v_org, 'Nueva respuesta de un comercio', left(p_message, 180),
           'soporte', 'platform_support_thread', p_thread_id
      FROM public.platform_admins admin
     WHERE admin.role IN ('superadmin', 'support');
  END IF;

  RETURN v_message_id;
END $$;

CREATE OR REPLACE FUNCTION public.update_platform_support_thread(
  p_thread_id uuid,
  p_status text,
  p_assign_to_me boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.has_platform_role(ARRAY['support']::text[]) THEN
    RAISE EXCEPTION 'Sólo el equipo de soporte puede cambiar este estado' USING ERRCODE = '42501';
  END IF;
  p_status := lower(btrim(COALESCE(p_status, '')));
  IF p_status NOT IN ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'El estado elegido no es válido';
  END IF;

  UPDATE public.platform_support_threads
     SET status = p_status,
         assigned_to = CASE WHEN p_assign_to_me THEN v_actor ELSE assigned_to END,
         resolved_at = CASE WHEN p_status IN ('resolved', 'closed') THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = p_thread_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La conversación no existe'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mark_platform_support_thread_read(p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org uuid;
  v_staff boolean := public.has_platform_role(ARRAY['support']::text[]);
BEGIN
  SELECT org_id INTO v_org FROM public.platform_support_threads WHERE id = p_thread_id;
  IF v_org IS NULL OR NOT (
    public.has_permission(v_org, 'support', 'view') OR v_staff
  ) THEN
    RAISE EXCEPTION 'No tenés acceso a esta conversación' USING ERRCODE = '42501';
  END IF;
  UPDATE public.platform_support_threads
     SET last_read_by_support_at = CASE WHEN v_staff THEN now() ELSE last_read_by_support_at END,
         last_read_by_org_at = CASE WHEN v_staff THEN last_read_by_org_at ELSE now() END
   WHERE id = p_thread_id;
END $$;

REVOKE ALL ON TABLE public.platform_support_threads FROM anon;
REVOKE ALL ON TABLE public.platform_support_messages FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.platform_support_threads FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.platform_support_messages FROM authenticated;
GRANT SELECT ON TABLE public.platform_support_threads TO authenticated;
GRANT SELECT ON TABLE public.platform_support_messages TO authenticated;

REVOKE ALL ON FUNCTION public.create_platform_support_thread(uuid, text, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.list_platform_support_threads(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.list_platform_support_messages(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.send_platform_support_message(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.update_platform_support_thread(uuid, text, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.mark_platform_support_thread_read(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_platform_support_thread(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_support_threads(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_support_messages(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_platform_support_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_platform_support_thread(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_platform_support_thread_read(uuid) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'platform_support_threads'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_support_threads;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'platform_support_messages'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_support_messages;
  END IF;
END $$;

COMMENT ON TABLE public.platform_support_threads IS
  'Conversaciones comercio-plataforma. Separadas de portal_tickets, que son comprador-comercio.';
COMMENT ON FUNCTION public.send_platform_support_message(uuid, text) IS
  'Envía un mensaje con identidad y rol derivados de auth; actualiza estado, lectura y notificaciones en una transacción.';
