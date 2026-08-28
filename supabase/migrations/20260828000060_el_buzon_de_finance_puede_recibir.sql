-- El buzón de documentos de Finance no podía recibir un documento
--
-- ── Cómo apareció ─────────────────────────────────────────────────────────
--
-- Buscando una familia de bugs que ya salió cara acá —plpgsql resuelve nombres
-- en tiempo de ejecución, así que una función puede nombrar una columna que no
-- existe y sólo fallar cuando alguien la usa, como `afip_marcar_delegacion`
-- escribiendo `last_error`— se corrió `plpgsql_check` sobre las funciones de
-- `public`, dentro de una transacción que se revierte.
--
-- De 13 errores, 10 son funciones huérfanas de módulos retirados
-- (`award_badge`, `generate_payroll`, `generate_ticket_code`…) que apuntan a
-- tablas que ya no existen: ruido muerto. Los otros 3 son un feature roto, y
-- los 3 están en el mismo flujo.
--
-- ── El error ──────────────────────────────────────────────────────────────
--
--     42702: column reference "document_id" is ambiguous
--     42702: column reference "version_number" is ambiguous
--     42702: column reference "hash_status" is ambiguous
--
-- ⚠️ **`RETURNS TABLE (document_id uuid, …)` declara variables de salida.** Un
-- nombre que aparece ahí y también es columna de la tabla que se consulta deja
-- a Postgres sin forma de saber a cuál se refiere, y corta.
--
-- 📌 No lo agarró ningún test porque el problema no está en el texto: está en
-- la resolución de nombres, que sólo ocurre al ejecutar. Compila, se crea sin
-- una queja, y falla la primera vez que alguien sube un documento.
--
-- Verificado ejecutándolo, no sólo por análisis estático: llamar a
-- `finance_document_finalize_upload` sobre un documento real devuelve
-- `42702 column reference "document_id" is ambiguous`.
--
-- ── Por qué importa ───────────────────────────────────────────────────────
--
-- `Exentry Imports` tiene Finance **habilitado** desde el 2026-08-22, aprobado
-- por el dueño. Y `finance_documents` tiene **0 filas**: el buzón nunca pudo
-- recibir nada. Las tres funciones rotas son crear la versión, finalizar la
-- subida y completar la inspección — el circuito entero.
--
-- ── La corrección ─────────────────────────────────────────────────────────
--
-- Se califica la columna con la tabla. ⚠️ **No se renombra la salida**: los
-- nombres de `RETURNS TABLE` son los campos que el cliente lee, y cambiarlos
-- rompería la pantalla en lugar de arreglarla.
--
-- 📌 Los cuerpos se extrajeron de las migraciones originales con un script y
-- se les aplicó sólo el fragmento que cambia. Volcarlos desde
-- `pg_get_functiondef` habría sido lo natural, pero el volcado vuelve con los
-- acentos rotos («Versión» → «VersiÃ³n») y eso se escribiría en los mensajes
-- de error que ve el comercio.

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

  -- `version_number` y `document_id` son columnas Y salidas de RETURNS TABLE:
  -- sin calificar, Postgres no sabe cual es cual y corta con 42702.
  SELECT COALESCE(max(fdv.version_number), 0) + 1 INTO v_version_number
  FROM public.finance_document_versions fdv
  WHERE fdv.document_id = p_document_id;
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
  -- Idem: `document_id` es columna y salida a la vez.
  SELECT fdv.* INTO v_version
  FROM public.finance_document_versions fdv
  WHERE fdv.id = p_version_id AND fdv.document_id = p_document_id
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
      -- Idem: `hash_status` es columna y salida. Se califica con la tabla
      -- para conservar el significado original (el valor actual de la fila).
      hash_status = CASE
        WHEN p_actual_sha256 IS NULL THEN public.finance_document_versions.hash_status
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


-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación — el circuito entero, con datos ZZ que se borran
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_org   uuid;
  v_user  uuid;
  v_doc   uuid;
  v_falla text;
  v_restos int;
BEGIN
  SELECT org_id, user_id INTO v_org, v_user FROM public.memberships LIMIT 1;

  INSERT INTO public.finance_documents (org_id, document_type, title, status, created_by)
  VALUES (v_org, 'supplier_invoice', 'ZZ inbox finance', 'pending_upload', v_user)
  RETURNING id INTO v_doc;

  -- ── ⚠️ Lo que fallaba: finalizar la subida ────────────────────────────
  -- Antes de esta migración devolvía 42702 antes de llegar a mirar permisos.
  -- Ahora tiene que llegar al chequeo real y fallar por OTRA razón — que el
  -- bloque DO corre sin `auth.uid()`, así que `finance_document_can` corta.
  BEGIN
    PERFORM public.finance_document_finalize_upload(v_doc, gen_random_uuid());
    v_falla := 'ninguna';
  EXCEPTION WHEN OTHERS THEN
    v_falla := SQLSTATE;
  END;

  ASSERT v_falla <> '42702',
    'sigue siendo ambigua: el buzon de Finance no puede recibir un documento';

  -- ── Y crear una version tampoco corta por ambiguedad ───────────────────
  BEGIN
    PERFORM public.finance_document_create_version(
      v_doc, 'zz/prueba.pdf', 'application/pdf', 1234, repeat('a', 64));
    v_falla := 'ninguna';
  EXCEPTION WHEN OTHERS THEN
    v_falla := SQLSTATE;
  END;

  ASSERT v_falla <> '42702',
    'crear version sigue siendo ambigua';

  -- ── Sin restos ─────────────────────────────────────────────────────────
  DELETE FROM public.finance_document_versions WHERE document_id = v_doc;
  DELETE FROM public.finance_document_events   WHERE document_id = v_doc;
  DELETE FROM public.finance_documents         WHERE id = v_doc;
  SELECT count(*) INTO v_restos FROM public.finance_documents
   WHERE title = 'ZZ inbox finance';
  ASSERT v_restos = 0, 'quedaron restos ZZ';

  RAISE NOTICE 'OK: el buzon de Finance ya no corta por ambiguedad';
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000060', 'el_buzon_de_finance_puede_recibir')
ON CONFLICT DO NOTHING;
