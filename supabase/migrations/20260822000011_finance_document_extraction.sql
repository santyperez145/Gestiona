-- F3.16 — Extracción estructurada, confidence y revisión humana.
--
-- Un documento sólo puede llegar acá después de inspección limpia. El modelo
-- propone un borrador versionado; la base valida estructura y umbrales. Ni la
-- extracción ni la revisión crean compras, deuda, stock o asientos.

CREATE TABLE IF NOT EXISTS public.finance_document_extractions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id          uuid NOT NULL,
  version_id           uuid NOT NULL REFERENCES public.finance_document_versions(id) ON DELETE RESTRICT,
  attempt              integer NOT NULL CHECK (attempt > 0),
  status               text NOT NULL DEFAULT 'extracting'
                       CHECK (status IN ('extracting', 'needs_review', 'ready_for_review', 'reviewed', 'failed')),
  source_sha256        text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  provider             text CHECK (provider IS NULL OR char_length(provider) <= 80),
  model                text CHECK (model IS NULL OR char_length(model) <= 120),
  prompt_version       text CHECK (prompt_version IS NULL OR char_length(prompt_version) <= 40),
  overall_confidence   numeric(5,4) CHECK (overall_confidence IS NULL OR overall_confidence BETWEEN 0 AND 1),
  validation_errors    text[] NOT NULL DEFAULT '{}',
  extraction_token     uuid,
  requested_by         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_note          text CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  failure_reason       text CHECK (failure_reason IS NULL OR char_length(failure_reason) <= 500),
  started_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  reviewed_at          timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_document_extractions_document_org_fk
    FOREIGN KEY (document_id, org_id)
    REFERENCES public.finance_documents(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT finance_document_extractions_version_attempt_uq UNIQUE (version_id, attempt),
  CONSTRAINT finance_document_extractions_id_org_uq UNIQUE (id, org_id)
);

CREATE TABLE IF NOT EXISTS public.finance_document_extraction_revisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  extraction_id     uuid NOT NULL,
  revision_number   integer NOT NULL CHECK (revision_number > 0),
  source            text NOT NULL CHECK (source IN ('model', 'human')),
  payload           jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  confidence        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(confidence) = 'object'),
  validation_errors text[] NOT NULL DEFAULT '{}',
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_document_extraction_revisions_extraction_org_fk
    FOREIGN KEY (extraction_id, org_id)
    REFERENCES public.finance_document_extractions(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT finance_document_extraction_revisions_number_uq UNIQUE (extraction_id, revision_number)
);

CREATE INDEX IF NOT EXISTS finance_document_extractions_version_idx
  ON public.finance_document_extractions(version_id, attempt DESC);
