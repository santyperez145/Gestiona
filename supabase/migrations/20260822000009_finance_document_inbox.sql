-- F3.15 — Finance Document Inbox.
--
-- La captura documental tiene que ser segura antes de conectar extracción:
-- intención de carga -> objeto privado -> inspección -> revisión humana.
-- El original no se edita ni se borra; una corrección crea otra versión.

CREATE TABLE IF NOT EXISTS public.finance_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('supplier_invoice', 'receipt', 'purchase_order', 'other')),
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 255),
  status        text NOT NULL DEFAULT 'pending_upload'
                CHECK (status IN ('pending_upload', 'upload_failed', 'awaiting_inspection', 'in_review', 'approved', 'rejected')),
  created_by    uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_documents_id_org_uq UNIQUE (id, org_id)
);

CREATE TABLE IF NOT EXISTS public.finance_document_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id        uuid NOT NULL,
  version_number     integer NOT NULL CHECK (version_number > 0),
  storage_path       text NOT NULL UNIQUE,
  original_filename  text NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  mime_type          text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes         bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256             text NOT NULL CHECK (sha256 ~ '^[0-9a-fA-F]{64}$'),
  hash_status        text NOT NULL DEFAULT 'declared'
                     CHECK (hash_status IN ('declared', 'verified', 'mismatch')),
  upload_status      text NOT NULL DEFAULT 'pending_upload'
                     CHECK (upload_status IN ('pending_upload', 'uploaded', 'failed')),
  inspection_status  text NOT NULL DEFAULT 'pending'
                     CHECK (inspection_status IN ('pending', 'clean', 'rejected')),
  failure_reason     text CHECK (failure_reason IS NULL OR char_length(failure_reason) <= 500),
  created_by         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  uploaded_at        timestamptz,
  inspected_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_document_versions_document_org_fk
    FOREIGN KEY (document_id, org_id)
    REFERENCES public.finance_documents(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT finance_document_versions_document_number_uq
    UNIQUE (document_id, version_number)
);

CREATE TABLE IF NOT EXISTS public.finance_document_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  version_id   uuid REFERENCES public.finance_document_versions(id) ON DELETE RESTRICT,
  event_type   text NOT NULL CHECK (event_type IN ('created', 'version_added', 'uploaded', 'upload_failed')),
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_document_events_document_org_fk
    FOREIGN KEY (document_id, org_id)
    REFERENCES public.finance_documents(id, org_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS finance_documents_org_status_idx
  ON public.finance_documents(org_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS finance_document_versions_document_idx
  ON public.finance_document_versions(document_id, version_number DESC);
CREATE INDEX IF NOT EXISTS finance_document_events_document_idx
  ON public.finance_document_events(document_id, created_at DESC);

ALTER TABLE public.finance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_document_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.finance_documents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.finance_document_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.finance_document_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_documents TO authenticated;
GRANT SELECT ON public.finance_document_versions TO authenticated;
GRANT SELECT ON public.finance_document_events TO authenticated;

-- Entitlement y permiso se vuelven a comprobar en cada lectura/escritura.
-- Ser miembro de la organización, por sí solo, no habilita Finance.
CREATE OR REPLACE FUNCTION public.finance_document_can(
  p_org_id uuid,
  p_action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR p_action NOT IN ('view', 'edit') THEN
    RETURN false;
  END IF;
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_product_access access
    WHERE access.org_id = p_org_id
      AND access.product_key = 'finance'
      AND access.status = 'enabled'
  ) THEN
    RETURN false;
  END IF;
  RETURN public.has_permission(p_org_id, 'finance', p_action);
END;
$fn$;

DROP POLICY IF EXISTS "finance documents visible to authorized members" ON public.finance_documents;
CREATE POLICY "finance documents visible to authorized members"
  ON public.finance_documents
  FOR SELECT TO authenticated
  USING (public.finance_document_can(org_id, 'view'));

DROP POLICY IF EXISTS "finance document versions visible to authorized members" ON public.finance_document_versions;
CREATE POLICY "finance document versions visible to authorized members"
  ON public.finance_document_versions
  FOR SELECT TO authenticated
  USING (public.finance_document_can(org_id, 'view'));

DROP POLICY IF EXISTS "finance document events visible to authorized members" ON public.finance_document_events;
CREATE POLICY "finance document events visible to authorized members"
  ON public.finance_document_events
  FOR SELECT TO authenticated
  USING (public.finance_document_can(org_id, 'view'));

-- La ruta se genera en SQL y queda vinculada a una única intención pendiente.
-- Así el cliente no puede elegir otro tenant ni reciclar un path ya finalizado.
CREATE OR REPLACE FUNCTION public.finance_document_storage_upload_allowed(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.finance_document_versions version
    WHERE version.storage_path = p_path
      AND version.created_by = auth.uid()
      AND version.upload_status = 'pending_upload'
      AND public.finance_document_can(version.org_id, 'edit')
  );
$fn$;

CREATE OR REPLACE FUNCTION public.finance_document_storage_read_allowed(p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.finance_document_versions version
    WHERE version.storage_path = p_path
      AND public.finance_document_can(version.org_id, 'view')
  );
$fn$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'finance-documents',
  'finance-documents',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "finance documents upload pending versions" ON storage.objects;
CREATE POLICY "finance documents upload pending versions"
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'finance-documents'
    AND public.finance_document_storage_upload_allowed(name)
  );

DROP POLICY IF EXISTS "finance documents read authorized versions" ON storage.objects;
CREATE POLICY "finance documents read authorized versions"
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'finance-documents'
    AND public.finance_document_storage_read_allowed(name)
  );

