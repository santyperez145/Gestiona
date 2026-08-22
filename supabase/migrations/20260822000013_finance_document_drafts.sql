-- F3.18 — Factura revisada -> borradores -> orden/deuda aprobadas.
--
-- Crear un borrador no toca el Business Core. Aprobarlo materializa una orden
-- confirmada y una obligación; el stock sigue inmóvil hasta que el RPC de
-- recepción cree `purchases`, cuyo trigger es la única autoridad del Kardex.

CREATE UNIQUE INDEX IF NOT EXISTS finance_document_revisions_id_org_uq
  ON public.finance_document_extraction_revisions(id, org_id);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_id_org_uq
  ON public.purchase_orders(id, org_id);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_debts_id_org_uq
  ON public.supplier_debts(id, org_id);

CREATE TABLE IF NOT EXISTS public.finance_supplier_invoice_drafts (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  document_id                uuid NOT NULL,
  extraction_id              uuid NOT NULL,
  revision_id                uuid NOT NULL,
  revision_number            integer NOT NULL CHECK (revision_number > 0),
  match_run_id               uuid NOT NULL,
  supplier_id                uuid NOT NULL,
  supplier_name              text NOT NULL CHECK (char_length(supplier_name) BETWEEN 1 AND 240),
  supplier_tax_id            text,
  document_number            text,
  normalized_document_number text,
  issue_date                 date,
  currency                   text CHECK (currency IS NULL OR currency IN ('ARS', 'USD')),
  subtotal                   numeric(16,2),
  tax_total                  numeric(16,2),
  total                      numeric(16,2),
  status                     text NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'approved', 'rejected')),
  created_by                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  approved_at                timestamptz,
  CONSTRAINT finance_supplier_invoice_drafts_document_org_fk
    FOREIGN KEY (document_id, org_id)
    REFERENCES public.finance_documents(id, org_id) ON DELETE RESTRICT,
  CONSTRAINT finance_supplier_invoice_drafts_extraction_org_fk
    FOREIGN KEY (extraction_id, org_id)
    REFERENCES public.finance_document_extractions(id, org_id) ON DELETE RESTRICT,
  CONSTRAINT finance_supplier_invoice_drafts_revision_org_fk
    FOREIGN KEY (revision_id, org_id)
    REFERENCES public.finance_document_extraction_revisions(id, org_id) ON DELETE RESTRICT,
  CONSTRAINT finance_supplier_invoice_drafts_match_org_fk
    FOREIGN KEY (match_run_id, org_id)
    REFERENCES public.finance_document_match_runs(id, org_id) ON DELETE RESTRICT,
  CONSTRAINT finance_supplier_invoice_drafts_supplier_org_fk
    FOREIGN KEY (supplier_id, org_id)
    REFERENCES public.suppliers(id, org_id) ON DELETE RESTRICT,
  CONSTRAINT finance_supplier_invoice_drafts_extraction_uq UNIQUE (extraction_id),
  CONSTRAINT finance_supplier_invoice_drafts_id_org_uq UNIQUE (id, org_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_supplier_invoice_identity_uq
  ON public.finance_supplier_invoice_drafts(org_id, supplier_id, normalized_document_number)
  WHERE normalized_document_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.finance_purchase_drafts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_draft_id     uuid NOT NULL,
  status               text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'approved', 'rejected')),
  purchase_order_id    uuid,
  created_by           uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  approved_at          timestamptz,
  CONSTRAINT finance_purchase_drafts_invoice_org_fk
    FOREIGN KEY (invoice_draft_id, org_id)
    REFERENCES public.finance_supplier_invoice_drafts(id, org_id) ON DELETE CASCADE,
  CONSTRAINT finance_purchase_drafts_order_org_fk
    FOREIGN KEY (purchase_order_id, org_id)
    REFERENCES public.purchase_orders(id, org_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT finance_purchase_drafts_invoice_uq UNIQUE (invoice_draft_id),
  CONSTRAINT finance_purchase_drafts_order_uq UNIQUE (purchase_order_id),
  CONSTRAINT finance_purchase_drafts_id_org_uq UNIQUE (id, org_id),
  CONSTRAINT finance_purchase_drafts_effect_check CHECK (
    (status = 'approved' AND purchase_order_id IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR (status <> 'approved' AND purchase_order_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.finance_purchase_draft_lines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purchase_draft_id    uuid NOT NULL,
  line_number          integer NOT NULL CHECK (line_number > 0),
  disposition          text NOT NULL DEFAULT 'unresolved'
                       CHECK (disposition IN ('inventory', 'non_inventory', 'unresolved')),
  product_id           uuid,
  extracted_description text NOT NULL CHECK (char_length(extracted_description) BETWEEN 1 AND 500),
  extracted_sku        text,
  quantity             numeric(14,4),
  unit_cost            numeric(16,4),
  tax_rate             numeric(7,3),
  line_total           numeric(16,2),
  CONSTRAINT finance_purchase_draft_lines_draft_org_fk
    FOREIGN KEY (purchase_draft_id, org_id)
    REFERENCES public.finance_purchase_drafts(id, org_id) ON DELETE CASCADE,
  CONSTRAINT finance_purchase_draft_lines_product_org_fk
    FOREIGN KEY (product_id, org_id)
    REFERENCES public.products(id, org_id) ON DELETE RESTRICT,
  CONSTRAINT finance_purchase_draft_lines_number_uq UNIQUE (purchase_draft_id, line_number),
  CONSTRAINT finance_purchase_draft_lines_product_check CHECK (
    (disposition = 'inventory' AND product_id IS NOT NULL)
    OR (disposition IN ('non_inventory', 'unresolved') AND product_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.finance_payable_drafts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_draft_id   uuid NOT NULL,
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'approved', 'rejected')),
  currency           text CHECK (currency IS NULL OR currency IN ('ARS', 'USD')),
  amount_original    numeric(16,2),
  exchange_rate      numeric(16,4),
  amount_ars         numeric(16,2),
  due_date           date,
  supplier_debt_id   uuid,
  created_by         uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  approved_at        timestamptz,
  CONSTRAINT finance_payable_drafts_invoice_org_fk
    FOREIGN KEY (invoice_draft_id, org_id)
    REFERENCES public.finance_supplier_invoice_drafts(id, org_id) ON DELETE CASCADE,
  CONSTRAINT finance_payable_drafts_debt_org_fk
    FOREIGN KEY (supplier_debt_id, org_id)
    REFERENCES public.supplier_debts(id, org_id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT finance_payable_drafts_invoice_uq UNIQUE (invoice_draft_id),
  CONSTRAINT finance_payable_drafts_debt_uq UNIQUE (supplier_debt_id),
  CONSTRAINT finance_payable_drafts_id_org_uq UNIQUE (id, org_id),
  CONSTRAINT finance_payable_drafts_effect_check CHECK (
    (status = 'approved' AND supplier_debt_id IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR (status <> 'approved' AND supplier_debt_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS finance_supplier_invoice_drafts_org_status_idx
  ON public.finance_supplier_invoice_drafts(org_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS finance_purchase_draft_lines_draft_idx
  ON public.finance_purchase_draft_lines(purchase_draft_id, line_number);
CREATE INDEX IF NOT EXISTS finance_payable_drafts_due_idx
  ON public.finance_payable_drafts(org_id, status, due_date);

ALTER TABLE public.finance_supplier_invoice_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_purchase_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_purchase_draft_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_payable_drafts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.finance_supplier_invoice_drafts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.finance_purchase_drafts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.finance_purchase_draft_lines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.finance_payable_drafts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_supplier_invoice_drafts TO authenticated;
GRANT SELECT ON public.finance_purchase_drafts TO authenticated;
GRANT SELECT ON public.finance_purchase_draft_lines TO authenticated;
GRANT SELECT ON public.finance_payable_drafts TO authenticated;

DROP POLICY IF EXISTS "finance invoice drafts visible to authorized members" ON public.finance_supplier_invoice_drafts;
CREATE POLICY "finance invoice drafts visible to authorized members"
  ON public.finance_supplier_invoice_drafts FOR SELECT TO authenticated
  USING (public.finance_document_can(org_id, 'view'));
DROP POLICY IF EXISTS "finance purchase drafts visible to authorized members" ON public.finance_purchase_drafts;
CREATE POLICY "finance purchase drafts visible to authorized members"
  ON public.finance_purchase_drafts FOR SELECT TO authenticated
  USING (public.finance_document_can(org_id, 'view'));
DROP POLICY IF EXISTS "finance purchase draft lines visible to authorized members" ON public.finance_purchase_draft_lines;
CREATE POLICY "finance purchase draft lines visible to authorized members"
  ON public.finance_purchase_draft_lines FOR SELECT TO authenticated
  USING (public.finance_document_can(org_id, 'view'));
DROP POLICY IF EXISTS "finance payable drafts visible to authorized members" ON public.finance_payable_drafts;
CREATE POLICY "finance payable drafts visible to authorized members"
  ON public.finance_payable_drafts FOR SELECT TO authenticated
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
    'extraction_reviewed', 'matching_proposed', 'matching_confirmed',
    'drafts_created', 'drafts_approved'
  ));

CREATE OR REPLACE FUNCTION public.finance_document_get_drafts(p_extraction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_invoice public.finance_supplier_invoice_drafts%ROWTYPE;
  v_purchase public.finance_purchase_drafts%ROWTYPE;
  v_payable public.finance_payable_drafts%ROWTYPE;
  v_blockers text[] := '{}';
BEGIN
  SELECT invoice.* INTO v_invoice
  FROM public.finance_supplier_invoice_drafts invoice
  WHERE invoice.extraction_id = p_extraction_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT public.finance_document_can(v_invoice.org_id, 'view') THEN
    RAISE EXCEPTION 'No tenés permiso para ver estos borradores' USING ERRCODE = '42501';
  END IF;

  SELECT purchase.* INTO STRICT v_purchase
  FROM public.finance_purchase_drafts purchase
  WHERE purchase.invoice_draft_id = v_invoice.id;
  SELECT payable.* INTO STRICT v_payable
  FROM public.finance_payable_drafts payable
  WHERE payable.invoice_draft_id = v_invoice.id;

  IF v_invoice.document_number IS NULL THEN v_blockers := array_append(v_blockers, 'document_number_missing'); END IF;
  IF v_invoice.issue_date IS NULL THEN v_blockers := array_append(v_blockers, 'issue_date_missing'); END IF;
  IF v_invoice.currency IS NULL THEN v_blockers := array_append(v_blockers, 'currency_missing'); END IF;
  IF v_invoice.total IS NULL OR v_invoice.total <= 0 THEN v_blockers := array_append(v_blockers, 'total_invalid'); END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_purchase_draft_lines line
    WHERE line.purchase_draft_id = v_purchase.id AND line.disposition = 'unresolved'
  ) THEN v_blockers := array_append(v_blockers, 'lines_unresolved'); END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_purchase_draft_lines line
    WHERE line.purchase_draft_id = v_purchase.id
      AND (line.quantity IS NULL OR line.quantity <= 0 OR line.quantity <> trunc(line.quantity))
  ) THEN v_blockers := array_append(v_blockers, 'quantity_invalid'); END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_purchase_draft_lines line
    WHERE line.purchase_draft_id = v_purchase.id
      AND (line.unit_cost IS NULL OR line.unit_cost < 0 OR line.line_total IS NULL OR line.line_total < 0)
  ) THEN v_blockers := array_append(v_blockers, 'line_amount_invalid'); END IF;
  IF v_invoice.currency = 'USD' AND (v_payable.exchange_rate IS NULL OR v_payable.exchange_rate <= 0) THEN
    v_blockers := array_append(v_blockers, 'exchange_rate_missing');
  END IF;

  RETURN jsonb_build_object(
    'invoice_draft_id', v_invoice.id,
    'extraction_id', v_invoice.extraction_id,
    'status', v_invoice.status,
    'revision_number', v_invoice.revision_number,
    'supplier', jsonb_build_object(
      'id', v_invoice.supplier_id,
      'name', v_invoice.supplier_name,
      'tax_id', v_invoice.supplier_tax_id
    ),
    'invoice', jsonb_build_object(
      'document_number', v_invoice.document_number,
      'issue_date', v_invoice.issue_date,
      'currency', v_invoice.currency,
      'subtotal', v_invoice.subtotal,
      'tax_total', v_invoice.tax_total,
      'total', v_invoice.total
    ),
    'purchase', jsonb_build_object(
      'draft_id', v_purchase.id,
      'status', v_purchase.status,
      'purchase_order_id', v_purchase.purchase_order_id
    ),
    'payable', jsonb_build_object(
      'draft_id', v_payable.id,
      'status', v_payable.status,
      'currency', v_payable.currency,
      'amount_original', v_payable.amount_original,
      'exchange_rate', v_payable.exchange_rate,
      'amount_ars', v_payable.amount_ars,
      'due_date', v_payable.due_date,
      'supplier_debt_id', v_payable.supplier_debt_id
    ),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'line_number', line.line_number,
        'disposition', line.disposition,
        'product_id', line.product_id,
        'product_name', product.name,
        'description', line.extracted_description,
        'sku', line.extracted_sku,
        'quantity', line.quantity,
        'unit_cost', line.unit_cost,
        'tax_rate', line.tax_rate,
        'line_total', line.line_total
      ) ORDER BY line.line_number)
      FROM public.finance_purchase_draft_lines line
      LEFT JOIN public.products product ON product.id = line.product_id
      WHERE line.purchase_draft_id = v_purchase.id
    ), '[]'::jsonb),
    'blockers', to_jsonb(v_blockers),
    'can_approve', public.finance_document_can(v_invoice.org_id, 'edit')
      AND public.has_org_role(v_invoice.org_id, auth.uid(), ARRAY['owner', 'admin'])
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_document_create_drafts(p_extraction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_extraction public.finance_document_extractions%ROWTYPE;
  v_revision public.finance_document_extraction_revisions%ROWTYPE;
  v_match public.finance_document_match_runs%ROWTYPE;
  v_document public.finance_documents%ROWTYPE;
  v_supplier_name text;
  v_invoice_id uuid;
  v_purchase_id uuid;
  v_existing public.finance_supplier_invoice_drafts%ROWTYPE;
  v_item jsonb;
  v_line_number integer;
  v_line_match public.finance_document_line_matches%ROWTYPE;
  v_document_number text;
  v_normalized_number text;
  v_currency text;
  v_total numeric;
BEGIN
  SELECT extraction.* INTO v_extraction
  FROM public.finance_document_extractions extraction
  WHERE extraction.id = p_extraction_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Extracción no encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.finance_document_can(v_extraction.org_id, 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para crear borradores' USING ERRCODE = '42501';
  END IF;
  IF v_extraction.status <> 'reviewed' THEN
    RAISE EXCEPTION 'La extracción necesita revisión humana antes de crear borradores' USING ERRCODE = '55000';
  END IF;

  SELECT document.* INTO STRICT v_document
  FROM public.finance_documents document
  WHERE document.id = v_extraction.document_id;
  IF v_document.document_type <> 'supplier_invoice' THEN
    RAISE EXCEPTION 'Sólo una factura de proveedor puede crear estos borradores' USING ERRCODE = '22023';
  END IF;

  SELECT revision.* INTO v_revision
  FROM public.finance_document_extraction_revisions revision
  WHERE revision.extraction_id = v_extraction.id
  ORDER BY revision.revision_number DESC
  LIMIT 1;
  IF NOT FOUND OR v_revision.source <> 'human' THEN
    RAISE EXCEPTION 'Falta la revisión humana vigente' USING ERRCODE = '55000';
  END IF;

  SELECT run.* INTO v_match
  FROM public.finance_document_match_runs run
  WHERE run.extraction_id = v_extraction.id
    AND run.revision_id = v_revision.id
    AND run.status = 'confirmed'
  ORDER BY run.confirmed_at DESC
  LIMIT 1;
  IF NOT FOUND OR v_match.confirmed_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Confirmá el matching vigente antes de crear borradores' USING ERRCODE = '55000';
  END IF;

  SELECT supplier.name INTO v_supplier_name
  FROM public.suppliers supplier
  WHERE supplier.id = v_match.confirmed_supplier_id
    AND supplier.org_id = v_extraction.org_id;
  IF v_supplier_name IS NULL THEN
    RAISE EXCEPTION 'El proveedor confirmado ya no está disponible' USING ERRCODE = '55000';
  END IF;

  v_document_number := NULLIF(btrim(v_revision.payload->>'document_number'), '');
  v_normalized_number := NULLIF(public.normalize_identity_text(v_document_number), '');
  v_currency := NULLIF(upper(btrim(v_revision.payload->>'currency')), '');
  v_total := public.finance_document_json_number(v_revision.payload->'total');

  SELECT invoice.* INTO v_existing
  FROM public.finance_supplier_invoice_drafts invoice
  WHERE invoice.extraction_id = v_extraction.id
  FOR UPDATE;
  IF FOUND AND v_existing.status = 'approved' THEN
    IF v_existing.revision_id <> v_revision.id THEN
      RAISE EXCEPTION 'La factura ya fue aprobada con otra revisión' USING ERRCODE = '55000';
    END IF;
    RETURN public.finance_document_get_drafts(v_extraction.id);
  END IF;
  IF FOUND AND v_existing.revision_id = v_revision.id AND v_existing.match_run_id = v_match.id THEN
    RETURN public.finance_document_get_drafts(v_extraction.id);
  END IF;

  IF v_normalized_number IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.finance_supplier_invoice_drafts other
    WHERE other.org_id = v_extraction.org_id
      AND other.supplier_id = v_match.confirmed_supplier_id
      AND other.normalized_document_number = v_normalized_number
      AND other.extraction_id <> v_extraction.id
  ) THEN
    RAISE EXCEPTION 'Ya existe una factura de este proveedor con el mismo número' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.finance_supplier_invoice_drafts(
    org_id, document_id, extraction_id, revision_id, revision_number, match_run_id,
    supplier_id, supplier_name, supplier_tax_id, document_number,
    normalized_document_number, issue_date, currency, subtotal, tax_total, total,
    status, created_by, updated_at
  ) VALUES (
    v_extraction.org_id, v_extraction.document_id, v_extraction.id, v_revision.id,
    v_revision.revision_number, v_match.id, v_match.confirmed_supplier_id,
    v_supplier_name, NULLIF(btrim(v_revision.payload->>'supplier_tax_id'), ''),
    v_document_number, v_normalized_number,
    CASE WHEN COALESCE(v_revision.payload->>'issue_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (v_revision.payload->>'issue_date')::date ELSE NULL END,
    CASE WHEN v_currency IN ('ARS', 'USD') THEN v_currency ELSE NULL END,
    public.finance_document_json_number(v_revision.payload->'subtotal'),
    public.finance_document_json_number(v_revision.payload->'tax_total'),
    v_total, 'draft', auth.uid(), now()
  )
  ON CONFLICT (extraction_id) DO UPDATE SET
    revision_id = EXCLUDED.revision_id,
    revision_number = EXCLUDED.revision_number,
    match_run_id = EXCLUDED.match_run_id,
    supplier_id = EXCLUDED.supplier_id,
    supplier_name = EXCLUDED.supplier_name,
    supplier_tax_id = EXCLUDED.supplier_tax_id,
    document_number = EXCLUDED.document_number,
    normalized_document_number = EXCLUDED.normalized_document_number,
    issue_date = EXCLUDED.issue_date,
    currency = EXCLUDED.currency,
    subtotal = EXCLUDED.subtotal,
    tax_total = EXCLUDED.tax_total,
    total = EXCLUDED.total,
    updated_at = now()
  RETURNING id INTO v_invoice_id;

  INSERT INTO public.finance_purchase_drafts(org_id, invoice_draft_id, status, created_by)
  VALUES (v_extraction.org_id, v_invoice_id, 'draft', auth.uid())
  ON CONFLICT (invoice_draft_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_purchase_id;

  INSERT INTO public.finance_payable_drafts(
    org_id, invoice_draft_id, status, currency, amount_original,
    exchange_rate, amount_ars, created_by
  ) VALUES (
    v_extraction.org_id, v_invoice_id, 'draft',
    CASE WHEN v_currency IN ('ARS', 'USD') THEN v_currency ELSE NULL END,
    v_total,
    CASE WHEN v_currency = 'ARS' THEN 1 ELSE NULL END,
    CASE WHEN v_currency = 'ARS' THEN v_total ELSE NULL END,
    auth.uid()
  )
  ON CONFLICT (invoice_draft_id) DO UPDATE SET
    currency = EXCLUDED.currency,
    amount_original = EXCLUDED.amount_original,
    exchange_rate = EXCLUDED.exchange_rate,
    amount_ars = EXCLUDED.amount_ars,
    updated_at = now();

  DELETE FROM public.finance_purchase_draft_lines
  WHERE purchase_draft_id = v_purchase_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(v_revision.payload->'items', '[]'::jsonb)) LOOP
    v_line_number := COALESCE((v_item->>'line_number')::integer, 0);
    IF v_line_number <= 0 THEN
      v_line_number := (SELECT COALESCE(max(line.line_number), 0) + 1
                        FROM public.finance_purchase_draft_lines line
                        WHERE line.purchase_draft_id = v_purchase_id);
    END IF;
    SELECT line.* INTO v_line_match
    FROM public.finance_document_line_matches line
    WHERE line.match_run_id = v_match.id AND line.line_number = v_line_number;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El matching no cubre la línea %', v_line_number USING ERRCODE = '55000';
    END IF;

    INSERT INTO public.finance_purchase_draft_lines(
      org_id, purchase_draft_id, line_number, disposition, product_id,
      extracted_description, extracted_sku, quantity, unit_cost, tax_rate, line_total
    ) VALUES (
      v_extraction.org_id, v_purchase_id, v_line_number,
      CASE WHEN v_line_match.confirmed_product_id IS NULL THEN 'unresolved' ELSE 'inventory' END,
      v_line_match.confirmed_product_id,
      left(COALESCE(NULLIF(btrim(v_item->>'description'), ''), 'Línea sin descripción'), 500),
      NULLIF(btrim(v_item->>'sku'), ''),
      public.finance_document_json_number(v_item->'quantity'),
      public.finance_document_json_number(v_item->'unit_price'),
      public.finance_document_json_number(v_item->'tax_rate'),
      public.finance_document_json_number(v_item->'line_total')
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.finance_purchase_draft_lines line
    WHERE line.purchase_draft_id = v_purchase_id
  ) THEN
    RAISE EXCEPTION 'La factura no tiene líneas para preparar' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.finance_document_events(org_id, document_id, version_id, event_type, actor_id, detail)
  VALUES (
    v_extraction.org_id, v_extraction.document_id, v_extraction.version_id,
    'drafts_created', auth.uid(), jsonb_build_object(
      'extraction_id', v_extraction.id,
      'revision_number', v_revision.revision_number,
      'match_run_id', v_match.id,
      'invoice_draft_id', v_invoice_id,
      'line_count', (SELECT count(*) FROM public.finance_purchase_draft_lines WHERE purchase_draft_id = v_purchase_id)
    )
  );
  RETURN public.finance_document_get_drafts(v_extraction.id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_document_approve_drafts(
  p_invoice_draft_id uuid,
  p_due_date date,
  p_exchange_rate numeric,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_invoice public.finance_supplier_invoice_drafts%ROWTYPE;
  v_purchase public.finance_purchase_drafts%ROWTYPE;
  v_payable public.finance_payable_drafts%ROWTYPE;
  v_latest_revision uuid;
  v_supplier_name text;
  v_line public.finance_purchase_draft_lines%ROWTYPE;
  v_choice jsonb;
  v_disposition text;
  v_product_id uuid;
  v_product_name text;
  v_product_sku text;
  v_order_id uuid;
  v_debt_id uuid;
  v_rate numeric;
  v_amount_ars numeric;
  v_order_number text;
  v_line_count integer;
BEGIN
  SELECT invoice.* INTO v_invoice
  FROM public.finance_supplier_invoice_drafts invoice
  WHERE invoice.id = p_invoice_draft_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Borrador de factura no encontrado' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.finance_document_can(v_invoice.org_id, 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para aprobar estos borradores' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_org_role(v_invoice.org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'La aprobación final requiere rol owner o admin' USING ERRCODE = '42501';
  END IF;

  SELECT purchase.* INTO STRICT v_purchase
  FROM public.finance_purchase_drafts purchase
  WHERE purchase.invoice_draft_id = v_invoice.id
  FOR UPDATE;
  SELECT payable.* INTO STRICT v_payable
  FROM public.finance_payable_drafts payable
  WHERE payable.invoice_draft_id = v_invoice.id
  FOR UPDATE;
  IF v_invoice.status = 'approved' THEN
    RETURN public.finance_document_get_drafts(v_invoice.extraction_id);
  END IF;
  IF v_invoice.status <> 'draft' OR v_purchase.status <> 'draft' OR v_payable.status <> 'draft' THEN
    RAISE EXCEPTION 'Los borradores ya no están disponibles para aprobación' USING ERRCODE = '55000';
  END IF;

  SELECT revision.id INTO v_latest_revision
  FROM public.finance_document_extraction_revisions revision
  WHERE revision.extraction_id = v_invoice.extraction_id
  ORDER BY revision.revision_number DESC LIMIT 1;
  IF v_latest_revision IS DISTINCT FROM v_invoice.revision_id THEN
    RAISE EXCEPTION 'Hay una revisión más nueva; regenerá los borradores antes de aprobar' USING ERRCODE = '55000';
  END IF;
  IF v_invoice.document_number IS NULL OR v_invoice.issue_date IS NULL
     OR v_invoice.currency NOT IN ('ARS', 'USD')
     OR v_invoice.total IS NULL OR v_invoice.total <= 0 THEN
    RAISE EXCEPTION 'Completá número, fecha, moneda y total en la revisión' USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Las decisiones de líneas son inválidas' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_line_count
  FROM public.finance_purchase_draft_lines line
  WHERE line.purchase_draft_id = v_purchase.id;
  IF v_line_count = 0 OR jsonb_array_length(p_lines) <> v_line_count THEN
    RAISE EXCEPTION 'Confirmá una decisión para cada línea' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN
    SELECT line.* FROM public.finance_purchase_draft_lines line
    WHERE line.purchase_draft_id = v_purchase.id
    ORDER BY line.line_number FOR UPDATE
  LOOP
    SELECT choice INTO v_choice
    FROM jsonb_array_elements(p_lines) choice
    WHERE (choice->>'line_number')::integer = v_line.line_number;
    IF NOT FOUND OR (
      SELECT count(*) FROM jsonb_array_elements(p_lines) choice
      WHERE (choice->>'line_number')::integer = v_line.line_number
    ) <> 1 THEN
      RAISE EXCEPTION 'La línea % necesita una sola decisión', v_line.line_number USING ERRCODE = '22023';
    END IF;

    v_disposition := v_choice->>'disposition';
    v_product_id := NULLIF(v_choice->>'product_id', '')::uuid;
    IF v_disposition = 'inventory' THEN
      IF v_product_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.products product
        WHERE product.id = v_product_id AND product.org_id = v_invoice.org_id AND product.is_active = true
      ) THEN
        RAISE EXCEPTION 'Elegí un producto activo para la línea %', v_line.line_number USING ERRCODE = '22023';
      END IF;
    ELSIF v_disposition = 'non_inventory' THEN
      v_product_id := NULL;
    ELSE
      RAISE EXCEPTION 'Resolvé la línea % como inventario o cargo no inventariable', v_line.line_number USING ERRCODE = '22023';
    END IF;
    IF v_line.quantity IS NULL OR v_line.quantity <= 0 OR v_line.quantity <> trunc(v_line.quantity)
       OR v_line.unit_cost IS NULL OR v_line.unit_cost < 0
       OR v_line.line_total IS NULL OR v_line.line_total < 0 THEN
      RAISE EXCEPTION 'Cantidad o importes inválidos en la línea %', v_line.line_number USING ERRCODE = '22023';
    END IF;

    UPDATE public.finance_purchase_draft_lines
    SET disposition = v_disposition, product_id = v_product_id
    WHERE id = v_line.id;
  END LOOP;

  v_rate := CASE WHEN v_invoice.currency = 'ARS' THEN 1 ELSE p_exchange_rate END;
  IF v_rate IS NULL OR v_rate <= 0 OR v_rate > 1000000000 THEN
    RAISE EXCEPTION 'Indicá un tipo de cambio válido para la factura en USD' USING ERRCODE = '22023';
  END IF;
  v_amount_ars := round(v_invoice.total * v_rate, 2);
  IF v_amount_ars <= 0 THEN
    RAISE EXCEPTION 'La obligación en ARS debe ser positiva' USING ERRCODE = '22023';
  END IF;

  SELECT supplier.name INTO v_supplier_name
  FROM public.suppliers supplier
  WHERE supplier.id = v_invoice.supplier_id AND supplier.org_id = v_invoice.org_id;
  IF v_supplier_name IS NULL THEN
    RAISE EXCEPTION 'El proveedor ya no está disponible' USING ERRCODE = '55000';
  END IF;

  v_order_number := left(
    'FIN-' || regexp_replace(v_invoice.document_number, '[^[:alnum:]-]+', '-', 'g')
    || '-' || left(v_invoice.id::text, 8), 120
  );
  INSERT INTO public.purchase_orders(
    org_id, order_number, supplier_id, supplier_name, status, currency,
    subtotal, tax_amount, discount_amount, total_amount, internal_notes,
    payment_terms, confirmed_at
  ) VALUES (
    v_invoice.org_id, v_order_number, v_invoice.supplier_id, v_supplier_name,
    'confirmed', v_invoice.currency, COALESCE(v_invoice.subtotal, 0),
    COALESCE(v_invoice.tax_total, 0), 0, v_invoice.total,
    'Generada desde factura Finance ' || v_invoice.document_number,
    CASE WHEN p_due_date IS NULL THEN NULL ELSE 'Vence ' || p_due_date::text END,
    now()
  ) RETURNING id INTO v_order_id;

  FOR v_line IN
    SELECT line.* FROM public.finance_purchase_draft_lines line
    WHERE line.purchase_draft_id = v_purchase.id ORDER BY line.line_number
  LOOP
    IF v_line.product_id IS NOT NULL THEN
      SELECT product.name, product.sku INTO v_product_name, v_product_sku
      FROM public.products product WHERE product.id = v_line.product_id;
    ELSE
      v_product_name := v_line.extracted_description;
      v_product_sku := v_line.extracted_sku;
    END IF;
    INSERT INTO public.purchase_order_items(
      order_id, org_id, product_id, product_name, sku, quantity_ordered,
      quantity_received, unit_cost, tax_rate, total_cost
    ) VALUES (
      v_order_id, v_invoice.org_id, v_line.product_id, v_product_name,
      COALESCE(v_product_sku, v_line.extracted_sku), v_line.quantity,
      0, v_line.unit_cost, COALESCE(v_line.tax_rate, 0), v_line.line_total
    );
  END LOOP;

  INSERT INTO public.supplier_debts(
    org_id, supplier_id, supplier_name, description, amount_ars, paid_ars,
    due_date, status, notes
  ) VALUES (
    v_invoice.org_id, v_invoice.supplier_id, v_supplier_name,
    'Factura ' || v_invoice.document_number, v_amount_ars, 0,
    p_due_date, 'pending',
    'Aprobada desde Gestiona Finance · ' || v_invoice.currency || ' '
      || v_invoice.total::text || ' · TC ' || v_rate::text
  ) RETURNING id INTO v_debt_id;

  UPDATE public.finance_purchase_drafts
  SET status = 'approved', purchase_order_id = v_order_id,
      approved_by = auth.uid(), approved_at = now(), updated_at = now()
  WHERE id = v_purchase.id;
  UPDATE public.finance_payable_drafts
  SET status = 'approved', exchange_rate = v_rate, amount_ars = v_amount_ars,
      due_date = p_due_date, supplier_debt_id = v_debt_id,
      approved_by = auth.uid(), approved_at = now(), updated_at = now()
  WHERE id = v_payable.id;
  UPDATE public.finance_supplier_invoice_drafts
  SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
  WHERE id = v_invoice.id;
  UPDATE public.finance_documents SET status = 'approved', updated_at = now()
  WHERE id = v_invoice.document_id;

  INSERT INTO public.finance_document_events(org_id, document_id, event_type, actor_id, detail)
  VALUES (
    v_invoice.org_id, v_invoice.document_id, 'drafts_approved', auth.uid(),
    jsonb_build_object(
      'invoice_draft_id', v_invoice.id,
      'purchase_order_id', v_order_id,
      'supplier_debt_id', v_debt_id,
      'currency', v_invoice.currency,
      'line_count', v_line_count,
      'stock_effect', false
    )
  );
  RETURN public.finance_document_get_drafts(v_invoice.extraction_id);
END;
$fn$;

-- Una factura ya materializada no puede recibir una revisión nueva que deje
-- los links del Core apuntando a una foto vieja.
CREATE OR REPLACE FUNCTION public.guard_approved_finance_invoice_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.finance_supplier_invoice_drafts invoice
    WHERE invoice.extraction_id = NEW.extraction_id AND invoice.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'La factura aprobada es inmutable; cargá una nota de crédito o una nueva versión documental'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_guard_approved_finance_invoice_revision
  ON public.finance_document_extraction_revisions;
CREATE TRIGGER trg_guard_approved_finance_invoice_revision
BEFORE INSERT ON public.finance_document_extraction_revisions
FOR EACH ROW EXECUTE FUNCTION public.guard_approved_finance_invoice_revision();

REVOKE ALL ON FUNCTION public.finance_document_get_drafts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_create_drafts(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_document_approve_drafts(uuid, date, numeric, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_approved_finance_invoice_revision() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_get_drafts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_create_drafts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_document_approve_drafts(uuid, date, numeric, jsonb) TO authenticated;

COMMENT ON TABLE public.finance_supplier_invoice_drafts IS
  'Snapshot fiscal revisado; no es una deuda ni una compra hasta aprobación owner/admin.';
COMMENT ON TABLE public.finance_purchase_drafts IS
  'Preparación operativa que materializa una purchase_order del Core al aprobarse.';
COMMENT ON TABLE public.finance_payable_drafts IS
  'Preparación monetaria que materializa una supplier_debt del Core al aprobarse.';
COMMENT ON FUNCTION public.finance_document_approve_drafts(uuid, date, numeric, jsonb) IS
  'Aprobación idempotente: crea una orden y una deuda; el stock espera receive_purchase_order.';

DO $verify$
BEGIN
  IF has_table_privilege('authenticated', 'public.finance_supplier_invoice_drafts', 'INSERT')
     OR has_table_privilege('authenticated', 'public.finance_purchase_drafts', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.finance_purchase_draft_lines', 'DELETE')
     OR has_table_privilege('authenticated', 'public.finance_payable_drafts', 'INSERT') THEN
    RAISE EXCEPTION 'El navegador no debe escribir borradores Finance directamente';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.finance_document_create_drafts(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.finance_document_approve_drafts(uuid,date,numeric,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Finance necesita ejecutar el workflow mediante RPC protegido';
  END IF;
END;
$verify$;

-- Fixture real: borradores sin efectos, aprobación owner/admin, línea no
-- inventariable explícita, retry idempotente, outsider/RLS, stock quieto y 0 restos.
DO $fixture$
DECLARE
  v_owner uuid;
  v_org uuid;
  v_supplier uuid;
  v_product uuid;
  v_document uuid := gen_random_uuid();
  v_version uuid := gen_random_uuid();
  v_extraction uuid := gen_random_uuid();
  v_revision uuid;
  v_match uuid := gen_random_uuid();
  v_invoice uuid;
  v_snapshot jsonb;
  v_stock_before numeric;
  v_denied boolean := false;
  v_direct_write_blocked boolean := false;
  v_payload jsonb := jsonb_build_object(
    'supplier_name', 'ZZ Proveedor drafts', 'supplier_tax_id', '30-88888888-2',
    'document_number', 'ZZ-FAC-100', 'issue_date', '2026-08-22', 'currency', 'ARS',
    'subtotal', 1000, 'tax_total', 210, 'total', 1210,
    'items', jsonb_build_array(
      jsonb_build_object('description', 'ZZ Producto drafts', 'sku', 'ZZ-DRAFT-1',
        'quantity', 2, 'unit_price', 400, 'line_total', 800, 'tax_rate', 21),
      jsonb_build_object('description', 'ZZ Flete no inventariable', 'sku', NULL,
        'quantity', 1, 'unit_price', 200, 'line_total', 200, 'tax_rate', 21)
    )
  );
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE NOTICE 'Finance drafts fixture omitido: no hay usuario auth';
    RETURN;
  END IF;

  INSERT INTO public.organizations(name, slug, owner_user_id)
  VALUES ('ZZ Finance drafts', 'zz-finance-drafts-' || substr(gen_random_uuid()::text, 1, 8), v_owner)
  RETURNING id INTO v_org;
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner');
  UPDATE public.organization_product_access SET status = 'enabled'
  WHERE org_id = v_org AND product_key = 'finance';
  INSERT INTO public.suppliers(org_id, name)
  VALUES (v_org, 'ZZ Proveedor drafts') RETURNING id INTO v_supplier;
  INSERT INTO public.products(user_id, org_id, name, sku, stock, is_active)
  VALUES (v_owner, v_org, 'ZZ Producto drafts', 'ZZ-DRAFT-1', 7, true)
  RETURNING id, stock INTO v_product, v_stock_before;

  INSERT INTO public.finance_documents(id, org_id, document_type, title, status, created_by)
  VALUES (v_document, v_org, 'supplier_invoice', 'ZZ factura drafts.pdf', 'in_review', v_owner);
  INSERT INTO public.finance_document_versions(
    id, org_id, document_id, version_number, storage_path, original_filename,
    mime_type, size_bytes, sha256, hash_status, upload_status, inspection_status,
    created_by, actual_sha256, actual_mime_type, actual_size_bytes,
    scanner_provider, scanner_status, uploaded_at, inspected_at
  ) VALUES (
    v_version, v_org, v_document, 1, v_org::text || '/draft.pdf', 'ZZ drafts.pdf',
    'application/pdf', 100, repeat('d', 64), 'verified', 'uploaded', 'ready_for_extraction',
    v_owner, repeat('d', 64), 'application/pdf', 100, 'fixture', 'clean', now(), now()
  );
  INSERT INTO public.finance_document_extractions(
    id, org_id, document_id, version_id, attempt, status, source_sha256,
    requested_by, reviewed_by, completed_at, reviewed_at
  ) VALUES (
    v_extraction, v_org, v_document, v_version, 1, 'reviewed', repeat('d', 64),
    v_owner, v_owner, now(), now()
  );
  INSERT INTO public.finance_document_extraction_revisions(
    org_id, extraction_id, revision_number, source, payload, confidence,
    validation_errors, created_by
  ) VALUES (
    v_org, v_extraction, 1, 'human', v_payload,
    '{"reviewed_by_human":true}', '{}', v_owner
  ) RETURNING id INTO v_revision;
  INSERT INTO public.finance_document_match_runs(
    id, org_id, extraction_id, revision_id, revision_number, status,
    proposed_supplier_id, supplier_match_method, supplier_candidate_count,
    confirmed_supplier_id, created_by, confirmed_by, confirmed_at
  ) VALUES (
    v_match, v_org, v_extraction, v_revision, 1, 'confirmed', v_supplier,
    'exact_name', 1, v_supplier, v_owner, v_owner, now()
  );
  INSERT INTO public.finance_document_line_matches(
    org_id, match_run_id, line_number, extracted_sku, extracted_description,
    proposed_product_id, proposed_method, candidate_count,
    confirmed_product_id, confirmation_method
  ) VALUES
    (v_org, v_match, 1, 'ZZ-DRAFT-1', 'ZZ Producto drafts', v_product,
      'exact_sku', 1, v_product, 'accepted'),
    (v_org, v_match, 2, NULL, 'ZZ Flete no inventariable', NULL,
      'none', 0, NULL, 'unmatched');

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_snapshot := public.finance_document_create_drafts(v_extraction);
  v_invoice := (v_snapshot->>'invoice_draft_id')::uuid;
  IF (SELECT count(*) FROM public.finance_supplier_invoice_drafts WHERE org_id = v_org) <> 1
     OR (SELECT count(*) FROM public.finance_purchase_draft_lines WHERE org_id = v_org) <> 2 THEN
    RAISE EXCEPTION 'El owner no pudo leer los borradores mediante RLS';
  END IF;
  BEGIN
    UPDATE public.finance_supplier_invoice_drafts SET status = 'rejected' WHERE id = v_invoice;
  EXCEPTION WHEN insufficient_privilege THEN v_direct_write_blocked := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_direct_write_blocked
     OR v_snapshot->>'status' <> 'draft'
     OR NOT (v_snapshot->'blockers' @> '["lines_unresolved"]'::jsonb)
     OR EXISTS (SELECT 1 FROM public.purchase_orders WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.supplier_debts WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.purchases WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.ledger_entries WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'Crear borradores permitió escritura directa, produjo efectos o perdió bloqueos: %', v_snapshot;
  END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.finance_document_create_drafts(v_extraction);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF EXISTS (SELECT 1 FROM public.finance_supplier_invoice_drafts WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.finance_purchase_drafts WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.finance_purchase_draft_lines WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.finance_payable_drafts WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'RLS expuso borradores Finance a un outsider';
  END IF;
  EXECUTE 'RESET ROLE';
  IF NOT v_denied THEN RAISE EXCEPTION 'Un outsider pudo crear borradores Finance'; END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner::text, 'role', 'authenticated'
  )::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_snapshot := public.finance_document_approve_drafts(
    v_invoice, '2026-09-21', NULL,
    jsonb_build_array(
      jsonb_build_object('line_number', 1, 'disposition', 'inventory', 'product_id', v_product),
      jsonb_build_object('line_number', 2, 'disposition', 'non_inventory', 'product_id', NULL)
    )
  );
  -- Retry exacto: el estado aprobado es la clave idempotente.
  v_snapshot := public.finance_document_approve_drafts(
    v_invoice, '2026-09-21', NULL,
    jsonb_build_array(
      jsonb_build_object('line_number', 1, 'disposition', 'inventory', 'product_id', v_product),
      jsonb_build_object('line_number', 2, 'disposition', 'non_inventory', 'product_id', NULL)
    )
  );
  EXECUTE 'RESET ROLE';

  IF v_snapshot->>'status' <> 'approved'
     OR (SELECT count(*) FROM public.purchase_orders WHERE org_id = v_org) <> 1
     OR (SELECT count(*) FROM public.purchase_order_items WHERE org_id = v_org) <> 2
     OR (SELECT count(*) FROM public.purchase_order_items WHERE org_id = v_org AND product_id IS NULL) <> 1
     OR (SELECT count(*) FROM public.supplier_debts WHERE org_id = v_org) <> 1
     OR EXISTS (SELECT 1 FROM public.purchase_orders WHERE org_id = v_org AND status <> 'confirmed')
     OR EXISTS (SELECT 1 FROM public.purchase_order_items WHERE org_id = v_org AND quantity_received <> 0)
     OR EXISTS (SELECT 1 FROM public.purchases WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.stock_movements WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.ledger_entries WHERE org_id = v_org)
     OR (SELECT stock FROM public.products WHERE id = v_product) <> v_stock_before THEN
    RAISE EXCEPTION 'La aprobación no fue idempotente o movió stock/ledger: %', v_snapshot;
  END IF;

  PERFORM set_config('app.finance_document_retention_cleanup', 'on', true);
  DELETE FROM public.organizations WHERE id = v_org;
  PERFORM set_config('app.finance_document_retention_cleanup', 'off', true);
  IF EXISTS (SELECT 1 FROM public.finance_supplier_invoice_drafts WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.finance_purchase_drafts WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.finance_purchase_draft_lines WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.finance_payable_drafts WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.purchase_orders WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.supplier_debts WHERE org_id = v_org)
     OR EXISTS (SELECT 1 FROM public.products WHERE org_id = v_org) THEN
    RAISE EXCEPTION 'Finance drafts dejó restos ZZ';
  END IF;
  RAISE NOTICE 'Finance drafts verificado: segregación, idempotencia, Core aprobado, stock quieto y restos 0';
END;
$fixture$;

INSERT INTO supabase_migrations.schema_migrations(version, name)
VALUES ('20260822000013', 'finance_document_drafts')
ON CONFLICT DO NOTHING;
