-- D3 — comunicaciones operativas de la plataforma hacia los comercios.
--
-- Un aviso de mantenimiento no es contenido de la tienda ni un ajuste de una
-- organización. Pertenece a la superficie de plataforma y sólo superadmin lo
-- puede publicar. Los comercios reciben una proyección mínima por RPC y el
-- descarte es personal: nunca borra el aviso para otra organización.

CREATE TABLE IF NOT EXISTS public.platform_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  tone text NOT NULL DEFAULT 'info',
  cta_label text,
  cta_url text,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_announcements_title_length CHECK (char_length(btrim(title)) BETWEEN 3 AND 140),
  CONSTRAINT platform_announcements_body_length CHECK (char_length(btrim(body)) BETWEEN 3 AND 1200),
  CONSTRAINT platform_announcements_tone_check CHECK (tone IN ('info', 'maintenance', 'warning', 'success')),
  CONSTRAINT platform_announcements_cta_pair_check CHECK (
    (cta_label IS NULL AND cta_url IS NULL)
    OR (char_length(btrim(cta_label)) BETWEEN 1 AND 60 AND cta_url IS NOT NULL)
  ),
  -- Las llamadas a la acción son rutas internas. Así el banner no se vuelve
  -- una superficie de phishing ni abre un tercero sin que el comercio lo note.
  CONSTRAINT platform_announcements_cta_url_check CHECK (
    cta_url IS NULL
    OR (cta_url ~ '^/' AND cta_url !~ '^//' AND cta_url !~ '[[:space:]]')
  ),
  CONSTRAINT platform_announcements_window_check CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.platform_announcement_dismissals (
  announcement_id uuid NOT NULL REFERENCES public.platform_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS platform_announcements_active_idx
  ON public.platform_announcements (starts_at, ends_at)
  WHERE published_at IS NOT NULL AND archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_platform_announcement_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_announcements_updated_at ON public.platform_announcements;
CREATE TRIGGER trg_platform_announcements_updated_at
  BEFORE UPDATE ON public.platform_announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_platform_announcement_updated_at();

ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_announcement_dismissals ENABLE ROW LEVEL SECURITY;

-- No hay policies de tablas a propósito. El navegador no puede recorrer
-- borradores, historial ni descartes de otros usuarios; cada camino se reduce
-- a un RPC con autorización y proyección explícitas.
REVOKE ALL ON TABLE public.platform_announcements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_announcement_dismissals FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_platform_announcements()
RETURNS TABLE(
  id uuid,
  title text,
  body text,
  tone text,
  cta_label text,
  cta_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  published_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  -- Un comprador de tienda no es usuario de una organización: no debe recibir
  -- comunicaciones internas aunque tenga una cuenta en auth.users.
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.memberships m WHERE m.user_id = v_user_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT a.id, a.title, a.body, a.tone, a.cta_label, a.cta_url,
         a.starts_at, a.ends_at, a.published_at
  FROM public.platform_announcements a
  WHERE a.published_at IS NOT NULL
    AND a.archived_at IS NULL
    AND a.starts_at <= now()
    AND (a.ends_at IS NULL OR a.ends_at > now())
    AND NOT EXISTS (
      SELECT 1
      FROM public.platform_announcement_dismissals d
      WHERE d.announcement_id = a.id AND d.user_id = v_user_id
    )
  ORDER BY a.starts_at DESC, a.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_platform_announcement(p_announcement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.memberships m WHERE m.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'No tenés acceso a anuncios de plataforma';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_announcements a
    WHERE a.id = p_announcement_id
      AND a.published_at IS NOT NULL
      AND a.archived_at IS NULL
      AND a.starts_at <= now()
      AND (a.ends_at IS NULL OR a.ends_at > now())
  ) THEN
    RAISE EXCEPTION 'El anuncio ya no está disponible';
  END IF;

  INSERT INTO public.platform_announcement_dismissals (announcement_id, user_id)
  VALUES (p_announcement_id, v_user_id)
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_platform_announcements()
RETURNS SETOF public.platform_announcements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_platform_role(ARRAY['superadmin'], auth.uid()) THEN
    RAISE EXCEPTION 'Sólo un superadmin puede administrar anuncios';
  END IF;

  RETURN QUERY
  SELECT a.*
  FROM public.platform_announcements a
  ORDER BY a.archived_at NULLS FIRST, a.published_at DESC NULLS LAST, a.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_platform_announcement(
  p_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_body text DEFAULT NULL,
  p_tone text DEFAULT 'info',
  p_cta_label text DEFAULT NULL,
  p_cta_url text DEFAULT NULL,
  p_starts_at timestamptz DEFAULT now(),
  p_ends_at timestamptz DEFAULT NULL,
  p_publish boolean DEFAULT false
)
RETURNS public.platform_announcements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_saved public.platform_announcements;
  v_action text;
  v_email text := (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'email');
BEGIN
  IF v_user_id IS NULL
     OR NOT public.has_platform_role(ARRAY['superadmin'], v_user_id) THEN
    RAISE EXCEPTION 'Sólo un superadmin puede publicar anuncios';
  END IF;

  IF coalesce(char_length(btrim(p_title)), 0) NOT BETWEEN 3 AND 140 THEN
    RAISE EXCEPTION 'El título debe tener entre 3 y 140 caracteres';
  END IF;
  IF coalesce(char_length(btrim(p_body)), 0) NOT BETWEEN 3 AND 1200 THEN
    RAISE EXCEPTION 'El mensaje debe tener entre 3 y 1200 caracteres';
  END IF;
  IF p_tone NOT IN ('info', 'maintenance', 'warning', 'success') THEN
    RAISE EXCEPTION 'El tipo de anuncio no es válido';
  END IF;
  IF (p_cta_label IS NULL) <> (p_cta_url IS NULL) THEN
    RAISE EXCEPTION 'La acción necesita texto y una ruta interna';
  END IF;
  IF p_cta_label IS NOT NULL AND coalesce(char_length(btrim(p_cta_label)), 0) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'El texto de la acción debe tener entre 1 y 60 caracteres';
  END IF;
  IF p_cta_url IS NOT NULL AND (p_cta_url !~ '^/' OR p_cta_url ~ '^//' OR p_cta_url ~ '[[:space:]]') THEN
    RAISE EXCEPTION 'La acción debe apuntar a una ruta interna que empiece con /';
  END IF;
  IF p_starts_at IS NULL OR (p_ends_at IS NOT NULL AND p_ends_at <= p_starts_at) THEN
    RAISE EXCEPTION 'La vigencia del anuncio no es válida';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.platform_announcements (
      title, body, tone, cta_label, cta_url, starts_at, ends_at, published_at,
      created_by, updated_by
    ) VALUES (
      btrim(p_title), btrim(p_body), p_tone, nullif(btrim(p_cta_label), ''),
      nullif(btrim(p_cta_url), ''), p_starts_at, p_ends_at,
      CASE WHEN p_publish THEN now() ELSE NULL END, v_user_id, v_user_id
    )
    RETURNING * INTO v_saved;
    v_action := CASE WHEN p_publish THEN 'platform_announcement_published' ELSE 'platform_announcement_drafted' END;
  ELSE
    UPDATE public.platform_announcements a
    SET title = btrim(p_title),
        body = btrim(p_body),
        tone = p_tone,
        cta_label = nullif(btrim(p_cta_label), ''),
        cta_url = nullif(btrim(p_cta_url), ''),
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        published_at = CASE WHEN p_publish THEN coalesce(a.published_at, now()) ELSE NULL END,
        archived_at = NULL,
        updated_by = v_user_id
    WHERE a.id = p_id
    RETURNING * INTO v_saved;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'El anuncio no existe';
    END IF;
    v_action := CASE WHEN p_publish THEN 'platform_announcement_updated' ELSE 'platform_announcement_unpublished' END;
  END IF;

  INSERT INTO public.admin_audit_logs (admin_user_id, admin_email, action, details)
  VALUES (
    v_user_id,
    v_email,
    v_action,
    jsonb_build_object(
      'announcement_id', v_saved.id,
      'title', v_saved.title,
      'tone', v_saved.tone,
      'starts_at', v_saved.starts_at,
      'ends_at', v_saved.ends_at
    )
  );

  RETURN v_saved;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_platform_announcement(p_id uuid)
RETURNS public.platform_announcements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_saved public.platform_announcements;
  v_email text := (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'email');
BEGIN
  IF v_user_id IS NULL
     OR NOT public.has_platform_role(ARRAY['superadmin'], v_user_id) THEN
    RAISE EXCEPTION 'Sólo un superadmin puede archivar anuncios';
  END IF;

  UPDATE public.platform_announcements a
  SET archived_at = coalesce(a.archived_at, now()), updated_by = v_user_id
  WHERE a.id = p_id
  RETURNING * INTO v_saved;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El anuncio no existe';
  END IF;

  INSERT INTO public.admin_audit_logs (admin_user_id, admin_email, action, details)
  VALUES (
    v_user_id,
    v_email,
    'platform_announcement_archived',
    jsonb_build_object('announcement_id', v_saved.id, 'title', v_saved.title)
  );

  RETURN v_saved;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_platform_announcements() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dismiss_platform_announcement(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_platform_announcements() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_platform_announcement(uuid, text, text, text, text, text, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_platform_announcement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_platform_announcements() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_platform_announcement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_platform_announcements() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_platform_announcement(uuid, text, text, text, text, text, timestamptz, timestamptz, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_platform_announcement(uuid) TO authenticated;

COMMENT ON TABLE public.platform_announcements IS
  'D3: anuncios operativos de plataforma. Sólo RPC SECURITY DEFINER expone publicaciones a miembros de organizaciones o permite gestión a superadmin.';
COMMENT ON TABLE public.platform_announcement_dismissals IS
  'D3: descarte personal de avisos de plataforma; no modifica la visibilidad de otro comercio.';

-- Verificación real contra roles de API: superadmin publica, un miembro lo ve
-- y lo descarta para sí. Un usuario sin membresía no obtiene filas y anon no
-- puede ejecutar los RPC; las tablas tampoco tienen SELECT directo. Todo lo ZZ
-- y su auditoría se elimina al terminar.
CREATE TEMP TABLE IF NOT EXISTS zz_platform_announcements_verification (
  check_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL
);
TRUNCATE zz_platform_announcements_verification;

DO $verify$
DECLARE
  v_staff uuid;
  v_member uuid;
  v_outsider uuid := gen_random_uuid();
  v_announcement public.platform_announcements;
  v_visible_before integer;
  v_visible integer;
  v_outsider_visible integer;
  v_anon_execute boolean;
  v_direct_select boolean;
BEGIN
  SELECT user_id INTO v_staff
  FROM public.platform_admins
  WHERE role = 'superadmin'
  ORDER BY granted_at
  LIMIT 1;

  SELECT m.user_id INTO v_member
  FROM public.memberships m
  WHERE m.user_id <> v_staff
  ORDER BY m.created_at
  LIMIT 1;

  IF v_staff IS NULL OR v_member IS NULL THEN
    RAISE EXCEPTION 'Se necesita un superadmin y un miembro ajeno para verificar anuncios';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_staff::text, 'role', 'authenticated', 'email', 'zz-platform@example.invalid'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT * INTO v_announcement
  FROM public.save_platform_announcement(
    NULL,
    'ZZ Aviso operativo',
    'ZZ Verificación de anuncios por rol y descarte individual.',
    'maintenance',
    'Ver estado',
    '/estado',
    now() - interval '1 minute',
    now() + interval '1 day',
    true
  );
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_member::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_visible_before
  FROM public.get_my_platform_announcements()
  WHERE id = v_announcement.id;
  PERFORM public.dismiss_platform_announcement(v_announcement.id);
  SELECT count(*) INTO v_visible
  FROM public.get_my_platform_announcements()
  WHERE id = v_announcement.id;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_outsider::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_outsider_visible
  FROM public.get_my_platform_announcements()
  WHERE id = v_announcement.id;
  EXECUTE 'RESET ROLE';

  SELECT has_function_privilege('anon', 'public.get_my_platform_announcements()', 'EXECUTE')
  INTO v_anon_execute;

  SELECT has_table_privilege('authenticated', 'public.platform_announcements', 'SELECT')
  INTO v_direct_select;

  IF v_visible_before <> 1 OR v_visible <> 0 OR v_outsider_visible <> 0 OR v_anon_execute OR v_direct_select THEN
    RAISE EXCEPTION 'ACL de anuncios inválida: miembro antes %, post-descarte %, ajeno %, anon execute %, tabla select %',
      v_visible_before, v_visible, v_outsider_visible, v_anon_execute, v_direct_select;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.platform_announcement_dismissals
    WHERE announcement_id = v_announcement.id AND user_id = v_member
  ) THEN
    RAISE EXCEPTION 'El descarte personal no quedó registrado';
  END IF;

  DELETE FROM public.platform_announcement_dismissals WHERE announcement_id = v_announcement.id;
  DELETE FROM public.admin_audit_logs
  WHERE action LIKE 'platform_announcement_%'
    AND details ->> 'announcement_id' = v_announcement.id::text;
  DELETE FROM public.platform_announcements WHERE id = v_announcement.id;

  IF EXISTS (SELECT 1 FROM public.platform_announcements WHERE title LIKE 'ZZ Aviso operativo%')
     OR EXISTS (SELECT 1 FROM public.platform_announcement_dismissals d WHERE d.announcement_id = v_announcement.id) THEN
    RAISE EXCEPTION 'La verificación de anuncios dejó restos ZZ';
  END IF;

  INSERT INTO zz_platform_announcements_verification VALUES
    ('publicación_y_descarte', true, 'superadmin publicó; miembro vio y descartó sólo su copia'),
    ('aislamiento', true, 'usuario sin membresía no recibe filas; anon y acceso directo a tablas cerrados'),
    ('limpieza', true, 'anuncio, descarte y auditoría ZZ eliminados');
END
$verify$;

SELECT check_name, passed, detail
FROM zz_platform_announcements_verification
ORDER BY check_name;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260815000011', 'platform_announcements') ON CONFLICT DO NOTHING;
