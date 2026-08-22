-- F3.19 — Inspector server-side de Finance Document Inbox.
--
-- El hash y MIME que declara el navegador no son autoridad. Esta migración
-- agrega un lease idempotente de inspección y una única transición server-side:
-- bytes privados -> integridad real -> scanner privado -> listo / duplicado /
-- cuarentena. Un scanner ausente o caído jamás habilita extracción.

ALTER TABLE public.finance_documents
  DROP CONSTRAINT IF EXISTS finance_documents_status_check;
ALTER TABLE public.finance_documents
  ADD CONSTRAINT finance_documents_status_check
  CHECK (status IN (
    'pending_upload', 'upload_failed', 'awaiting_inspection', 'in_review',
    'approved', 'rejected', 'quarantined'
  ));

ALTER TABLE public.finance_document_versions
  DROP CONSTRAINT IF EXISTS finance_document_versions_inspection_status_check;
ALTER TABLE public.finance_document_versions
  ADD CONSTRAINT finance_document_versions_inspection_status_check
  CHECK (inspection_status IN (
    'pending', 'scanning', 'scanner_unavailable', 'clean',
    'ready_for_extraction', 'duplicate', 'quarantined', 'rejected'
  ));

ALTER TABLE public.finance_document_events
  DROP CONSTRAINT IF EXISTS finance_document_events_event_type_check;
ALTER TABLE public.finance_document_events
  ADD CONSTRAINT finance_document_events_event_type_check
  CHECK (event_type IN (
    'created', 'version_added', 'uploaded', 'upload_failed',
    'inspection_started', 'inspection_ready', 'inspection_deferred',
    'inspection_quarantined', 'duplicate_detected'
  ));

