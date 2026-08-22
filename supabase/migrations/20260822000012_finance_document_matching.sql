-- F3.17 — Matching determinístico y memoria de aliases confirmados.
--
-- La base propone coincidencias sólo con claves exactas y deja los empates como
-- ambiguos. Una persona confirma proveedor y productos; recién entonces se
-- aprende el vocabulario externo. Este slice no crea compras, obligaciones,
-- stock ni asientos.

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_id_org_uq
  ON public.suppliers(id, org_id);
CREATE UNIQUE INDEX IF NOT EXISTS products_id_org_uq
  ON public.products(id, org_id);

CREATE TABLE IF NOT EXISTS public.finance_supplier_aliases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id          uuid NOT NULL,
  alias_type           text NOT NULL CHECK (alias_type IN ('name', 'tax_id')),
  normalized_alias     text NOT NULL CHECK (char_length(normalized_alias) BETWEEN 1 AND 240),
  source_extraction_id uuid NOT NULL REFERENCES public.finance_document_extractions(id) ON DELETE RESTRICT,
  confirmed_by         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  confirmation_count   integer NOT NULL DEFAULT 1 CHECK (confirmation_count > 0),
  first_confirmed_at   timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_supplier_aliases_supplier_org_fk
    FOREIGN KEY (supplier_id, org_id)
    REFERENCES public.suppliers(id, org_id)
    ON DELETE CASCADE,
  CONSTRAINT finance_supplier_aliases_value_uq
    UNIQUE (org_id, alias_type, normalized_alias)
);

CREATE TABLE IF NOT EXISTS public.finance_product_aliases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id          uuid NOT NULL,
  product_id           uuid NOT NULL,
  alias_type           text NOT NULL CHECK (alias_type IN ('supplier_sku', 'description')),
  normalized_alias     text NOT NULL CHECK (char_length(normalized_alias) BETWEEN 1 AND 400),
  source_extraction_id uuid NOT NULL REFERENCES public.finance_document_extractions(id) ON DELETE RESTRICT,
  confirmed_by         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  confirmation_count   integer NOT NULL DEFAULT 1 CHECK (confirmation_count > 0),
  first_confirmed_at   timestamptz NOT NULL DEFAULT now(),
  last_confirmed_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_product_aliases_supplier_org_fk
    FOREIGN KEY (supplier_id, org_id)
    REFERENCES public.suppliers(id, org_id)
    ON DELETE CASCADE,
  CONSTRAINT finance_product_aliases_product_org_fk
    FOREIGN KEY (product_id, org_id)
    REFERENCES public.products(id, org_id)
    ON DELETE CASCADE,
  CONSTRAINT finance_product_aliases_value_uq
    UNIQUE (org_id, supplier_id, alias_type, normalized_alias)
);

