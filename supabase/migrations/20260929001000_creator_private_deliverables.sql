BEGIN;

CREATE TABLE public.influencer_deliverable_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  deliverable_id uuid NOT NULL REFERENCES public.influencer_deliverables(id) ON DELETE RESTRICT,
  influencer_id uuid NOT NULL REFERENCES public.influencers(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  storage_path text NOT NULL UNIQUE,
  original_filename text NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (mime_type IN (
    'video/mp4', 'video/quicktime', 'video/webm',
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
  )),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 52428800),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  upload_status text NOT NULL DEFAULT 'pending_upload'
    CHECK (upload_status IN ('pending_upload', 'uploaded', 'failed', 'quarantined')),
  failure_reason text,
  retention_until date NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  CONSTRAINT influencer_deliverable_files_campaign_org_fk
    FOREIGN KEY (org_id, campaign_id)
    REFERENCES public.influencer_campaigns(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT influencer_deliverable_files_version_unique
    UNIQUE (deliverable_id, version_number)
);

CREATE INDEX influencer_deliverable_files_org_idx
  ON public.influencer_deliverable_files(org_id, created_at DESC);
CREATE INDEX influencer_deliverable_files_campaign_idx
  ON public.influencer_deliverable_files(campaign_id, influencer_id, version_number DESC);

ALTER TABLE public.influencer_deliverable_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.influencer_deliverable_files FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.influencer_deliverable_files TO authenticated;

CREATE OR REPLACE FUNCTION public.creator_owns_influencer(p_influencer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.influencers influencer
    JOIN public.creator_accounts account ON account.user_id = auth.uid()
    WHERE influencer.id = p_influencer_id
      AND lower(influencer.email) = lower(account.email)
  );
$fn$;

REVOKE ALL ON FUNCTION public.creator_owns_influencer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creator_owns_influencer(uuid) TO authenticated;

CREATE POLICY "deliverable files visible to collaboration parties"
  ON public.influencer_deliverable_files
  FOR SELECT TO authenticated
  USING (
    public.can_manage_influencers(org_id, 'view')
    OR public.creator_owns_influencer(influencer_id)
  );

CREATE OR REPLACE FUNCTION public.creator_deliverable_storage_upload_allowed(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.influencer_deliverable_files file
    WHERE file.storage_path = p_path
      AND file.created_by = auth.uid()
      AND file.upload_status = 'pending_upload'
      AND public.creator_owns_influencer(file.influencer_id)
  );
$fn$;

CREATE OR REPLACE FUNCTION public.creator_deliverable_storage_read_allowed(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.influencer_deliverable_files file
    WHERE file.storage_path = p_path
      AND file.upload_status = 'uploaded'
      AND (
        public.can_manage_influencers(file.org_id, 'view')
        OR public.creator_owns_influencer(file.influencer_id)
      )
  );
$fn$;

