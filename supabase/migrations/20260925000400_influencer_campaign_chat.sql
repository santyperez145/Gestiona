-- ============================================================================
-- Chat por colaboración (fila 286 del estudio de faltantes / fila 11 P2).
--
-- GoMarz publica mensajería marca↔creador como parte del flujo de campaña.
-- Este lote agrega el hilo de conversación por campaña+creador:
--
--   1. `influencer_campaign_messages`: un hilo por (campaign, influencer).
--      La marca escribe con permiso de influencers; el creador participa
--      desde su portal autenticado. El mensaje guarda el rol de quien escribe
--      para que la conversación se muestre por lado sin adivinar.
--   2. RPC `campaign_chat_list`: lee el hilo (marca o creador, quien tenga
--      parte).
--   3. RPC `campaign_chat_send`: escribe en el hilo con límite de longitud
--      y anti-spam simple (1 msg / 10 s por hilo y autor).
--   4. El creador ve el hilo vía `creator_campaigns` extendida con el
--      último mensaje y total de mensajes no leídos de su lado.
--
-- ⚠️ Lo que NO es: no es email, no es WhatsApp, no reemplaza el brief. Es el
-- canal corto de coordinación dentro de la colaboración ya aceptada.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.influencer_campaign_messages (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id   uuid        NOT NULL REFERENCES public.influencer_campaigns(id) ON DELETE CASCADE,
  influencer_id uuid        NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  -- 'brand' (miembro de la org con permiso) o 'creator' (dueño de la cuenta).
  author_role   text        NOT NULL CHECK (author_role IN ('brand', 'creator')),
  author_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body          text        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, influencer_id, created_at, author_role)
);