CREATE TABLE IF NOT EXISTS public.finance_document_match_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  extraction_id            uuid NOT NULL,
  revision_id              uuid NOT NULL REFERENCES public.finance_document_extraction_revisions(id) ON DELETE RESTRICT,
  revision_number          integer NOT NULL CHECK (revision_number > 0),
  status                   text NOT NULL DEFAULT 'proposed'
                           CHECK (status IN ('proposed', 'confirmed', 'superseded')),
  proposed_supplier_id     uuid,
  supplier_match_method    text NOT NULL
                           CHECK (supplier_match_method IN ('tax_alias', 'name_alias', 'exact_name', 'none', 'ambiguous')),
  supplier_candidate_count integer NOT NULL DEFAULT 0 CHECK (supplier_candidate_count >= 0),
  confirmed_supplier_id    uuid,
  created_by               uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  confirmed_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  confirmed_at             timestamptz,
  CONSTRAINT finance_document_match_runs_extraction_org_fk
    FOREIGN KEY (extraction_id, org_id)
    REFERENCES public.finance_document_extractions(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT finance_document_match_runs_proposed_supplier_org_fk
    FOREIGN KEY (proposed_supplier_id, org_id)
    REFERENCES public.suppliers(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT finance_document_match_runs_confirmed_supplier_org_fk
    FOREIGN KEY (confirmed_supplier_id, org_id)
    REFERENCES public.suppliers(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT finance_document_match_runs_revision_uq UNIQUE (extraction_id, revision_id),
  CONSTRAINT finance_document_match_runs_id_org_uq UNIQUE (id, org_id)
);

CREATE TABLE IF NOT EXISTS public.finance_document_line_matches (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  match_run_id         uuid NOT NULL,
  line_number          integer NOT NULL CHECK (line_number > 0),
  extracted_sku        text,
  extracted_description text NOT NULL,
  proposed_product_id  uuid,
  proposed_method      text NOT NULL
                       CHECK (proposed_method IN ('supplier_sku_alias', 'exact_sku', 'description_alias', 'exact_name', 'none', 'ambiguous')),
  candidate_count      integer NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  confirmed_product_id uuid,
  confirmation_method  text CHECK (confirmation_method IN ('accepted', 'manual', 'unmatched')),
  CONSTRAINT finance_document_line_matches_run_org_fk
    FOREIGN KEY (match_run_id, org_id)
    REFERENCES public.finance_document_match_runs(id, org_id)
    ON DELETE CASCADE,
  CONSTRAINT finance_document_line_matches_proposed_product_org_fk
    FOREIGN KEY (proposed_product_id, org_id)
    REFERENCES public.products(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT finance_document_line_matches_confirmed_product_org_fk
    FOREIGN KEY (confirmed_product_id, org_id)
    REFERENCES public.products(id, org_id)
    ON DELETE RESTRICT,
  CONSTRAINT finance_document_line_matches_line_uq UNIQUE (match_run_id, line_number)
);

CREATE INDEX IF NOT EXISTS finance_supplier_aliases_supplier_idx
  ON public.finance_supplier_aliases(org_id, supplier_id, alias_type);
CREATE INDEX IF NOT EXISTS finance_product_aliases_product_idx
  ON public.finance_product_aliases(org_id, product_id, supplier_id);
CREATE INDEX IF NOT EXISTS finance_document_match_runs_extraction_idx
  ON public.finance_document_match_runs(extraction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS finance_document_line_matches_run_idx
  ON public.finance_document_line_matches(match_run_id, line_number);

ALTER TABLE public.finance_supplier_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_product_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_document_match_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_document_line_matches ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.finance_supplier_aliases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.finance_product_aliases FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.finance_document_match_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.finance_document_line_matches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_supplier_aliases TO authenticated;
GRANT SELECT ON public.finance_product_aliases TO authenticated;
GRANT SELECT ON public.finance_document_match_runs TO authenticated;
GRANT SELECT ON public.finance_document_line_matches TO authenticated;

DROP POLICY IF EXISTS "finance supplier aliases visible to authorized members" ON public.finance_supplier_aliases;
CREATE POLICY "finance supplier aliases visible to authorized members"
  ON public.finance_supplier_aliases FOR SELECT TO authenticated
  USING (public.finance_document_can(org_id, 'view'));
DROP POLICY IF EXISTS "finance product aliases visible to authorized members" ON public.finance_product_aliases;
CREATE POLICY "finance product aliases visible to authorized members"
  ON public.finance_product_aliases FOR SELECT TO authenticated
  USING (public.finance_document_can(org_id, 'view'));
DROP POLICY IF EXISTS "finance match runs visible to authorized members" ON public.finance_document_match_runs;
CREATE POLICY "finance match runs visible to authorized members"
  ON public.finance_document_match_runs FOR SELECT TO authenticated
  USING (public.finance_document_can(org_id, 'view'));
DROP POLICY IF EXISTS "finance line matches visible to authorized members" ON public.finance_document_line_matches;
CREATE POLICY "finance line matches visible to authorized members"
  ON public.finance_document_line_matches FOR SELECT TO authenticated
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
    'extraction_reviewed', 'matching_proposed', 'matching_confirmed'
  ));

CREATE OR REPLACE FUNCTION public.finance_document_get_matching(p_extraction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_extraction public.finance_document_extractions%ROWTYPE;
  v_run public.finance_document_match_runs%ROWTYPE;
  v_revision public.finance_document_extraction_revisions%ROWTYPE;
BEGIN
  SELECT extraction.* INTO v_extraction
  FROM public.finance_document_extractions extraction
  WHERE extraction.id = p_extraction_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Extracción no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.finance_document_can(v_extraction.org_id, 'view') THEN
    RAISE EXCEPTION 'No tenés permiso para ver este matching' USING ERRCODE = '42501';
  END IF;

  SELECT run.* INTO v_run
  FROM public.finance_document_match_runs run
  WHERE run.extraction_id = v_extraction.id
  ORDER BY run.created_at DESC, run.id DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT revision.* INTO v_revision
  FROM public.finance_document_extraction_revisions revision
  WHERE revision.id = v_run.revision_id;

  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'extraction_id', v_run.extraction_id,
    'revision_number', v_run.revision_number,
    'status', v_run.status,
    'supplier', jsonb_build_object(
      'extracted_name', v_revision.payload->>'supplier_name',
      'extracted_tax_id', v_revision.payload->>'supplier_tax_id',
      'proposed_supplier_id', v_run.proposed_supplier_id,
      'confirmed_supplier_id', v_run.confirmed_supplier_id,
      'selected_supplier_id', COALESCE(v_run.confirmed_supplier_id, v_run.proposed_supplier_id),
      'selected_supplier_name', (
        SELECT supplier.name FROM public.suppliers supplier
        WHERE supplier.id = COALESCE(v_run.confirmed_supplier_id, v_run.proposed_supplier_id)
      ),
      'match_method', v_run.supplier_match_method,
      'candidate_count', v_run.supplier_candidate_count
    ),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'line_number', line.line_number,
        'description', line.extracted_description,
        'sku', line.extracted_sku,
        'proposed_product_id', line.proposed_product_id,
        'confirmed_product_id', line.confirmed_product_id,
        'selected_product_id', COALESCE(line.confirmed_product_id, line.proposed_product_id),
        'selected_product_name', product.name,
        'selected_product_sku', product.sku,
        'match_method', line.proposed_method,
        'candidate_count', line.candidate_count,
        'confirmation_method', line.confirmation_method
      ) ORDER BY line.line_number)
      FROM public.finance_document_line_matches line
      LEFT JOIN public.products product
        ON product.id = COALESCE(line.confirmed_product_id, line.proposed_product_id)
      WHERE line.match_run_id = v_run.id
    ), '[]'::jsonb)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_document_run_matching(p_extraction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_extraction public.finance_document_extractions%ROWTYPE;
  v_revision public.finance_document_extraction_revisions%ROWTYPE;
  v_run_id uuid;
  v_supplier_id uuid;
  v_supplier_method text := 'none';
  v_supplier_count integer := 0;
  v_name_key text;
  v_tax_key text;
  v_item jsonb;
  v_line_number integer;
  v_sku_key text;
  v_description_key text;
  v_product_id uuid;
  v_product_method text;
  v_product_count integer;
BEGIN
  SELECT extraction.* INTO v_extraction
  FROM public.finance_document_extractions extraction
  WHERE extraction.id = p_extraction_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Extracción no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.finance_document_can(v_extraction.org_id, 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para ejecutar el matching' USING ERRCODE = '42501';
  END IF;
  IF v_extraction.status <> 'reviewed' THEN
    RAISE EXCEPTION 'Primero confirmá la revisión humana' USING ERRCODE = '55000';
  END IF;

  SELECT revision.* INTO v_revision
  FROM public.finance_document_extraction_revisions revision
  WHERE revision.extraction_id = v_extraction.id
  ORDER BY revision.revision_number DESC
  LIMIT 1;
  IF NOT FOUND OR v_revision.source <> 'human' THEN
    RAISE EXCEPTION 'No existe una revisión humana para matchear' USING ERRCODE = '55000';
  END IF;

  SELECT run.id INTO v_run_id
  FROM public.finance_document_match_runs run
  WHERE run.extraction_id = v_extraction.id
    AND run.revision_id = v_revision.id;
  IF FOUND THEN RETURN public.finance_document_get_matching(v_extraction.id); END IF;

  v_name_key := public.normalize_identity_text(v_revision.payload->>'supplier_name');
  v_tax_key := public.normalize_identity_phone(v_revision.payload->>'supplier_tax_id');

  IF v_tax_key IS NOT NULL THEN
    SELECT alias.supplier_id INTO v_supplier_id
    FROM public.finance_supplier_aliases alias
    WHERE alias.org_id = v_extraction.org_id
      AND alias.alias_type = 'tax_id'
      AND alias.normalized_alias = v_tax_key;
    IF FOUND THEN v_supplier_method := 'tax_alias'; v_supplier_count := 1; END IF;
  END IF;
  IF v_supplier_id IS NULL AND v_name_key IS NOT NULL THEN
    SELECT alias.supplier_id INTO v_supplier_id
    FROM public.finance_supplier_aliases alias
    WHERE alias.org_id = v_extraction.org_id
      AND alias.alias_type = 'name'
      AND alias.normalized_alias = v_name_key;
    IF FOUND THEN v_supplier_method := 'name_alias'; v_supplier_count := 1; END IF;
  END IF;
  IF v_supplier_id IS NULL AND v_name_key IS NOT NULL THEN
    SELECT count(*), (array_agg(supplier.id ORDER BY supplier.id))[1]
      INTO v_supplier_count, v_supplier_id
    FROM public.suppliers supplier
    WHERE supplier.org_id = v_extraction.org_id
      AND supplier.active
      AND public.normalize_identity_text(supplier.name) = v_name_key;
    IF v_supplier_count = 1 THEN
      v_supplier_method := 'exact_name';
    ELSIF v_supplier_count > 1 THEN
      v_supplier_id := NULL;
      v_supplier_method := 'ambiguous';
    ELSE
      v_supplier_method := 'none';
    END IF;
  END IF;

  UPDATE public.finance_document_match_runs
  SET status = 'superseded'
  WHERE extraction_id = v_extraction.id AND status = 'proposed';

  INSERT INTO public.finance_document_match_runs(
    org_id, extraction_id, revision_id, revision_number, status,
    proposed_supplier_id, supplier_match_method, supplier_candidate_count, created_by
  ) VALUES (
    v_extraction.org_id, v_extraction.id, v_revision.id, v_revision.revision_number,
    'proposed', v_supplier_id, v_supplier_method, v_supplier_count, auth.uid()
  ) RETURNING id INTO v_run_id;

  FOR v_item, v_line_number IN
    SELECT item.value, item.ordinality::integer
    FROM jsonb_array_elements(v_revision.payload->'items') WITH ORDINALITY item(value, ordinality)
  LOOP
    v_sku_key := public.normalize_product_sku(v_item->>'sku');
    v_description_key := public.normalize_identity_text(v_item->>'description');
    v_product_id := NULL;
    v_product_method := 'none';
    v_product_count := 0;

    IF v_supplier_id IS NOT NULL AND v_sku_key IS NOT NULL THEN
      SELECT alias.product_id INTO v_product_id
      FROM public.finance_product_aliases alias
      WHERE alias.org_id = v_extraction.org_id
        AND alias.supplier_id = v_supplier_id
        AND alias.alias_type = 'supplier_sku'
        AND alias.normalized_alias = v_sku_key;
      IF FOUND THEN v_product_method := 'supplier_sku_alias'; v_product_count := 1; END IF;
    END IF;

    IF v_product_id IS NULL AND v_sku_key IS NOT NULL THEN
      SELECT count(*), (array_agg(product.id ORDER BY product.id))[1]
        INTO v_product_count, v_product_id
      FROM public.products product
      WHERE product.org_id = v_extraction.org_id
        AND product.is_active
        AND public.normalize_product_sku(product.sku) = v_sku_key;
      IF v_product_count = 1 THEN
        v_product_method := 'exact_sku';
      ELSIF v_product_count > 1 THEN
        v_product_id := NULL;
        v_product_method := 'ambiguous';
      END IF;
    END IF;

    IF v_product_id IS NULL AND v_product_method <> 'ambiguous'
       AND v_supplier_id IS NOT NULL AND v_description_key IS NOT NULL THEN
      SELECT alias.product_id INTO v_product_id
      FROM public.finance_product_aliases alias
      WHERE alias.org_id = v_extraction.org_id
        AND alias.supplier_id = v_supplier_id
        AND alias.alias_type = 'description'
        AND alias.normalized_alias = v_description_key;
      IF FOUND THEN v_product_method := 'description_alias'; v_product_count := 1; END IF;
    END IF;

    IF v_product_id IS NULL AND v_product_method <> 'ambiguous' AND v_description_key IS NOT NULL THEN
      SELECT count(DISTINCT product.id), (array_agg(DISTINCT product.id ORDER BY product.id))[1]
        INTO v_product_count, v_product_id
      FROM public.products product
      WHERE product.org_id = v_extraction.org_id
        AND product.is_active
        AND (
          public.normalize_identity_text(product.name) = v_description_key
          OR public.normalize_identity_text(concat_ws(' ', NULLIF(product.brand, ''), product.name)) = v_description_key
        );
      IF v_product_count = 1 THEN
        v_product_method := 'exact_name';
      ELSIF v_product_count > 1 THEN
        v_product_id := NULL;
        v_product_method := 'ambiguous';
      ELSE
        v_product_method := 'none';
      END IF;
    END IF;

    INSERT INTO public.finance_document_line_matches(
      org_id, match_run_id, line_number, extracted_sku, extracted_description,
      proposed_product_id, proposed_method, candidate_count
    ) VALUES (
      v_extraction.org_id, v_run_id, v_line_number, NULLIF(btrim(v_item->>'sku'), ''),
      COALESCE(NULLIF(btrim(v_item->>'description'), ''), 'Sin descripción'),
      v_product_id, v_product_method, v_product_count
    );
  END LOOP;

  INSERT INTO public.finance_document_events(org_id, document_id, version_id, event_type, actor_id, detail)
  VALUES (
    v_extraction.org_id, v_extraction.document_id, v_extraction.version_id,
    'matching_proposed', auth.uid(), jsonb_build_object(
      'extraction_id', v_extraction.id,
      'match_run_id', v_run_id,
      'revision_number', v_revision.revision_number,
      'supplier_method', v_supplier_method,
      'line_count', jsonb_array_length(v_revision.payload->'items')
    )
  );

  RETURN public.finance_document_get_matching(v_extraction.id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_document_confirm_matching(
  p_match_run_id uuid,
  p_supplier_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_run public.finance_document_match_runs%ROWTYPE;
  v_extraction public.finance_document_extractions%ROWTYPE;
  v_revision public.finance_document_extraction_revisions%ROWTYPE;
  v_line public.finance_document_line_matches%ROWTYPE;
  v_choice jsonb;
  v_product_id uuid;
  v_alias text;
  v_existing uuid;
  v_line_count integer;
  v_matched_count integer := 0;
BEGIN
  SELECT run.* INTO v_run
  FROM public.finance_document_match_runs run
  WHERE run.id = p_match_run_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Propuesta de matching no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.finance_document_can(v_run.org_id, 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para confirmar el matching' USING ERRCODE = '42501';
  END IF;
  IF v_run.status = 'superseded' THEN
    RAISE EXCEPTION 'La propuesta quedó obsoleta por una revisión posterior' USING ERRCODE = '55000';
  END IF;
  IF p_supplier_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.suppliers supplier
    WHERE supplier.id = p_supplier_id AND supplier.org_id = v_run.org_id AND supplier.active
  ) THEN
    RAISE EXCEPTION 'Elegí un proveedor activo de esta organización' USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Las decisiones de líneas son inválidas' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_line_count
  FROM public.finance_document_line_matches line
  WHERE line.match_run_id = v_run.id;
  IF jsonb_array_length(p_lines) <> v_line_count
     OR (SELECT count(DISTINCT (choice->>'line_number')::integer) FROM jsonb_array_elements(p_lines) choice) <> v_line_count
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_lines) choice
       WHERE NOT EXISTS (
         SELECT 1 FROM public.finance_document_line_matches line
         WHERE line.match_run_id = v_run.id
           AND line.line_number = (choice->>'line_number')::integer
       )
     ) THEN
    RAISE EXCEPTION 'Confirmá exactamente una decisión por línea' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) choice
    WHERE NULLIF(choice->>'product_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.products product
        WHERE product.id = (choice->>'product_id')::uuid
          AND product.org_id = v_run.org_id
          AND product.is_active
      )
  ) THEN
    RAISE EXCEPTION 'Una línea apunta a un producto inválido o de otra organización' USING ERRCODE = '22023';
  END IF;

  IF v_run.status = 'confirmed' THEN
    IF v_run.confirmed_supplier_id IS DISTINCT FROM p_supplier_id
       OR EXISTS (
         SELECT 1
         FROM public.finance_document_line_matches line
         JOIN jsonb_array_elements(p_lines) choice
           ON (choice->>'line_number')::integer = line.line_number
         WHERE line.match_run_id = v_run.id
           AND line.confirmed_product_id IS DISTINCT FROM NULLIF(choice->>'product_id', '')::uuid
       ) THEN
      RAISE EXCEPTION 'El matching ya fue confirmado con otra decisión' USING ERRCODE = '40001';
    END IF;
    RETURN public.finance_document_get_matching(v_run.extraction_id);
  END IF;

  SELECT extraction.* INTO v_extraction
  FROM public.finance_document_extractions extraction
  WHERE extraction.id = v_run.extraction_id;
  SELECT revision.* INTO v_revision
  FROM public.finance_document_extraction_revisions revision
  WHERE revision.id = v_run.revision_id;
  IF EXISTS (
    SELECT 1 FROM public.finance_document_extraction_revisions newer
    WHERE newer.extraction_id = v_run.extraction_id
      AND newer.revision_number > v_run.revision_number
  ) THEN
    UPDATE public.finance_document_match_runs SET status = 'superseded' WHERE id = v_run.id;
    RAISE EXCEPTION 'La revisión cambió; ejecutá el matching nuevamente' USING ERRCODE = '55000';
  END IF;

  -- El alias nunca se reasigna en silencio. Un conflicto exige revisión explícita.
  v_alias := public.normalize_identity_text(v_revision.payload->>'supplier_name');
  IF v_alias IS NOT NULL THEN
    SELECT alias.supplier_id INTO v_existing
    FROM public.finance_supplier_aliases alias
    WHERE alias.org_id = v_run.org_id AND alias.alias_type = 'name'
      AND alias.normalized_alias = v_alias;
    IF v_existing IS NOT NULL AND v_existing <> p_supplier_id THEN
      RAISE EXCEPTION 'El nombre del proveedor ya pertenece a otro proveedor' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.finance_supplier_aliases(
      org_id, supplier_id, alias_type, normalized_alias, source_extraction_id, confirmed_by
    ) VALUES (v_run.org_id, p_supplier_id, 'name', v_alias, v_run.extraction_id, auth.uid())
    ON CONFLICT (org_id, alias_type, normalized_alias) DO UPDATE
    SET last_confirmed_at = now(), confirmation_count = finance_supplier_aliases.confirmation_count + 1,
        source_extraction_id = EXCLUDED.source_extraction_id, confirmed_by = EXCLUDED.confirmed_by;
  END IF;

  v_alias := public.normalize_identity_phone(v_revision.payload->>'supplier_tax_id');
  IF v_alias IS NOT NULL THEN
    SELECT alias.supplier_id INTO v_existing
    FROM public.finance_supplier_aliases alias
    WHERE alias.org_id = v_run.org_id AND alias.alias_type = 'tax_id'
      AND alias.normalized_alias = v_alias;
    IF v_existing IS NOT NULL AND v_existing <> p_supplier_id THEN
      RAISE EXCEPTION 'El CUIT ya pertenece a otro proveedor' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.finance_supplier_aliases(
      org_id, supplier_id, alias_type, normalized_alias, source_extraction_id, confirmed_by
    ) VALUES (v_run.org_id, p_supplier_id, 'tax_id', v_alias, v_run.extraction_id, auth.uid())
    ON CONFLICT (org_id, alias_type, normalized_alias) DO UPDATE
    SET last_confirmed_at = now(), confirmation_count = finance_supplier_aliases.confirmation_count + 1,
        source_extraction_id = EXCLUDED.source_extraction_id, confirmed_by = EXCLUDED.confirmed_by;
  END IF;

  FOR v_line IN
    SELECT line.* FROM public.finance_document_line_matches line
    WHERE line.match_run_id = v_run.id ORDER BY line.line_number
  LOOP
    SELECT choice INTO v_choice
    FROM jsonb_array_elements(p_lines) choice
    WHERE (choice->>'line_number')::integer = v_line.line_number;
    v_product_id := NULLIF(v_choice->>'product_id', '')::uuid;

    UPDATE public.finance_document_line_matches
    SET confirmed_product_id = v_product_id,
        confirmation_method = CASE
          WHEN v_product_id IS NULL THEN 'unmatched'
          WHEN v_product_id = v_line.proposed_product_id THEN 'accepted'
          ELSE 'manual'
        END
    WHERE id = v_line.id;

    IF v_product_id IS NULL THEN CONTINUE; END IF;
    v_matched_count := v_matched_count + 1;

    v_alias := public.normalize_product_sku(v_line.extracted_sku);
    IF v_alias IS NOT NULL THEN
      SELECT alias.product_id INTO v_existing
      FROM public.finance_product_aliases alias
      WHERE alias.org_id = v_run.org_id AND alias.supplier_id = p_supplier_id
        AND alias.alias_type = 'supplier_sku' AND alias.normalized_alias = v_alias;
      IF v_existing IS NOT NULL AND v_existing <> v_product_id THEN
        RAISE EXCEPTION 'El SKU del proveedor ya pertenece a otro producto' USING ERRCODE = '23505';
      END IF;
      INSERT INTO public.finance_product_aliases(
        org_id, supplier_id, product_id, alias_type, normalized_alias,
        source_extraction_id, confirmed_by
      ) VALUES (
        v_run.org_id, p_supplier_id, v_product_id, 'supplier_sku', v_alias,
        v_run.extraction_id, auth.uid()
      )
      ON CONFLICT (org_id, supplier_id, alias_type, normalized_alias) DO UPDATE
      SET last_confirmed_at = now(), confirmation_count = finance_product_aliases.confirmation_count + 1,
          source_extraction_id = EXCLUDED.source_extraction_id, confirmed_by = EXCLUDED.confirmed_by;
    END IF;

    v_alias := public.normalize_identity_text(v_line.extracted_description);
    IF v_alias IS NOT NULL THEN
      SELECT alias.product_id INTO v_existing
      FROM public.finance_product_aliases alias
      WHERE alias.org_id = v_run.org_id AND alias.supplier_id = p_supplier_id
        AND alias.alias_type = 'description' AND alias.normalized_alias = v_alias;
      IF v_existing IS NOT NULL AND v_existing <> v_product_id THEN
        RAISE EXCEPTION 'La descripción del proveedor ya pertenece a otro producto' USING ERRCODE = '23505';
      END IF;
      INSERT INTO public.finance_product_aliases(
        org_id, supplier_id, product_id, alias_type, normalized_alias,
        source_extraction_id, confirmed_by
      ) VALUES (
        v_run.org_id, p_supplier_id, v_product_id, 'description', v_alias,
        v_run.extraction_id, auth.uid()
      )
      ON CONFLICT (org_id, supplier_id, alias_type, normalized_alias) DO UPDATE
      SET last_confirmed_at = now(), confirmation_count = finance_product_aliases.confirmation_count + 1,
          source_extraction_id = EXCLUDED.source_extraction_id, confirmed_by = EXCLUDED.confirmed_by;
    END IF;
  END LOOP;

  UPDATE public.finance_document_match_runs
  SET status = 'confirmed', confirmed_supplier_id = p_supplier_id,
      confirmed_by = auth.uid(), confirmed_at = now()
  WHERE id = v_run.id;

  INSERT INTO public.finance_document_events(org_id, document_id, version_id, event_type, actor_id, detail)
  VALUES (
    v_run.org_id, v_extraction.document_id, v_extraction.version_id,
    'matching_confirmed', auth.uid(), jsonb_build_object(
      'extraction_id', v_run.extraction_id,
      'match_run_id', v_run.id,
      'supplier_id', p_supplier_id,
      'line_count', v_line_count,
      'matched_line_count', v_matched_count
    )
  );

  RETURN public.finance_document_get_matching(v_run.extraction_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.finance_document_get_matching(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_run_matching(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_confirm_matching(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_get_matching(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_run_matching(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_confirm_matching(uuid, uuid, jsonb) TO authenticated;

COMMENT ON TABLE public.finance_supplier_aliases IS
  'Vocabulario externo de proveedor aprendido sólo por confirmación humana y aislado por tenant.';
COMMENT ON TABLE public.finance_product_aliases IS
  'SKU/descripción de proveedor confirmados contra un producto canónico; nunca actualizan stock o costo.';
COMMENT ON TABLE public.finance_document_match_runs IS
  'Propuesta reproducible por revisión y confirmación humana separada, con historial auditable.';
COMMENT ON FUNCTION public.finance_document_run_matching(uuid) IS
  'Propone coincidencias exactas y conserva none/ambiguous sin usar similitud probabilística.';
COMMENT ON FUNCTION public.finance_document_confirm_matching(uuid, uuid, jsonb) IS
  'Confirma proveedor/líneas y aprende aliases; no crea efectos operativos.';

DO $verify$
BEGIN
  IF has_table_privilege('authenticated', 'public.finance_supplier_aliases', 'INSERT')
     OR has_table_privilege('authenticated', 'public.finance_product_aliases', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.finance_document_match_runs', 'INSERT')
     OR has_table_privilege('authenticated', 'public.finance_document_line_matches', 'UPDATE') THEN
    RAISE EXCEPTION 'El cliente no debe escribir matching ni aliases directamente';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.finance_document_run_matching(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.finance_document_confirm_matching(uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Finance necesita ejecutar matching mediante RPC protegido';
  END IF;
END;
$verify$;

-- Verifica propuesta conservadora, ambigüedad, confirmación, aprendizaje en la
-- factura siguiente, aislamiento tenant, idempotencia, cero efectos y restos 0.
DO $fixture$
DECLARE
  v_owner uuid;
  v_org uuid;
  v_supplier uuid;
  v_product uuid;
  v_duplicate_a uuid;
  v_duplicate_b uuid;
  v_document_1 uuid := gen_random_uuid();
  v_version_1 uuid := gen_random_uuid();
  v_extraction_1 uuid := gen_random_uuid();
  v_document_2 uuid := gen_random_uuid();
  v_version_2 uuid := gen_random_uuid();
  v_extraction_2 uuid := gen_random_uuid();
  v_snapshot jsonb;
  v_run uuid;
  v_denied boolean := false;
  v_payload_1 jsonb := jsonb_build_object(
    'supplier_name', 'ZZ Proveedor Canonico', 'supplier_tax_id', '30-99999999-1',
    'document_number', 'ZZ-A-1', 'issue_date', '2026-08-22', 'currency', 'ARS',
    'subtotal', 100, 'tax_total', 21, 'total', 121,
    'items', jsonb_build_array(jsonb_build_object(
      'description', 'ZZ presentación externa', 'sku', 'EXT-123',
      'quantity', 1, 'unit_price', 100, 'line_total', 100, 'tax_rate', 21
    ))
  );
  v_payload_2 jsonb := jsonb_build_object(
    'supplier_name', 'ZZ Nombre OCR alternativo', 'supplier_tax_id', '30 99999999 1',
    'document_number', 'ZZ-A-2', 'issue_date', '2026-08-22', 'currency', 'ARS',
    'subtotal', 200, 'tax_total', 42, 'total', 242,
    'items', jsonb_build_array(
      jsonb_build_object(
        'description', 'ZZ otra descripción', 'sku', 'EXT-123',
        'quantity', 1, 'unit_price', 100, 'line_total', 100, 'tax_rate', 21
      ),
      jsonb_build_object(
        'description', 'ZZ Producto Duplicado', 'sku', NULL,
        'quantity', 1, 'unit_price', 100, 'line_total', 100, 'tax_rate', 21
      )
    )
  );
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE NOTICE 'Finance matching fixture omitido: no hay usuario auth';
    RETURN;
  END IF;

  INSERT INTO public.organizations(name, slug, owner_user_id)
  VALUES ('ZZ Finance matching', 'zz-finance-matching-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  RETURNING id INTO v_org;
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner');
  UPDATE public.organization_product_access SET status = 'enabled'
  WHERE org_id = v_org AND product_key = 'finance';

  INSERT INTO public.suppliers(org_id, name)
  VALUES (v_org, 'ZZ Proveedor Canonico') RETURNING id INTO v_supplier;
  INSERT INTO public.products(user_id, org_id, name, brand, sku)
  VALUES (v_owner, v_org, 'ZZ Producto Canonico', 'ZZ', 'CANON-1') RETURNING id INTO v_product;
  INSERT INTO public.products(user_id, org_id, name, brand)
  VALUES (v_owner, v_org, 'ZZ Producto Duplicado', '') RETURNING id INTO v_duplicate_a;
  INSERT INTO public.products(user_id, org_id, name, brand)
  VALUES (v_owner, v_org, 'ZZ Producto Duplicado', '') RETURNING id INTO v_duplicate_b;

  INSERT INTO public.finance_documents(id, org_id, document_type, title, status, created_by)
  VALUES
    (v_document_1, v_org, 'supplier_invoice', 'ZZ factura 1.pdf', 'in_review', v_owner),
    (v_document_2, v_org, 'supplier_invoice', 'ZZ factura 2.pdf', 'in_review', v_owner);
  INSERT INTO public.finance_document_versions(
    id, org_id, document_id, version_number, storage_path, original_filename,
    mime_type, size_bytes, sha256, hash_status, upload_status,
    inspection_status, created_by, actual_sha256, actual_mime_type,
    actual_size_bytes, scanner_provider, scanner_status, uploaded_at, inspected_at
  ) VALUES
    (v_version_1, v_org, v_document_1, 1, v_org::text || '/1.pdf', 'ZZ 1.pdf',
     'application/pdf', 100, repeat('a', 64), 'verified', 'uploaded',
     'ready_for_extraction', v_owner, repeat('a', 64), 'application/pdf', 100,
     'fixture', 'clean', now(), now()),
    (v_version_2, v_org, v_document_2, 1, v_org::text || '/2.pdf', 'ZZ 2.pdf',
     'application/pdf', 100, repeat('b', 64), 'verified', 'uploaded',
     'ready_for_extraction', v_owner, repeat('b', 64), 'application/pdf', 100,
     'fixture', 'clean', now(), now());
  INSERT INTO public.finance_document_extractions(
    id, org_id, document_id, version_id, attempt, status, source_sha256,
    requested_by, reviewed_by, completed_at, reviewed_at
  ) VALUES
    (v_extraction_1, v_org, v_document_1, v_version_1, 1, 'reviewed', repeat('a', 64), v_owner, v_owner, now(), now()),
    (v_extraction_2, v_org, v_document_2, v_version_2, 1, 'reviewed', repeat('b', 64), v_owner, v_owner, now(), now());
  INSERT INTO public.finance_document_extraction_revisions(
    org_id, extraction_id, revision_number, source, payload, confidence,
    validation_errors, created_by
  ) VALUES
    (v_org, v_extraction_1, 1, 'human', v_payload_1, '{"reviewed_by_human":true}', '{}', v_owner),
    (v_org, v_extraction_2, 1, 'human', v_payload_2, '{"reviewed_by_human":true}', '{}', v_owner);

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_snapshot := public.finance_document_run_matching(v_extraction_1);
  IF (SELECT count(*) FROM public.finance_document_match_runs WHERE org_id = v_org) <> 1
     OR (SELECT count(*) FROM public.finance_document_line_matches WHERE org_id = v_org) <> 1 THEN
    RAISE EXCEPTION 'El owner no pudo leer la propuesta mediante RLS';
  END IF;
  EXECUTE 'RESET ROLE';
  IF v_snapshot #>> '{supplier,match_method}' <> 'exact_name'
     OR v_snapshot #>> '{lines,0,match_method}' <> 'none' THEN
    RAISE EXCEPTION 'La primera propuesta no fue conservadora: %', v_snapshot;
  END IF;

  v_run := (v_snapshot->>'run_id')::uuid;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_snapshot := public.finance_document_confirm_matching(
    v_run, v_supplier,
    jsonb_build_array(jsonb_build_object('line_number', 1, 'product_id', v_product))
  );
  -- Retry exacto: no duplica aliases ni eventos.
  v_snapshot := public.finance_document_confirm_matching(
    v_run, v_supplier,
    jsonb_build_array(jsonb_build_object('line_number', 1, 'product_id', v_product))
  );
  EXECUTE 'RESET ROLE';
  IF v_snapshot->>'status' <> 'confirmed'
     OR (SELECT count(*) FROM public.finance_supplier_aliases WHERE org_id = v_org) <> 2
     OR (SELECT count(*) FROM public.finance_product_aliases WHERE org_id = v_org) <> 2 THEN
    RAISE EXCEPTION 'La confirmación no aprendió exactamente los aliases esperados';
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_snapshot := public.finance_document_run_matching(v_extraction_2);
  EXECUTE 'RESET ROLE';
  IF v_snapshot #>> '{supplier,match_method}' <> 'tax_alias'
     OR v_snapshot #>> '{lines,0,match_method}' <> 'supplier_sku_alias'
     OR v_snapshot #>> '{lines,1,match_method}' <> 'ambiguous'
     OR (v_snapshot #>> '{lines,1,candidate_count}')::integer <> 2 THEN
    RAISE EXCEPTION 'La factura siguiente no reutilizó aliases o no preservó ambigüedad: %', v_snapshot;
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.finance_document_run_matching(v_extraction_2);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF EXISTS (SELECT 1 FROM public.finance_document_match_runs WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.finance_document_line_matches WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.finance_supplier_aliases WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.finance_product_aliases WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'RLS expuso matching o aliases a un outsider';
  END IF;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'Un outsider pudo leer/ejecutar matching Finance'; END IF;

  IF EXISTS (SELECT 1 FROM public.purchases WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.supplier_debts WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.ledger_entries WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'El matching produjo efectos operativos prematuros';
  END IF;

  PERFORM set_config('app.finance_document_retention_cleanup', 'on', true);
  DELETE FROM public.organizations WHERE id = v_org;
  PERFORM set_config('app.finance_document_retention_cleanup', 'off', true);
  IF EXISTS (SELECT 1 FROM public.finance_document_match_runs WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.finance_document_line_matches WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.finance_supplier_aliases WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.finance_product_aliases WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.products WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.suppliers WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'Finance matching dejó restos ZZ';
  END IF;
  RAISE NOTICE 'Finance matching verificado: aliases, ambigüedad, ACL, idempotencia, cero efectos y restos 0';
END;
$fixture$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260822000012', 'finance_document_matching')
ON CONFLICT DO NOTHING;