REVOKE ALL ON FUNCTION public.creator_deliverable_storage_upload_allowed(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creator_deliverable_storage_read_allowed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creator_deliverable_storage_upload_allowed(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_deliverable_storage_read_allowed(text) TO authenticated;

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'creator-deliverables',
  'creator-deliverables',
  false,
  52428800,
  ARRAY[
    'video/mp4', 'video/quicktime', 'video/webm',
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "creator deliverables upload pending files" ON storage.objects;
CREATE POLICY "creator deliverables upload pending files"
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'creator-deliverables'
    AND public.creator_deliverable_storage_upload_allowed(name)
  );

DROP POLICY IF EXISTS "creator deliverables read collaboration files" ON storage.objects;
CREATE POLICY "creator deliverables read collaboration files"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'creator-deliverables'
    AND public.creator_deliverable_storage_read_allowed(name)
  );

CREATE OR REPLACE FUNCTION public.creator_prepare_deliverable_file(
  p_campaign_id uuid,
  p_description text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text
)
RETURNS TABLE (
  deliverable_id uuid,
  file_id uuid,
  version_number integer,
  storage_path text,
  retention_until date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_campaign public.influencer_campaigns%ROWTYPE;
  v_influencer public.influencers%ROWTYPE;
  v_deliverable public.influencer_deliverables%ROWTYPE;
  v_file_id uuid := gen_random_uuid();
  v_version integer;
  v_name text := NULLIF(btrim(p_file_name), '');
  v_safe_name text;
  v_path text;
  v_retention date;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Iniciá sesión para entregar contenido' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_description, '')), '') IS NULL OR char_length(p_description) > 4000 THEN
    RAISE EXCEPTION 'La descripción es obligatoria y admite hasta 4000 caracteres' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NULL OR char_length(v_name) > 255 THEN
    RAISE EXCEPTION 'El nombre del archivo es obligatorio y admite hasta 255 caracteres' USING ERRCODE = '22023';
  END IF;
  IF p_mime_type NOT IN (
    'video/mp4', 'video/quicktime', 'video/webm',
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
  ) THEN
    RAISE EXCEPTION 'Formato no permitido. Usá MP4, MOV, WEBM, JPG, PNG, WEBP o PDF' USING ERRCODE = '22023';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 52428800 THEN
    RAISE EXCEPTION 'El archivo debe pesar hasta 50 MB' USING ERRCODE = '22023';
  END IF;
  IF p_sha256 IS NULL OR lower(p_sha256) !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'La huella SHA-256 del archivo no es válida' USING ERRCODE = '22023';
  END IF;

  SELECT campaign.* INTO v_campaign
  FROM public.influencer_campaigns campaign
  WHERE campaign.id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaña no encontrada' USING ERRCODE = 'P0002'; END IF;

  SELECT influencer.* INTO v_influencer
  FROM public.influencers influencer
  JOIN public.creator_accounts account ON account.user_id = v_user
  JOIN public.influencer_campaign_creators assignment
    ON assignment.org_id = influencer.org_id
   AND assignment.campaign_id = p_campaign_id
   AND assignment.influencer_id = influencer.id
  WHERE influencer.org_id = v_campaign.org_id
    AND lower(influencer.email) = lower(account.email)
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No estás asignado a esta campaña' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.influencer_invitations invitation
    JOIN public.creator_accounts account ON account.user_id = v_user
    WHERE invitation.campaign_id = p_campaign_id
      AND lower(invitation.email) = lower(account.email)
      AND invitation.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Aceptá la invitación antes de entregar contenido' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_campaign_id::text || v_influencer.id::text, 0));

  SELECT deliverable.* INTO v_deliverable
  FROM public.influencer_deliverables deliverable
  WHERE deliverable.campaign_id = p_campaign_id
    AND deliverable.influencer_id = v_influencer.id
  ORDER BY deliverable.created_at DESC, deliverable.id DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND AND v_deliverable.status = 'completado' THEN
    RAISE EXCEPTION 'El entregable ya fue aprobado y no admite reemplazos' USING ERRCODE = '55000';
  END IF;
  IF FOUND AND v_deliverable.status = 'entregado' THEN
    RAISE EXCEPTION 'La última versión todavía está en revisión' USING ERRCODE = '55000';
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.influencer_deliverables(
      org_id, influencer_id, influencer_name, campaign_id, campaign_name,
      description, due_date, content_url, status
    ) VALUES (
      v_campaign.org_id, v_influencer.id, v_influencer.name, v_campaign.id, v_campaign.title,
      btrim(p_description), COALESCE(v_campaign.due_date, current_date + 14), NULL, 'en_progreso'
    ) RETURNING * INTO v_deliverable;
  ELSE
    UPDATE public.influencer_deliverables
    SET description = btrim(p_description), status = 'en_progreso', delivery_date = NULL
    WHERE id = v_deliverable.id
    RETURNING * INTO v_deliverable;
  END IF;

  SELECT COALESCE(max(file.version_number), 0) + 1 INTO v_version
  FROM public.influencer_deliverable_files file
  WHERE file.deliverable_id = v_deliverable.id;

  v_safe_name := regexp_replace(v_name, '[^a-zA-Z0-9._-]+', '-', 'g');
  v_safe_name := regexp_replace(v_safe_name, '-+', '-', 'g');
  v_safe_name := COALESCE(NULLIF(trim(both '-' from v_safe_name), ''), 'entregable');
  v_path := v_campaign.org_id::text || '/' || p_campaign_id::text || '/'
    || v_deliverable.id::text || '/' || v_file_id::text || '/' || v_safe_name;
  v_retention := GREATEST(current_date + 365, COALESCE(v_campaign.due_date, current_date) + 365);

  INSERT INTO public.influencer_deliverable_files(
    id, org_id, campaign_id, deliverable_id, influencer_id, version_number,
    storage_path, original_filename, mime_type, size_bytes, sha256,
    retention_until, created_by
  ) VALUES (
    v_file_id, v_campaign.org_id, p_campaign_id, v_deliverable.id, v_influencer.id, v_version,
    v_path, v_name, p_mime_type, p_size_bytes, lower(p_sha256),
    v_retention, v_user
  );

  RETURN QUERY SELECT v_deliverable.id, v_file_id, v_version, v_path, v_retention;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_finalize_deliverable_file(p_file_id uuid)
RETURNS public.influencer_deliverable_files
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_file public.influencer_deliverable_files%ROWTYPE;
  v_object storage.objects%ROWTYPE;
BEGIN
  SELECT * INTO v_file
  FROM public.influencer_deliverable_files
  WHERE id = p_file_id
  FOR UPDATE;
  IF NOT FOUND OR v_file.created_by <> auth.uid() OR NOT public.creator_owns_influencer(v_file.influencer_id) THEN
    RAISE EXCEPTION 'Archivo de entregable no encontrado' USING ERRCODE = '42501';
  END IF;
  IF v_file.upload_status = 'uploaded' THEN RETURN v_file; END IF;
  IF v_file.upload_status <> 'pending_upload' THEN
    RAISE EXCEPTION 'La carga ya no está pendiente' USING ERRCODE = '55000';
  END IF;

  SELECT object.* INTO v_object
  FROM storage.objects object
  WHERE object.bucket_id = 'creator-deliverables'
    AND object.name = v_file.storage_path;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El archivo no llegó al almacenamiento privado' USING ERRCODE = 'P0002';
  END IF;
  IF NULLIF(v_object.metadata->>'size', '') IS NOT NULL
     AND (v_object.metadata->>'size')::bigint <> v_file.size_bytes THEN
    UPDATE public.influencer_deliverable_files
    SET upload_status = 'quarantined', failure_reason = 'El tamaño recibido no coincide con la intención de carga'
    WHERE id = v_file.id;
    RAISE EXCEPTION 'El tamaño recibido no coincide con el archivo seleccionado' USING ERRCODE = '22023';
  END IF;

  UPDATE public.influencer_deliverable_files
  SET upload_status = 'uploaded', uploaded_at = now(), failure_reason = NULL
  WHERE id = v_file.id
  RETURNING * INTO v_file;

  UPDATE public.influencer_deliverables
  SET status = 'entregado', delivery_date = now(), content_url = NULL
  WHERE id = v_file.deliverable_id;

  RETURN v_file;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_fail_deliverable_file(p_file_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.influencer_deliverable_files file
  SET upload_status = 'failed',
      failure_reason = left(COALESCE(NULLIF(btrim(p_reason), ''), 'La transferencia no se completó'), 500)
  WHERE file.id = p_file_id
    AND file.created_by = auth.uid()
    AND file.upload_status = 'pending_upload'
    AND public.creator_owns_influencer(file.influencer_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'No se pudo marcar la carga fallida' USING ERRCODE = '42501'; END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.influencer_deliverable_files_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las versiones de entregables son inmutables' USING ERRCODE = '55000';
  END IF;
  IF OLD.org_id IS DISTINCT FROM NEW.org_id
     OR OLD.campaign_id IS DISTINCT FROM NEW.campaign_id
     OR OLD.deliverable_id IS DISTINCT FROM NEW.deliverable_id
     OR OLD.influencer_id IS DISTINCT FROM NEW.influencer_id
     OR OLD.version_number IS DISTINCT FROM NEW.version_number
     OR OLD.storage_path IS DISTINCT FROM NEW.storage_path
     OR OLD.original_filename IS DISTINCT FROM NEW.original_filename
     OR OLD.mime_type IS DISTINCT FROM NEW.mime_type
     OR OLD.size_bytes IS DISTINCT FROM NEW.size_bytes
     OR OLD.sha256 IS DISTINCT FROM NEW.sha256
     OR OLD.retention_until IS DISTINCT FROM NEW.retention_until
     OR OLD.created_by IS DISTINCT FROM NEW.created_by
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'La evidencia original de una versión no se puede editar' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER influencer_deliverable_files_immutable
BEFORE UPDATE OR DELETE ON public.influencer_deliverable_files
FOR EACH ROW EXECUTE FUNCTION public.influencer_deliverable_files_immutable();

-- Un entregable puede respaldarse con un enlace externo o con al menos un
-- archivo privado finalizado. La aprobación continúa exigiendo revisión humana.
CREATE OR REPLACE FUNCTION public.validate_influencer_deliverable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.campaign_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.influencer_campaign_creators
      WHERE org_id = NEW.org_id AND campaign_id = NEW.campaign_id AND influencer_id = NEW.influencer_id
    ) THEN RAISE EXCEPTION 'creator_not_assigned_to_campaign'; END IF;
    SELECT title INTO NEW.campaign_name
    FROM public.influencer_campaigns WHERE id = NEW.campaign_id AND org_id = NEW.org_id;
  END IF;
  IF NEW.content_url IS NOT NULL AND NEW.content_url !~ '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid_content_url';
  END IF;
  IF NEW.status IN ('entregado', 'completado')
     AND COALESCE(length(btrim(NEW.content_url)), 0) = 0
     AND NOT EXISTS (
       SELECT 1 FROM public.influencer_deliverable_files file
       WHERE file.deliverable_id = NEW.id AND file.upload_status = 'uploaded'
     ) THEN
    RAISE EXCEPTION 'content_evidence_required';
  END IF;
  IF NEW.status = 'completado' THEN
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'review_required'; END IF;
    IF OLD.status NOT IN ('entregado', 'completado') OR COALESCE(length(btrim(NEW.review_notes)), 0) = 0 THEN
      RAISE EXCEPTION 'review_required';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.creator_prepare_deliverable_file(uuid, text, text, text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creator_finalize_deliverable_file(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.creator_fail_deliverable_file(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.influencer_deliverable_files_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creator_prepare_deliverable_file(uuid, text, text, text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_finalize_deliverable_file(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_fail_deliverable_file(uuid, text) TO authenticated;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT procedure.proname,
  pg_get_function_identity_arguments(procedure.oid),
  'authenticated_delegate',
  CASE procedure.proname
    WHEN 'creator_prepare_deliverable_file' THEN 'Crea una intención privada y versionada sólo para el creador asignado que aceptó la campaña.'
    WHEN 'creator_finalize_deliverable_file' THEN 'Finaliza la entrega sólo si el objeto existe en el bucket privado y pertenece a la intención del creador.'
    ELSE 'Registra una transferencia fallida sin exponer ni borrar evidencia.'
  END,
  md5(pg_get_functiondef(procedure.oid)),
  DATE '2026-09-29'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname IN (
    'creator_prepare_deliverable_file',
    'creator_finalize_deliverable_file',
    'creator_fail_deliverable_file'
  )
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

DO $guard$
BEGIN
  IF (SELECT public FROM storage.buckets WHERE id = 'creator-deliverables') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'creator-deliverables debe ser privado';
  END IF;
  IF has_table_privilege('anon', 'public.influencer_deliverable_files', 'SELECT')
     OR has_table_privilege('authenticated', 'public.influencer_deliverable_files', 'INSERT')
     OR has_table_privilege('authenticated', 'public.influencer_deliverable_files', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.influencer_deliverable_files', 'DELETE') THEN
    RAISE EXCEPTION 'Los archivos de entregables quedaron expuestos o mutables desde el navegador';
  END IF;
END;
$guard$;


COMMIT;