ALTER TABLE public.finance_document_versions
  ADD COLUMN IF NOT EXISTS actual_sha256 text
    CHECK (actual_sha256 IS NULL OR actual_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS actual_mime_type text
    CHECK (actual_mime_type IS NULL OR actual_mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  ADD COLUMN IF NOT EXISTS actual_size_bytes bigint
    CHECK (actual_size_bytes IS NULL OR actual_size_bytes > 0),
  ADD COLUMN IF NOT EXISTS scanner_provider text
    CHECK (scanner_provider IS NULL OR char_length(scanner_provider) <= 80),
  ADD COLUMN IF NOT EXISTS scanner_status text NOT NULL DEFAULT 'not_run'
    CHECK (scanner_status IN ('not_run', 'clean', 'infected', 'error', 'unavailable')),
  ADD COLUMN IF NOT EXISTS scanner_reference text
    CHECK (scanner_reference IS NULL OR char_length(scanner_reference) <= 160),
  ADD COLUMN IF NOT EXISTS duplicate_of_version_id uuid,
  ADD COLUMN IF NOT EXISTS inspection_token uuid,
  ADD COLUMN IF NOT EXISTS inspection_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS inspection_attempts integer NOT NULL DEFAULT 0
    CHECK (inspection_attempts >= 0);

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'finance_document_versions_duplicate_fk'
      AND conrelid = 'public.finance_document_versions'::regclass
  ) THEN
    ALTER TABLE public.finance_document_versions
      ADD CONSTRAINT finance_document_versions_duplicate_fk
      FOREIGN KEY (duplicate_of_version_id)
      REFERENCES public.finance_document_versions(id)
      ON DELETE RESTRICT;
  END IF;
END;
$block$;

CREATE INDEX IF NOT EXISTS finance_document_versions_actual_hash_idx
  ON public.finance_document_versions(org_id, actual_sha256)
  WHERE actual_sha256 IS NOT NULL;

-- El usuario abre un lease corto bajo su JWT real. Así la Edge Function nunca
-- usa service_role antes de que la base revalide entitlement + finance.edit.
CREATE OR REPLACE FUNCTION public.finance_document_begin_inspection(
  p_document_id uuid,
  p_version_id uuid
)
RETURNS TABLE (
  document_id uuid,
  version_id uuid,
  storage_path text,
  declared_mime_type text,
  declared_size_bytes bigint,
  declared_sha256 text,
  inspection_token uuid,
  should_inspect boolean
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_version public.finance_document_versions%ROWTYPE;
  v_token uuid := gen_random_uuid();
BEGIN
  SELECT version.* INTO v_version
  FROM public.finance_document_versions version
  WHERE version.id = p_version_id
    AND version.document_id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versión documental no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.finance_document_can(v_version.org_id, 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para inspeccionar este documento' USING ERRCODE = '42501';
  END IF;
  IF v_version.upload_status <> 'uploaded' THEN
    RAISE EXCEPTION 'El archivo todavía no terminó de subir' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_document_versions newer
    WHERE newer.document_id = v_version.document_id
      AND newer.version_number > v_version.version_number
  ) THEN
    RAISE EXCEPTION 'Sólo se inspecciona la versión más reciente' USING ERRCODE = '55000';
  END IF;

  IF v_version.inspection_status IN ('ready_for_extraction', 'duplicate', 'quarantined', 'rejected') THEN
    RETURN QUERY SELECT
      v_version.document_id, v_version.id, v_version.storage_path,
      v_version.mime_type, v_version.size_bytes, v_version.sha256,
      NULL::uuid, false;
    RETURN;
  END IF;

  IF v_version.inspection_status = 'scanning'
     AND v_version.inspection_started_at > now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'La inspección ya está en curso' USING ERRCODE = '55P03';
  END IF;

  UPDATE public.finance_document_versions
  SET inspection_status = 'scanning',
      inspection_token = v_token,
      inspection_started_at = now(),
      inspection_attempts = inspection_attempts + 1,
      scanner_status = 'not_run',
      scanner_provider = NULL,
      scanner_reference = NULL,
      failure_reason = NULL
  WHERE id = v_version.id;

  INSERT INTO public.finance_document_events(
    org_id, document_id, version_id, event_type, actor_id, detail
  ) VALUES (
    v_version.org_id, v_version.document_id, v_version.id,
    'inspection_started', auth.uid(),
    jsonb_build_object('attempt', v_version.inspection_attempts + 1)
  );

  RETURN QUERY SELECT
    v_version.document_id, v_version.id, v_version.storage_path,
    v_version.mime_type, v_version.size_bytes, v_version.sha256,
    v_token, true;
END;
$fn$;

-- Sólo service_role puede cerrar el lease. La función deriva el estado; la Edge
-- no puede declarar `ready_for_extraction` mediante un booleano enviado por el
-- navegador. El token evita que un timeout viejo pise un retry más nuevo.
CREATE OR REPLACE FUNCTION public.finance_document_complete_inspection(
  p_version_id uuid,
  p_inspection_token uuid,
  p_actor_id uuid,
  p_actual_sha256 text,
  p_actual_mime_type text,
  p_actual_size_bytes bigint,
  p_scanner_provider text,
  p_scanner_status text,
  p_scanner_reference text,
  p_reason text
)
RETURNS TABLE (
  document_id uuid,
  version_id uuid,
  document_status text,
  inspection_status text,
  hash_status text,
  duplicate_of_version_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_version public.finance_document_versions%ROWTYPE;
  v_hash_ok boolean := false;
  v_mime_ok boolean := false;
  v_size_ok boolean := false;
  v_duplicate_id uuid;
  v_inspection_status text;
  v_document_status text;
  v_event_type text;
  v_reason text := left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 500);
BEGIN
  SELECT version.* INTO v_version
  FROM public.finance_document_versions version
  WHERE version.id = p_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versión documental no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_version.inspection_token IS NULL
     OR v_version.inspection_token IS DISTINCT FROM p_inspection_token
     OR v_version.inspection_status <> 'scanning' THEN
    RAISE EXCEPTION 'Lease de inspección vencido o reemplazado' USING ERRCODE = '55000';
  END IF;
  IF p_scanner_status NOT IN ('not_run', 'clean', 'infected', 'error', 'unavailable') THEN
    RAISE EXCEPTION 'Estado de scanner inválido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.finance_document_events event
    WHERE event.version_id = v_version.id
      AND event.event_type = 'inspection_started'
      AND event.actor_id = p_actor_id
  ) THEN
    RAISE EXCEPTION 'El actor no inició esta inspección' USING ERRCODE = '42501';
  END IF;

  IF p_actual_sha256 ~ '^[0-9a-f]{64}$' THEN
    v_hash_ok := p_actual_sha256 = lower(v_version.sha256);
  END IF;
  v_mime_ok := p_actual_mime_type = v_version.mime_type;
  v_size_ok := p_actual_size_bytes = v_version.size_bytes
               AND p_actual_size_bytes > 0
               AND p_actual_size_bytes <= 10485760;

  IF v_hash_ok AND v_mime_ok AND v_size_ok THEN
    SELECT other.id INTO v_duplicate_id
    FROM public.finance_document_versions other
    WHERE other.org_id = v_version.org_id
      AND other.id <> v_version.id
      AND other.actual_sha256 = p_actual_sha256
      AND other.inspection_status IN ('ready_for_extraction', 'duplicate', 'clean')
    ORDER BY other.inspected_at ASC NULLS LAST, other.created_at ASC
    LIMIT 1;
  END IF;

  IF p_scanner_status IN ('error', 'unavailable') THEN
    v_inspection_status := 'scanner_unavailable';
    v_document_status := 'awaiting_inspection';
    v_event_type := 'inspection_deferred';
    v_reason := COALESCE(v_reason, 'El scanner privado no está disponible');
  ELSIF NOT v_hash_ok OR NOT v_mime_ok OR NOT v_size_ok OR p_scanner_status = 'infected' THEN
    v_inspection_status := 'quarantined';
    v_document_status := 'quarantined';
    v_event_type := 'inspection_quarantined';
    v_reason := COALESCE(v_reason, 'El contenido real no coincide con la carga declarada');
  ELSIF p_scanner_status <> 'clean' THEN
    v_inspection_status := 'rejected';
    v_document_status := 'rejected';
    v_event_type := 'inspection_quarantined';
    v_reason := COALESCE(v_reason, 'El scanner no produjo un resultado válido');
  ELSIF v_duplicate_id IS NOT NULL THEN
    v_inspection_status := 'duplicate';
    v_document_status := 'in_review';
    v_event_type := 'duplicate_detected';
    v_reason := 'Contenido idéntico a una versión ya inspeccionada';
  ELSE
    v_inspection_status := 'ready_for_extraction';
    v_document_status := 'in_review';
    v_event_type := 'inspection_ready';
    v_reason := NULL;
  END IF;

  UPDATE public.finance_document_versions
  SET actual_sha256 = CASE WHEN p_actual_sha256 ~ '^[0-9a-f]{64}$' THEN p_actual_sha256 ELSE NULL END,
      actual_mime_type = CASE
        WHEN p_actual_mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
          THEN p_actual_mime_type
        ELSE NULL
      END,
      actual_size_bytes = CASE WHEN p_actual_size_bytes > 0 THEN p_actual_size_bytes ELSE NULL END,
      hash_status = CASE
        WHEN p_actual_sha256 IS NULL THEN hash_status
        WHEN v_hash_ok THEN 'verified'
        ELSE 'mismatch'
      END,
      inspection_status = v_inspection_status,
      scanner_provider = left(NULLIF(btrim(COALESCE(p_scanner_provider, '')), ''), 80),
      scanner_status = p_scanner_status,
      scanner_reference = left(NULLIF(btrim(COALESCE(p_scanner_reference, '')), ''), 160),
      duplicate_of_version_id = v_duplicate_id,
      failure_reason = v_reason,
      inspection_token = NULL,
      inspected_at = now()
  WHERE id = v_version.id;

  UPDATE public.finance_documents
  SET status = v_document_status, updated_at = now()
  WHERE id = v_version.document_id;

  INSERT INTO public.finance_document_events(
    org_id, document_id, version_id, event_type, actor_id, detail
  ) VALUES (
    v_version.org_id, v_version.document_id, v_version.id,
    v_event_type, p_actor_id,
    jsonb_build_object(
      'hash_matches', v_hash_ok,
      'mime_matches', v_mime_ok,
      'size_matches', v_size_ok,
      'scanner_provider', p_scanner_provider,
      'scanner_status', p_scanner_status,
      'duplicate_of_version_id', v_duplicate_id
    )
  );

  RETURN QUERY SELECT
    v_version.document_id, v_version.id, v_document_status,
    v_inspection_status,
    CASE WHEN p_actual_sha256 IS NULL THEN v_version.hash_status WHEN v_hash_ok THEN 'verified' ELSE 'mismatch' END,
    v_duplicate_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.finance_document_begin_inspection(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_begin_inspection(uuid, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.finance_document_complete_inspection(
  uuid, uuid, uuid, text, text, bigint, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_complete_inspection(
  uuid, uuid, uuid, text, text, bigint, text, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.finance_document_begin_inspection(uuid, uuid) IS
  'Abre un lease de inspección bajo finance.edit; retries concurrentes no compiten.';
COMMENT ON FUNCTION public.finance_document_complete_inspection(
  uuid, uuid, uuid, text, text, bigint, text, text, text, text
) IS
  'Única autoridad para validar bytes, scanner, duplicado y transición documental.';
COMMENT ON COLUMN public.finance_document_versions.actual_sha256 IS
  'SHA-256 recalculado sobre los bytes descargados del bucket privado por la Edge Function.';
COMMENT ON COLUMN public.finance_document_versions.scanner_status IS
  'Resultado del scanner privado. unavailable/error nunca habilitan extracción.';

DO $verify$
BEGIN
  IF has_function_privilege(
       'authenticated',
       'public.finance_document_complete_inspection(uuid,uuid,uuid,text,text,bigint,text,text,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'authenticated no debe completar inspecciones';
  END IF;
  IF NOT has_function_privilege(
       'authenticated',
       'public.finance_document_begin_inspection(uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'authenticated necesita iniciar la inspección bajo RLS/permiso';
  END IF;
END;
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260822000010', 'finance_document_inspection')
ON CONFLICT DO NOTHING;