CREATE INDEX IF NOT EXISTS finance_document_extractions_review_queue_idx
  ON public.finance_document_extractions(org_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS finance_document_extraction_revisions_latest_idx
  ON public.finance_document_extraction_revisions(extraction_id, revision_number DESC);

ALTER TABLE public.finance_document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_document_extraction_revisions ENABLE ROW LEVEL SECURITY;

-- La inmutabilidad protege el original durante la operación, pero no puede
-- romper una baja/retención ejecutada por un rol privilegiado. No existe GRANT
-- DELETE ni policy para authenticated; además se exige un contexto explícito.
CREATE OR REPLACE FUNCTION public.finance_document_versions_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_user IN ('postgres', 'supabase_admin', 'service_role')
       AND current_setting('app.finance_document_retention_cleanup', true) = 'on' THEN
      RETURN OLD;
    END IF;
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

REVOKE ALL ON public.finance_document_extractions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.finance_document_extraction_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_document_extractions TO authenticated;
GRANT SELECT ON public.finance_document_extraction_revisions TO authenticated;

DROP POLICY IF EXISTS "finance extractions visible to authorized members" ON public.finance_document_extractions;
CREATE POLICY "finance extractions visible to authorized members"
  ON public.finance_document_extractions
  FOR SELECT TO authenticated
  USING (public.finance_document_can(org_id, 'view'));

DROP POLICY IF EXISTS "finance extraction revisions visible to authorized members" ON public.finance_document_extraction_revisions;
CREATE POLICY "finance extraction revisions visible to authorized members"
  ON public.finance_document_extraction_revisions
  FOR SELECT TO authenticated
  USING (public.finance_document_can(org_id, 'view'));

ALTER TABLE public.finance_document_events
  DROP CONSTRAINT IF EXISTS finance_document_events_event_type_check;
ALTER TABLE public.finance_document_events
  ADD CONSTRAINT finance_document_events_event_type_check
  CHECK (event_type IN (
    'created', 'version_added', 'uploaded', 'upload_failed',
    'inspection_started', 'inspection_ready', 'inspection_deferred',
    'inspection_quarantined', 'duplicate_detected',
    'extraction_started', 'extraction_completed', 'extraction_failed',
    'extraction_reviewed'
  ));

CREATE OR REPLACE FUNCTION public.finance_document_json_number(p_value jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  v_text text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN NULL; END IF;
  v_text := p_value #>> '{}';
  IF v_text !~ '^-?[0-9]+([.][0-9]+)?$' THEN RETURN NULL; END IF;
  RETURN v_text::numeric;
EXCEPTION WHEN numeric_value_out_of_range THEN
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_document_extraction_errors(p_payload jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  v_errors text[] := '{}';
  v_items jsonb;
  v_item jsonb;
  v_index integer := 0;
  v_qty numeric;
  v_unit numeric;
  v_line numeric;
  v_subtotal numeric;
  v_total numeric;
  v_sum numeric := 0;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN ARRAY['payload: formato inválido'];
  END IF;
  IF NULLIF(btrim(p_payload->>'supplier_name'), '') IS NULL THEN
    v_errors := array_append(v_errors, 'supplier_name: no detectado');
  END IF;
  IF NULLIF(btrim(p_payload->>'document_number'), '') IS NULL THEN
    v_errors := array_append(v_errors, 'document_number: no detectado');
  END IF;
  IF COALESCE(p_payload->>'currency', '') NOT IN ('ARS', 'USD') THEN
    v_errors := array_append(v_errors, 'currency: debe ser ARS o USD');
  END IF;
  IF NULLIF(p_payload->>'issue_date', '') IS NOT NULL
     AND p_payload->>'issue_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    v_errors := array_append(v_errors, 'issue_date: formato inválido');
  END IF;

  v_items := p_payload->'items';
  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RETURN array_append(v_errors, 'items: se necesita al menos una línea');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_index := v_index + 1;
    IF jsonb_typeof(v_item) <> 'object' THEN
      v_errors := array_append(v_errors, format('items[%s]: formato inválido', v_index));
      CONTINUE;
    END IF;
    IF NULLIF(btrim(v_item->>'description'), '') IS NULL THEN
      v_errors := array_append(v_errors, format('items[%s].description: obligatoria', v_index));
    END IF;
    v_qty := public.finance_document_json_number(v_item->'quantity');
    v_unit := public.finance_document_json_number(v_item->'unit_price');
    v_line := public.finance_document_json_number(v_item->'line_total');
    IF v_qty IS NULL OR v_qty <= 0 THEN
      v_errors := array_append(v_errors, format('items[%s].quantity: debe ser mayor a cero', v_index));
    END IF;
    IF v_unit IS NULL OR v_unit < 0 THEN
      v_errors := array_append(v_errors, format('items[%s].unit_price: inválido', v_index));
    END IF;
    IF v_line IS NULL OR v_line < 0 THEN
      v_errors := array_append(v_errors, format('items[%s].line_total: inválido', v_index));
    ELSIF v_qty IS NOT NULL AND v_unit IS NOT NULL AND abs(v_line - (v_qty * v_unit)) > 0.02 THEN
      v_errors := array_append(v_errors, format('items[%s].line_total: no coincide con cantidad × precio', v_index));
    ELSE
      v_sum := v_sum + COALESCE(v_line, 0);
    END IF;
  END LOOP;

  v_subtotal := public.finance_document_json_number(p_payload->'subtotal');
  v_total := public.finance_document_json_number(p_payload->'total');
  IF v_subtotal IS NULL OR v_subtotal < 0 THEN
    v_errors := array_append(v_errors, 'subtotal: inválido o no detectado');
  ELSIF abs(v_subtotal - v_sum) > 1 THEN
    v_errors := array_append(v_errors, 'subtotal: no reconcilia con las líneas');
  END IF;
  IF v_total IS NULL OR v_total < 0 THEN
    v_errors := array_append(v_errors, 'total: inválido o no detectado');
  ELSIF v_subtotal IS NOT NULL AND v_total < v_subtotal THEN
    v_errors := array_append(v_errors, 'total: menor al subtotal');
  END IF;
  RETURN v_errors;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_document_begin_extraction(
  p_document_id uuid,
  p_version_id uuid
)
RETURNS TABLE (
  extraction_id uuid,
  document_id uuid,
  version_id uuid,
  storage_path text,
  mime_type text,
  source_sha256 text,
  extraction_token uuid,
  should_extract boolean
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_version public.finance_document_versions%ROWTYPE;
  v_existing public.finance_document_extractions%ROWTYPE;
  v_extraction_id uuid := gen_random_uuid();
  v_token uuid := gen_random_uuid();
  v_attempt integer;
BEGIN
  SELECT version.* INTO v_version
  FROM public.finance_document_versions version
  WHERE version.id = p_version_id AND version.document_id = p_document_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Versión documental no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.finance_document_can(v_version.org_id, 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para extraer este documento' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_document_versions newer
    WHERE newer.document_id = v_version.document_id
      AND newer.version_number > v_version.version_number
  ) THEN
    RAISE EXCEPTION 'Sólo se extrae la versión más reciente' USING ERRCODE = '55000';
  END IF;
  IF v_version.inspection_status <> 'ready_for_extraction'
     OR v_version.scanner_status <> 'clean'
     OR v_version.hash_status <> 'verified'
     OR v_version.actual_sha256 IS DISTINCT FROM lower(v_version.sha256) THEN
    RAISE EXCEPTION 'La versión no superó una inspección limpia' USING ERRCODE = '55000';
  END IF;

  SELECT extraction.* INTO v_existing
  FROM public.finance_document_extractions extraction
  WHERE extraction.version_id = v_version.id
  ORDER BY extraction.attempt DESC
  LIMIT 1;

  IF FOUND AND v_existing.status IN ('needs_review', 'ready_for_review', 'reviewed') THEN
    RETURN QUERY SELECT
      v_existing.id, v_version.document_id, v_version.id, v_version.storage_path,
      v_version.actual_mime_type, v_version.actual_sha256, NULL::uuid, false;
    RETURN;
  END IF;
  IF FOUND AND v_existing.status = 'extracting'
     AND v_existing.started_at > now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'La extracción ya está en curso' USING ERRCODE = '55P03';
  END IF;
  IF FOUND AND v_existing.status = 'extracting' THEN
    UPDATE public.finance_document_extractions
    SET status = 'failed', failure_reason = 'Lease de extracción vencido',
        extraction_token = NULL, completed_at = now(), updated_at = now()
    WHERE id = v_existing.id;
  END IF;

  SELECT COALESCE(max(extraction.attempt), 0) + 1 INTO v_attempt
  FROM public.finance_document_extractions extraction
  WHERE extraction.version_id = v_version.id;

  INSERT INTO public.finance_document_extractions(
    id, org_id, document_id, version_id, attempt, source_sha256,
    extraction_token, requested_by
  ) VALUES (
    v_extraction_id, v_version.org_id, v_version.document_id, v_version.id,
    v_attempt, v_version.actual_sha256, v_token, auth.uid()
  );

  UPDATE public.finance_documents SET status = 'in_review', updated_at = now()
  WHERE id = v_version.document_id;

  INSERT INTO public.finance_document_events(
    org_id, document_id, version_id, event_type, actor_id, detail
  ) VALUES (
    v_version.org_id, v_version.document_id, v_version.id,
    'extraction_started', auth.uid(),
    jsonb_build_object('extraction_id', v_extraction_id, 'attempt', v_attempt)
  );

  RETURN QUERY SELECT
    v_extraction_id, v_version.document_id, v_version.id, v_version.storage_path,
    v_version.actual_mime_type, v_version.actual_sha256, v_token, true;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_document_complete_extraction(
  p_extraction_id uuid,
  p_extraction_token uuid,
  p_actor_id uuid,
  p_payload jsonb,
  p_confidence jsonb,
  p_overall_confidence numeric,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_failure_reason text
)
RETURNS TABLE (
  extraction_id uuid,
  extraction_status text,
  overall_confidence numeric,
  validation_errors text[]
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_extraction public.finance_document_extractions%ROWTYPE;
  v_errors text[] := '{}';
  v_status text;
  v_confidence numeric;
  v_failure text := left(NULLIF(btrim(COALESCE(p_failure_reason, '')), ''), 500);
BEGIN
  SELECT extraction.* INTO v_extraction
  FROM public.finance_document_extractions extraction
  WHERE extraction.id = p_extraction_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Extracción no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_extraction.status <> 'extracting'
     OR v_extraction.extraction_token IS DISTINCT FROM p_extraction_token THEN
    RAISE EXCEPTION 'Lease de extracción vencido o reemplazado' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.finance_document_events event
    WHERE event.version_id = v_extraction.version_id
      AND event.event_type = 'extraction_started'
      AND event.actor_id = p_actor_id
      AND event.detail->>'extraction_id' = v_extraction.id::text
  ) THEN
    RAISE EXCEPTION 'El actor no inició esta extracción' USING ERRCODE = '42501';
  END IF;

  IF v_failure IS NOT NULL THEN
    UPDATE public.finance_document_extractions
    SET status = 'failed', failure_reason = v_failure,
        provider = left(NULLIF(btrim(COALESCE(p_provider, '')), ''), 80),
        model = left(NULLIF(btrim(COALESCE(p_model, '')), ''), 120),
        prompt_version = left(NULLIF(btrim(COALESCE(p_prompt_version, '')), ''), 40),
        extraction_token = NULL, completed_at = now(), updated_at = now()
    WHERE id = v_extraction.id;
    INSERT INTO public.finance_document_events(org_id, document_id, version_id, event_type, actor_id, detail)
    VALUES (v_extraction.org_id, v_extraction.document_id, v_extraction.version_id,
      'extraction_failed', p_actor_id,
      jsonb_build_object('extraction_id', v_extraction.id, 'reason', v_failure));
    RETURN QUERY SELECT v_extraction.id, 'failed'::text, NULL::numeric, '{}'::text[];
    RETURN;
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR p_confidence IS NULL OR jsonb_typeof(p_confidence) <> 'object' THEN
    RAISE EXCEPTION 'La extracción no tiene un payload estructurado válido' USING ERRCODE = '22023';
  END IF;
  v_errors := public.finance_document_extraction_errors(p_payload);
  v_confidence := greatest(0, least(1, COALESCE(p_overall_confidence, 0)));
  IF cardinality(v_errors) > 0 THEN v_confidence := least(v_confidence, 0.69); END IF;
  v_status := CASE WHEN v_confidence >= 0.85 AND cardinality(v_errors) = 0
    THEN 'ready_for_review' ELSE 'needs_review' END;

  INSERT INTO public.finance_document_extraction_revisions(
    org_id, extraction_id, revision_number, source, payload, confidence,
    validation_errors, created_by
  ) VALUES (
    v_extraction.org_id, v_extraction.id, 1, 'model', p_payload, p_confidence,
    v_errors, p_actor_id
  );

  UPDATE public.finance_document_extractions
  SET status = v_status, overall_confidence = v_confidence,
      validation_errors = v_errors,
      provider = left(NULLIF(btrim(COALESCE(p_provider, '')), ''), 80),
      model = left(NULLIF(btrim(COALESCE(p_model, '')), ''), 120),
      prompt_version = left(NULLIF(btrim(COALESCE(p_prompt_version, '')), ''), 40),
      extraction_token = NULL, failure_reason = NULL,
      completed_at = now(), updated_at = now()
  WHERE id = v_extraction.id;

  INSERT INTO public.finance_document_events(org_id, document_id, version_id, event_type, actor_id, detail)
  VALUES (
    v_extraction.org_id, v_extraction.document_id, v_extraction.version_id,
    'extraction_completed', p_actor_id,
    jsonb_build_object(
      'extraction_id', v_extraction.id,
      'status', v_status,
      'overall_confidence', v_confidence,
      'validation_error_count', cardinality(v_errors)
    )
  );

  RETURN QUERY SELECT v_extraction.id, v_status, v_confidence, v_errors;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_document_submit_extraction_review(
  p_extraction_id uuid,
  p_payload jsonb,
  p_note text DEFAULT NULL
)
RETURNS TABLE (
  extraction_id uuid,
  extraction_status text,
  revision_number integer,
  validation_errors text[]
)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_extraction public.finance_document_extractions%ROWTYPE;
  v_revision integer;
  v_errors text[];
BEGIN
  SELECT extraction.* INTO v_extraction
  FROM public.finance_document_extractions extraction
  WHERE extraction.id = p_extraction_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Extracción no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.finance_document_can(v_extraction.org_id, 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para revisar esta extracción' USING ERRCODE = '42501';
  END IF;
  IF v_extraction.status NOT IN ('needs_review', 'ready_for_review', 'reviewed') THEN
    RAISE EXCEPTION 'La extracción todavía no se puede revisar' USING ERRCODE = '55000';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'El borrador corregido es inválido' USING ERRCODE = '22023';
  END IF;
  v_errors := public.finance_document_extraction_errors(p_payload);
  IF EXISTS (
    SELECT 1 FROM unnest(v_errors) error
    WHERE error LIKE 'payload:%'
       OR error LIKE 'items:%'
       OR error LIKE 'currency:%'
       OR error LIKE 'issue_date:%'
       OR error LIKE 'subtotal: inválido%'
       OR error LIKE 'total: inválido%'
  ) THEN
    RAISE EXCEPTION 'La revisión todavía contiene campos estructurales inválidos' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(max(revision.revision_number), 0) + 1 INTO v_revision
  FROM public.finance_document_extraction_revisions revision
  WHERE revision.extraction_id = v_extraction.id;

  INSERT INTO public.finance_document_extraction_revisions(
    org_id, extraction_id, revision_number, source, payload, confidence,
    validation_errors, created_by
  ) VALUES (
    v_extraction.org_id, v_extraction.id, v_revision, 'human', p_payload,
    jsonb_build_object('reviewed_by_human', true), v_errors, auth.uid()
  );

  UPDATE public.finance_document_extractions
  SET status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = left(NULLIF(btrim(COALESCE(p_note, '')), ''), 500),
      validation_errors = v_errors, updated_at = now()
  WHERE id = v_extraction.id;

  INSERT INTO public.finance_document_events(org_id, document_id, version_id, event_type, actor_id, detail)
  VALUES (
    v_extraction.org_id, v_extraction.document_id, v_extraction.version_id,
    'extraction_reviewed', auth.uid(),
    jsonb_build_object(
      'extraction_id', v_extraction.id,
      'revision_number', v_revision,
      'remaining_warning_count', cardinality(v_errors)
    )
  );

  RETURN QUERY SELECT v_extraction.id, 'reviewed'::text, v_revision, v_errors;
END;
$fn$;

REVOKE ALL ON FUNCTION public.finance_document_json_number(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_extraction_errors(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_begin_extraction(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_complete_extraction(uuid, uuid, uuid, jsonb, jsonb, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_submit_extraction_review(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_begin_extraction(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_complete_extraction(uuid, uuid, uuid, jsonb, jsonb, numeric, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_document_submit_extraction_review(uuid, jsonb, text) TO authenticated;

COMMENT ON TABLE public.finance_document_extractions IS
  'Intentos de extracción sobre originales inspeccionados; nunca producen efectos contables por sí solos.';
COMMENT ON TABLE public.finance_document_extraction_revisions IS
  'Borradores append-only del modelo y de revisión humana, con confidence y validaciones.';
COMMENT ON FUNCTION public.finance_document_begin_extraction(uuid, uuid) IS
  'Abre lease sólo para la última versión con hash verificado y scanner limpio.';
COMMENT ON FUNCTION public.finance_document_submit_extraction_review(uuid, jsonb, text) IS
  'Crea una revisión humana append-only; no crea compras, stock, deuda ni asientos.';

DO $verify$
BEGIN
  IF has_table_privilege('authenticated', 'public.finance_document_extractions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.finance_document_extraction_revisions', 'UPDATE') THEN
    RAISE EXCEPTION 'El cliente no debe escribir extracciones directamente';
  END IF;
  IF has_function_privilege(
       'authenticated',
       'public.finance_document_complete_extraction(uuid,uuid,uuid,jsonb,jsonb,numeric,text,text,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'authenticated no debe completar extracciones';
  END IF;
  IF NOT has_function_privilege(
       'authenticated',
       'public.finance_document_begin_extraction(uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'authenticated necesita iniciar extracción bajo finance.edit';
  END IF;
END;
$verify$;

-- Prueba el lease, el umbral, la revisión append-only, el aislamiento tenant y
-- que el flujo no cree efectos operativos. Usa un tenant ZZ y lo borra entero.
DO $fixture$
DECLARE
  v_owner uuid;
  v_org uuid;
  v_document uuid := gen_random_uuid();
  v_version uuid := gen_random_uuid();
  v_extraction uuid;
  v_token uuid;
  v_payload jsonb := jsonb_build_object(
    'supplier_name', 'ZZ Proveedor SA',
    'supplier_tax_id', '30-00000000-0',
    'document_number', 'ZZ-A-1',
    'issue_date', '2026-08-22',
    'currency', 'ARS',
    'subtotal', 200,
    'tax_total', 42,
    'total', 242,
    'items', jsonb_build_array(jsonb_build_object(
      'description', 'ZZ producto', 'sku', 'ZZ-1', 'quantity', 2,
      'unit_price', 100, 'line_total', 200, 'tax_rate', 21
    ))
  );
  v_status text;
  v_denied boolean := false;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE NOTICE 'Finance extraction fixture omitido: no hay usuario auth';
    RETURN;
  END IF;

  INSERT INTO public.organizations(name, slug, owner_user_id)
  VALUES ('ZZ Finance extraction', 'zz-finance-extraction-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  RETURNING id INTO v_org;
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner');
  UPDATE public.organization_product_access SET status = 'enabled'
  WHERE org_id = v_org AND product_key = 'finance';

  INSERT INTO public.finance_documents(id, org_id, document_type, title, status, created_by)
  VALUES (v_document, v_org, 'supplier_invoice', 'ZZ factura.pdf', 'in_review', v_owner);
  INSERT INTO public.finance_document_versions(
    id, org_id, document_id, version_number, storage_path, original_filename,
    mime_type, size_bytes, sha256, hash_status, upload_status,
    inspection_status, created_by, actual_sha256, actual_mime_type,
    actual_size_bytes, scanner_provider, scanner_status, uploaded_at, inspected_at
  ) VALUES (
    v_version, v_org, v_document, 1,
    v_org::text || '/' || v_document::text || '/' || v_version::text || '/zz.pdf',
    'ZZ factura.pdf', 'application/pdf', 100, repeat('a', 64),
    'verified', 'uploaded', 'ready_for_extraction', v_owner,
    repeat('a', 64), 'application/pdf', 100, 'fixture', 'clean', now(), now()
  );

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT started.extraction_id, started.extraction_token
    INTO v_extraction, v_token
  FROM public.finance_document_begin_extraction(v_document, v_version) started;
  EXECUTE 'RESET ROLE';

  SELECT completed.extraction_status INTO v_status
  FROM public.finance_document_complete_extraction(
    v_extraction, v_token, v_owner, v_payload,
    jsonb_build_object('fixture', 0.92), 0.92,
    'fixture', 'fixture-model', 'fixture-v1', NULL
  ) completed;
  IF v_status <> 'ready_for_review' THEN
    RAISE EXCEPTION 'La extracción válida no quedó lista para revisión: %', v_status;
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT reviewed.extraction_status INTO v_status
  FROM public.finance_document_submit_extraction_review(v_extraction, v_payload, 'ZZ revisado') reviewed;
  EXECUTE 'RESET ROLE';
  IF v_status <> 'reviewed' THEN
    RAISE EXCEPTION 'La revisión humana no cerró el borrador: %', v_status;
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.finance_document_begin_extraction(v_document, v_version);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'Un outsider pudo iniciar extracción Finance'; END IF;

  IF (SELECT count(*) FROM public.finance_document_extraction_revisions WHERE extraction_id = v_extraction) <> 2
     OR EXISTS (SELECT 1 FROM public.purchases WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.supplier_debts WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'La revisión no fue append-only o produjo efectos operativos';
  END IF;

  PERFORM set_config('app.finance_document_retention_cleanup', 'on', true);
  DELETE FROM public.organizations WHERE id = v_org;
  PERFORM set_config('app.finance_document_retention_cleanup', 'off', true);
  IF EXISTS (SELECT 1 FROM public.finance_documents WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.finance_document_extractions WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.finance_document_extraction_revisions WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'Finance extraction dejó restos ZZ';
  END IF;
  RAISE NOTICE 'Finance extraction verificada: lease, umbral, revisión, ACL, cero efectos y restos 0';
END;
$fixture$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260822000011', 'finance_document_extraction')
ON CONFLICT DO NOTHING;