CREATE INDEX IF NOT EXISTS idx_campaign_chat_thread
  ON public.influencer_campaign_messages (campaign_id, influencer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_campaign_chat_org
  ON public.influencer_campaign_messages (org_id, created_at DESC);

ALTER TABLE public.influencer_campaign_messages ENABLE ROW LEVEL SECURITY;

-- La marca lee/escribe con permiso de influencers (lectura para el hilo,
-- edición para enviar: la conversación es contenido de la colaboración).
DROP POLICY IF EXISTS campaign_chat_brand ON public.influencer_campaign_messages;
CREATE POLICY campaign_chat_brand ON public.influencer_campaign_messages
  FOR ALL TO authenticated
  USING (
    public.is_org_member(org_id, auth.uid())
    AND public.has_permission(org_id, 'influencers', 'view')
  )
  WITH CHECK (
    public.is_org_member(org_id, auth.uid())
    AND public.has_permission(org_id, 'influencers', 'edit')
  );

REVOKE ALL ON TABLE public.influencer_campaign_messages FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.influencer_campaign_messages TO authenticated;

-- ── Lectura del hilo (marca o creador, según sesión) ───────────────────────
-- La marca pasa p_influencer_id; el creador no pasa nada: el servidor resuelve
-- su perfil por email y devuelve SUS hilos. El cliente nunca declara la org.
CREATE OR REPLACE FUNCTION public.campaign_chat_list(
  p_campaign_id uuid,
  p_influencer_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  author_role text,
  body text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user      uuid := auth.uid();
  v_email     text;
  v_org       uuid;
  v_influencer uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_influencer_id IS NOT NULL THEN
    -- Lado marca: permiso de ver influencers sobre la org de la campaña.
    SELECT org_id INTO v_org FROM public.influencer_campaigns WHERE id = p_campaign_id;
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_org_member(v_org, v_user)
       OR NOT public.has_permission(v_org, 'influencers', 'view') THEN
      RAISE EXCEPTION 'campaign_chat_permission_denied' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT m.id, m.author_role, m.body, m.created_at
      FROM public.influencer_campaign_messages m
      WHERE m.campaign_id = p_campaign_id
        AND m.influencer_id = p_influencer_id
      ORDER BY m.created_at ASC
      LIMIT 200;
  ELSE
    -- Lado creador: todos sus hilos de esa campaña, resueltos por email.
    SELECT email INTO v_email FROM public.creator_accounts WHERE user_id = v_user;
    IF v_email IS NULL THEN
      RAISE EXCEPTION 'not_a_creator' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT m.id, m.author_role, m.body, m.created_at
      FROM public.influencer_campaign_messages m
      JOIN public.influencers i ON i.id = m.influencer_id
      WHERE m.campaign_id = p_campaign_id
        AND lower(i.email) = lower(v_email)
      ORDER BY m.created_at ASC
      LIMIT 200;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.campaign_chat_list(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_chat_list(uuid, uuid) TO authenticated;

-- ── Envío de mensajes (marca o creador) ─────────────────────────────────────
-- Marca: pasa p_influencer_id y necesita permiso de edición de influencers.
-- Creador: no pasa p_influencer_id; se resuelve por email, y sólo puede
-- escribir en campañas que tiene asignadas (existe la fila en
-- influencer_campaign_creators).
CREATE OR REPLACE FUNCTION public.campaign_chat_send(
  p_campaign_id uuid,
  p_body text,
  p_influencer_id uuid DEFAULT NULL
)
RETURNS public.influencer_campaign_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user        uuid := auth.uid();
  v_email       text;
  v_org         uuid;
  v_influencer  uuid;
  v_role        text;
  v_assigned    boolean;
  v_last_at     timestamptz;
  v_row         public.influencer_campaign_messages;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'invalid_body' USING ERRCODE = '22023';
  END IF;

  -- Resolver identidad y parte.
  IF p_influencer_id IS NOT NULL THEN
    -- Lado marca.
    SELECT org_id INTO v_org FROM public.influencer_campaigns WHERE id = p_campaign_id;
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_org_member(v_org, v_user)
       OR NOT public.has_permission(v_org, 'influencers', 'edit') THEN
      RAISE EXCEPTION 'campaign_chat_permission_denied' USING ERRCODE = '42501';
    END IF;
    -- El creador tiene que estar asignado a la campaña: no hay chat con un
    -- creador que no participa de la colaboración.
    IF NOT EXISTS (
      SELECT 1 FROM public.influencer_campaign_creators cc
      WHERE cc.campaign_id = p_campaign_id AND cc.influencer_id = p_influencer_id
    ) THEN
      RAISE EXCEPTION 'creator_not_assigned' USING ERRCODE = '22023';
    END IF;
    v_influencer := p_influencer_id;
    v_role := 'brand';
  ELSE
    -- Lado creador: perfil por email + asignación a la campaña.
    SELECT email INTO v_email FROM public.creator_accounts WHERE user_id = v_user;
    IF v_email IS NULL THEN
      RAISE EXCEPTION 'not_a_creator' USING ERRCODE = '42501';
    END IF;
    SELECT i.id INTO v_influencer
    FROM public.influencers i
    JOIN public.influencer_campaign_creators cc
      ON cc.campaign_id = p_campaign_id AND cc.influencer_id = i.id
    WHERE i.org_id = (SELECT org_id FROM public.influencer_campaigns WHERE id = p_campaign_id)
      AND lower(i.email) = lower(v_email)
    LIMIT 1;
    IF v_influencer IS NULL THEN
      RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = '22023';
    END IF;
    v_org := (SELECT org_id FROM public.influencer_campaigns WHERE id = p_campaign_id);
    v_role := 'creator';
  END IF;

  -- Anti-spam simple: máximo 1 mensaje cada 10 segundos por hilo+autor.
  SELECT max(created_at) INTO v_last_at
  FROM public.influencer_campaign_messages
  WHERE campaign_id = p_campaign_id
    AND influencer_id = v_influencer
    AND author_role = v_role
    AND author_id = v_user;
  IF v_last_at IS NOT NULL AND v_last_at > now() - interval '10 seconds' THEN
    RAISE EXCEPTION 'chat_rate_limited' USING ERRCODE = '42901';
  END IF;

  INSERT INTO public.influencer_campaign_messages (
    org_id, campaign_id, influencer_id, author_role, author_id, body
  ) VALUES (
    v_org, p_campaign_id, v_influencer, v_role, v_user, btrim(p_body)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.campaign_chat_send(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_chat_send(uuid, text, uuid) TO authenticated;

-- ── Portal del creador: el hilo vive junto a la campaña ────────────────────
-- Último mensaje + total, para que la bandeja muestre "chat activo" sin
-- abrir el hilo. Mantiene el resto de la firma de creator_campaigns.
DROP FUNCTION IF EXISTS public.creator_campaigns();
CREATE OR REPLACE FUNCTION public.creator_campaigns()
RETURNS TABLE (
  id uuid,
  org_id uuid,
  org_name text,
  title text,
  brief text,
  channel text,
  due_date date,
  status text,
  budget_ars numeric,
  invitation_status text,
  deliverable_url text,
  deliverable_status text,
  publication_url text,
  publication_platform text,
  publication_verified_at timestamptz,
  chat_last_body text,
  chat_last_at timestamptz,
  chat_total integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.org_id, o.name, c.title, c.brief, c.channel, c.due_date,
         c.status, c.budget_ars,
         (SELECT ii.status FROM public.influencer_invitations ii
          WHERE ii.campaign_id = c.id AND lower(ii.email) = lower(ca.email)
          ORDER BY ii.created_at DESC LIMIT 1),
         (SELECT d.content_url FROM public.influencer_deliverables d
          WHERE d.campaign_id = c.id AND d.influencer_id = i.id
          ORDER BY d.created_at DESC LIMIT 1),
         (SELECT d.status FROM public.influencer_deliverables d
          WHERE d.campaign_id = c.id AND d.influencer_id = i.id
          ORDER BY d.created_at DESC LIMIT 1),
         proof.publication_url,
         proof.platform,
         proof.verified_at,
         chat.last_body,
         chat.last_at,
         chat.total
  FROM public.influencer_campaigns c
  JOIN public.influencers i ON i.org_id = c.org_id
  JOIN public.creator_accounts ca ON ca.user_id = auth.uid()
  LEFT JOIN public.organizations o ON o.id = c.org_id
  LEFT JOIN LATERAL (
    SELECT pp.publication_url, pp.platform, pp.created_at AS verified_at
    FROM public.influencer_publication_proofs pp
    WHERE pp.campaign_id = c.id AND pp.influencer_id = i.id
    ORDER BY pp.created_at DESC LIMIT 1
  ) proof ON true
  LEFT JOIN LATERAL (
    SELECT (array_agg(m.body ORDER BY m.created_at DESC))[1] AS last_body,
           (array_agg(m.created_at ORDER BY m.created_at DESC))[1] AS last_at,
           count(*)::integer AS total
    FROM public.influencer_campaign_messages m
    WHERE m.campaign_id = c.id AND m.influencer_id = i.id
  ) chat ON true
  WHERE lower(i.email) = lower(ca.email)
    AND EXISTS (SELECT 1 FROM public.influencer_campaign_creators cc
                WHERE cc.campaign_id = c.id AND cc.influencer_id = i.id)
  ORDER BY c.due_date NULLS LAST, c.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.creator_campaigns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creator_campaigns() TO authenticated;

-- ── Contrato de seguridad ───────────────────────────────────────────────────
INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT 'campaign_chat_list',
  'p_campaign_id uuid, p_influencer_id uuid',
  'authenticated_delegate',
  'Lee el hilo de chat de una colaboración: la marca con permiso de ver, el creador sus propios hilos por email.',
  md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-25'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'campaign_chat_list'
  AND pg_get_function_identity_arguments(procedure.oid) =
    'p_campaign_id uuid, p_influencer_id uuid'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT 'campaign_chat_send',
  'p_campaign_id uuid, p_body text, p_influencer_id uuid',
  'authenticated_delegate',
  'Escribe en el hilo: marca con permiso de edición y creador asignado; anti-spam por hilo+autor.',
  md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-25'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'campaign_chat_send'
  AND pg_get_function_identity_arguments(procedure.oid) =
    'p_campaign_id uuid, p_body text, p_influencer_id uuid'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

-- ── Certificación ───────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class t ON a.attrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'influencer_campaign_messages'
      AND a.attname = 'author_role'
  ) THEN
    RAISE EXCEPTION 'influencer_campaign_messages incompleta';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'campaign_chat_list'
  ) THEN
    RAISE EXCEPTION 'campaign_chat_list no existe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'campaign_chat_send'
  ) THEN
    RAISE EXCEPTION 'campaign_chat_send no existe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'creator_campaigns'
      AND pg_get_function_result(p.oid) LIKE '%chat_last_body%'
  ) THEN
    RAISE EXCEPTION 'creator_campaigns sin columnas de chat';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260925000400', 'influencer_campaign_chat')
ON CONFLICT DO NOTHING;