-- No UPDATE/DELETE policy exists for this bucket. Originales and versions are
-- retained; cleanup is an explicit service-role operation, never a UI action.

CREATE OR REPLACE FUNCTION public.finance_document_create_upload(
  p_org_id uuid,
  p_document_type text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text
)
RETURNS TABLE (document_id uuid, version_id uuid, storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_document_id uuid := gen_random_uuid();
  v_version_id uuid := gen_random_uuid();
  v_name text := NULLIF(btrim(p_file_name), '');
  v_safe_name text;
  v_path text;
BEGIN
  IF NOT public.finance_document_can(p_org_id, 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para cargar documentos en Finance'
      USING ERRCODE = '42501';
  END IF;
  IF p_document_type NOT IN ('supplier_invoice', 'receipt', 'purchase_order', 'other') THEN
    RAISE EXCEPTION 'Tipo de documento inválido' USING ERRCODE = '22023';
  END IF;
  IF v_name IS NULL OR char_length(v_name) > 255 THEN
    RAISE EXCEPTION 'El nombre del archivo es obligatorio y debe tener hasta 255 caracteres'
      USING ERRCODE = '22023';
  END IF;
  IF p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') THEN
    RAISE EXCEPTION 'Tipo MIME no permitido' USING ERRCODE = '22023';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 10485760 THEN
    RAISE EXCEPTION 'El archivo debe pesar entre 1 byte y 10 MB' USING ERRCODE = '22023';
  END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'El hash SHA-256 no es válido' USING ERRCODE = '22023';
  END IF;

  v_safe_name := regexp_replace(v_name, '[^a-zA-Z0-9._-]+', '-', 'g');
  v_safe_name := regexp_replace(v_safe_name, '-+', '-', 'g');
  v_safe_name := NULLIF(trim(both '-' from v_safe_name), '');
  v_safe_name := COALESCE(v_safe_name, 'documento');
  v_path := p_org_id::text || '/' || v_document_id::text || '/' || v_version_id::text || '/' || v_safe_name;

  INSERT INTO public.finance_documents(id, org_id, document_type, title, created_by)
  VALUES (v_document_id, p_org_id, p_document_type, v_name, auth.uid());

  INSERT INTO public.finance_document_versions(
    id, org_id, document_id, version_number, storage_path,
    original_filename, mime_type, size_bytes, sha256, created_by
  ) VALUES (
    v_version_id, p_org_id, v_document_id, 1, v_path,
    v_name, p_mime_type, p_size_bytes, lower(p_sha256), auth.uid()
  );

  INSERT INTO public.finance_document_events(org_id, document_id, version_id, event_type, actor_id, detail)
  VALUES (p_org_id, v_document_id, v_version_id, 'created', auth.uid(), jsonb_build_object('version_number', 1));

  RETURN QUERY SELECT v_document_id, v_version_id, v_path;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_document_create_version(
  p_document_id uuid,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text
)
RETURNS TABLE (document_id uuid, version_id uuid, version_number integer, storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_document public.finance_documents%ROWTYPE;
  v_document_id uuid := p_document_id;
  v_version_id uuid := gen_random_uuid();
  v_version_number integer;
  v_name text := NULLIF(btrim(p_file_name), '');
  v_safe_name text;
  v_path text;
BEGIN
  SELECT * INTO v_document
  FROM public.finance_documents
  WHERE id = p_document_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento no encontrado'; END IF;
  IF NOT public.finance_document_can(v_document.org_id, 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para versionar este documento' USING ERRCODE = '42501';
  END IF;
  IF v_document.status = 'approved' THEN
    RAISE EXCEPTION 'Un documento aprobado no se reemplaza; creá una corrección separada'
      USING ERRCODE = '55000';
  END IF;
  IF v_name IS NULL OR char_length(v_name) > 255 THEN
    RAISE EXCEPTION 'El nombre del archivo es obligatorio y debe tener hasta 255 caracteres'
      USING ERRCODE = '22023';
  END IF;
  IF p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
     OR p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 10485760
     OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Metadatos de archivo inválidos' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(max(version_number), 0) + 1 INTO v_version_number
  FROM public.finance_document_versions
  WHERE document_id = p_document_id;
  v_safe_name := regexp_replace(v_name, '[^a-zA-Z0-9._-]+', '-', 'g');
  v_safe_name := regexp_replace(v_safe_name, '-+', '-', 'g');
  v_safe_name := COALESCE(NULLIF(trim(both '-' from v_safe_name), ''), 'documento');
  v_path := v_document.org_id::text || '/' || v_document_id::text || '/' || v_version_id::text || '/' || v_safe_name;

  INSERT INTO public.finance_document_versions(
    id, org_id, document_id, version_number, storage_path,
    original_filename, mime_type, size_bytes, sha256, created_by
  ) VALUES (
    v_version_id, v_document.org_id, v_document_id, v_version_number, v_path,
    v_name, p_mime_type, p_size_bytes, lower(p_sha256), auth.uid()
  );
  UPDATE public.finance_documents SET status = 'pending_upload', updated_at = now()
  WHERE id = p_document_id;
  INSERT INTO public.finance_document_events(org_id, document_id, version_id, event_type, actor_id, detail)
  VALUES (v_document.org_id, p_document_id, v_version_id, 'version_added', auth.uid(), jsonb_build_object('version_number', v_version_number));

  RETURN QUERY SELECT v_document_id, v_version_id, v_version_number, v_path;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_document_finalize_upload(
  p_document_id uuid,
  p_version_id uuid
)
RETURNS TABLE (document_id uuid, version_id uuid, upload_status text, document_status text)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_version public.finance_document_versions%ROWTYPE;
BEGIN
  SELECT * INTO v_version
  FROM public.finance_document_versions
  WHERE id = p_version_id AND document_id = p_document_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Versión documental no encontrada'; END IF;
  IF NOT public.finance_document_can(v_version.org_id, 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para finalizar esta carga' USING ERRCODE = '42501';
  END IF;
  IF v_version.upload_status = 'uploaded' THEN
    RETURN QUERY SELECT p_document_id, p_version_id, 'uploaded'::text, 'awaiting_inspection'::text;
    RETURN;
  END IF;
  IF v_version.upload_status <> 'pending_upload' THEN
    RAISE EXCEPTION 'La carga ya no está pendiente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects object
    WHERE object.bucket_id = 'finance-documents'
      AND object.name = v_version.storage_path
  ) THEN
    RAISE EXCEPTION 'El archivo no llegó al bucket privado' USING ERRCODE = '42704';
  END IF;

  UPDATE public.finance_document_versions
  SET upload_status = 'uploaded', uploaded_at = now(), failure_reason = NULL
  WHERE id = p_version_id;
  UPDATE public.finance_documents
  SET status = 'awaiting_inspection', updated_at = now()
  WHERE id = p_document_id;
  INSERT INTO public.finance_document_events(org_id, document_id, version_id, event_type, actor_id, detail)
  VALUES (v_version.org_id, p_document_id, p_version_id, 'uploaded', auth.uid(), jsonb_build_object('hash_status', v_version.hash_status));

  RETURN QUERY SELECT p_document_id, p_version_id, 'uploaded'::text, 'awaiting_inspection'::text;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_document_mark_upload_failed(
  p_document_id uuid,
  p_version_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_version public.finance_document_versions%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  SELECT * INTO v_version
  FROM public.finance_document_versions
  WHERE id = p_version_id AND document_id = p_document_id
  FOR UPDATE;
  IF NOT FOUND OR NOT public.finance_document_can(v_version.org_id, 'edit') THEN
    RAISE EXCEPTION 'No se puede marcar la carga fallida' USING ERRCODE = '42501';
  END IF;
  UPDATE public.finance_document_versions
  SET upload_status = 'failed', failure_reason = left(COALESCE(v_reason, 'Error de transferencia'), 500)
  WHERE id = p_version_id;
  UPDATE public.finance_documents SET status = 'upload_failed', updated_at = now()
  WHERE id = p_document_id;
  INSERT INTO public.finance_document_events(org_id, document_id, version_id, event_type, actor_id, detail)
  VALUES (v_version.org_id, p_document_id, p_version_id, 'upload_failed', auth.uid(), jsonb_build_object('reason', left(COALESCE(v_reason, 'Error de transferencia'), 500)));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_document_versions_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las versiones documentales son inmutables' USING ERRCODE = '55000';
  END IF;
  IF OLD.org_id IS DISTINCT FROM NEW.org_id
     OR OLD.document_id IS DISTINCT FROM NEW.document_id
     OR OLD.version_number IS DISTINCT FROM NEW.version_number
     OR OLD.storage_path IS DISTINCT FROM NEW.storage_path
     OR OLD.original_filename IS DISTINCT FROM NEW.original_filename
     OR OLD.mime_type IS DISTINCT FROM NEW.mime_type
     OR OLD.size_bytes IS DISTINCT FROM NEW.size_bytes
     OR OLD.sha256 IS DISTINCT FROM NEW.sha256
     OR OLD.created_by IS DISTINCT FROM NEW.created_by
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Los datos originales de una versión no se pueden editar' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_finance_document_versions_immutable ON public.finance_document_versions;
CREATE TRIGGER trg_finance_document_versions_immutable
BEFORE UPDATE OR DELETE ON public.finance_document_versions
FOR EACH ROW EXECUTE FUNCTION public.finance_document_versions_immutable();

CREATE OR REPLACE FUNCTION public.finance_documents_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_finance_documents_updated_at ON public.finance_documents;
CREATE TRIGGER trg_finance_documents_updated_at
BEFORE UPDATE ON public.finance_documents
FOR EACH ROW EXECUTE FUNCTION public.finance_documents_updated_at();

REVOKE ALL ON FUNCTION public.finance_document_can(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_storage_upload_allowed(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_storage_read_allowed(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_create_upload(uuid, text, text, text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_create_version(uuid, text, text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_finalize_upload(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_mark_upload_failed(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_versions_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_documents_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_can(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_storage_upload_allowed(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_storage_read_allowed(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_create_upload(uuid, text, text, text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_create_version(uuid, text, text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_finalize_upload(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_mark_upload_failed(uuid, uuid, text) TO authenticated;

COMMENT ON TABLE public.finance_documents IS
  'Bandeja documental de Finance: ingreso seguro antes de extracción o impacto contable.';
COMMENT ON TABLE public.finance_document_versions IS
  'Versiones inmutables del original documental; sólo cambia el estado operativo.';
COMMENT ON COLUMN public.finance_document_versions.sha256 IS
  'Hash declarado al cargar; queda declarado hasta que un inspector server-side lo verifique.';

DO $guard$
BEGIN
  IF (SELECT public FROM storage.buckets WHERE id = 'finance-documents') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'finance-documents debe ser un bucket privado';
  END IF;
  IF has_table_privilege('anon', 'public.finance_documents', 'SELECT')
     OR has_table_privilege('anon', 'public.finance_document_versions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.finance_documents', 'INSERT')
     OR has_table_privilege('authenticated', 'public.finance_document_versions', 'UPDATE') THEN
    RAISE EXCEPTION 'La bandeja documental quedó expuesta o muta desde el navegador';
  END IF;
END;
$guard$;

INSERT INTO supabase_migrations.schema_migrations(version, name)
VALUES ('20260822000009', 'finance_document_inbox')
ON CONFLICT DO NOTHING;
