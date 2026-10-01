ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS fiscal_tax_rate numeric;
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS tax_rate numeric,
  ADD COLUMN IF NOT EXISTS tax_amount numeric;
ALTER TABLE public.invoice_items DROP CONSTRAINT IF EXISTS invoice_items_tax_snapshot_check;
ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_tax_snapshot_check CHECK (
  (tax_rate IS NULL AND tax_amount IS NULL) OR
  (tax_rate IS NOT NULL AND tax_amount IS NOT NULL
    AND tax_rate IN (0, 2.5, 5, 10.5, 21, 27) AND tax_amount >= 0)
);
COMMENT ON COLUMN public.sales.fiscal_tax_rate IS
  'Server-side VAT rate at sale creation. NULL on legacy rows; never backfilled from current product configuration.';
COMMENT ON COLUMN public.invoice_items.total IS
  'Net line amount on newly generated invoices. Legacy POS rows may contain gross amounts; do not silently rewrite issued documents.';

CREATE OR REPLACE FUNCTION public.snapshot_sale_tax_rate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.fiscal_tax_rate IS DISTINCT FROM OLD.fiscal_tax_rate THEN
      RAISE EXCEPTION 'La alicuota registrada de la venta no se puede modificar';
    END IF;
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN RAISE EXCEPTION 'La venta no puede cambiar de organizacion'; END IF;
    IF NEW.product_id IS NOT DISTINCT FROM OLD.product_id THEN RETURN NEW; END IF;
    IF OLD.invoice_id IS NOT NULL THEN RAISE EXCEPTION 'Una venta facturada no puede cambiar de producto'; END IF;
  END IF;
  SELECT COALESCE(p.tax_rate, s.tax_iva_percent) INTO NEW.fiscal_tax_rate
  FROM public.settings s LEFT JOIN public.products p
    ON p.id = NEW.product_id AND p.org_id = NEW.org_id
  WHERE s.org_id = NEW.org_id LIMIT 1;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_snapshot_sale_tax_rate ON public.sales;
CREATE TRIGGER trg_snapshot_sale_tax_rate BEFORE INSERT OR UPDATE OF fiscal_tax_rate, product_id, org_id ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.snapshot_sale_tax_rate();
REVOKE ALL ON FUNCTION public.snapshot_sale_tax_rate() FROM PUBLIC, anon, authenticated;

-- The parent lock serializes edits against ARCA's authorization reservation.
CREATE OR REPLACE FUNCTION public.guard_fiscal_invoice_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_invoice public.invoices%ROWTYPE;
BEGIN
  FOR v_invoice IN
    SELECT * FROM public.invoices
    WHERE id IN (
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.invoice_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.invoice_id END
    ) ORDER BY id FOR UPDATE
  LOOP
    IF v_invoice.cae IS NOT NULL OR v_invoice.afip_status = 'processing' THEN
      RAISE EXCEPTION 'Los renglones de un comprobante emitido o en autorizacion no se pueden modificar'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_fiscal_invoice_items ON public.invoice_items;
CREATE TRIGGER trg_guard_fiscal_invoice_items BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.guard_fiscal_invoice_items();
REVOKE ALL ON FUNCTION public.guard_fiscal_invoice_items() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.invoice_iva_groups(p_invoice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_count integer;
  v_detailed integer;
  v_groups jsonb;
  v_net numeric;
  v_vat numeric;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factura no encontrada'; END IF;
  IF round(v_invoice.subtotal + v_invoice.tax_amount, 2) <> round(v_invoice.total, 2) THEN
    RAISE EXCEPTION 'El neto y el IVA no coinciden con el total';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE tax_rate IS NOT NULL AND tax_amount IS NOT NULL)
    INTO v_count, v_detailed FROM public.invoice_items WHERE invoice_id = p_invoice_id;
  IF v_count = 0 THEN RAISE EXCEPTION 'El comprobante no tiene renglones'; END IF;
  IF v_detailed > 0 THEN
    IF v_detailed <> v_count THEN RAISE EXCEPTION 'El desglose de IVA esta incompleto'; END IF;
    IF EXISTS (SELECT 1 FROM public.invoice_items WHERE invoice_id = p_invoice_id
      AND (total < 0 OR (tax_rate = 0 AND tax_amount <> 0) OR
        (v_invoice.tipo_comprobante NOT IN (3, 8, 13) AND abs(tax_amount - round(total * tax_rate / 100, 2)) > 0.01))) THEN
      RAISE EXCEPTION 'El IVA de un renglon no corresponde a su alicuota';
    END IF;
    SELECT sum(total), sum(tax_amount) INTO v_net, v_vat FROM public.invoice_items WHERE invoice_id = p_invoice_id;
    IF round(v_net, 2) <> round(v_invoice.subtotal, 2) OR round(v_vat, 2) <> round(v_invoice.tax_amount, 2) THEN
      RAISE EXCEPTION 'Los renglones no coinciden con la cabecera fiscal';
    END IF;
    SELECT jsonb_agg(jsonb_build_object('rate', rate, 'base', base, 'amount', amount) ORDER BY rate)
    INTO v_groups FROM (
      SELECT tax_rate AS rate, round(sum(total), 2) AS base, round(sum(tax_amount), 2) AS amount
      FROM public.invoice_items WHERE invoice_id = p_invoice_id GROUP BY tax_rate
    ) groups;
  ELSE
    IF v_invoice.tax_pct NOT IN (0, 2.5, 5, 10.5, 21, 27) OR
      (v_invoice.tax_pct = 0 AND v_invoice.tax_amount <> 0) OR
      (v_invoice.tipo_comprobante NOT IN (3, 8, 13) AND
        abs(v_invoice.tax_amount - round(v_invoice.subtotal * v_invoice.tax_pct / 100, 2)) > 0.01) THEN
      RAISE EXCEPTION 'La alicuota no coincide con el IVA del comprobante';
    END IF;
    v_groups := jsonb_build_array(jsonb_build_object('rate', v_invoice.tax_pct,
      'base', v_invoice.subtotal, 'amount', v_invoice.tax_amount));
  END IF;
  IF v_invoice.tipo_comprobante IN (11, 12, 13) AND
    (v_invoice.tax_pct <> 0 OR v_invoice.tax_amount <> 0 OR
      EXISTS (SELECT 1 FROM jsonb_array_elements(v_groups) g WHERE (g->>'rate')::numeric <> 0)) THEN
    RAISE EXCEPTION 'Los comprobantes C no discriminan IVA';
  END IF;
  RETURN v_groups;
END;
$$;
REVOKE ALL ON FUNCTION public.invoice_iva_groups(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoice_iva_groups(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.facturar_venta_pos(p_org uuid, p_transaction_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tx public.sale_transactions%ROWTYPE;
  v_existing public.invoices%ROWTYPE;
  v_emisor text;
  v_cbte jsonb;
  v_class_c boolean;
  v_default_rate numeric;
  v_total numeric;
  v_net numeric := 0;
  v_vat numeric := 0;
  v_rate numeric;
  v_single_rate numeric;
  v_lines jsonb := '[]'::jsonb;
  v_line record;
  v_split jsonb;
  v_id uuid;
  v_number text;
  v_sale uuid;
  v_customer text;
BEGIN
  IF v_user IS NULL OR NOT public.is_org_member(p_org, v_user) THEN
    RAISE EXCEPTION 'No sos miembro de esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'invoices', 'edit', 'facturar un ticket del POS');
  SELECT * INTO v_tx FROM public.sale_transactions
  WHERE id = p_transaction_id AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'motivo', 'El ticket no existe en este comercio'); END IF;
  SELECT i.* INTO v_existing FROM public.invoices i WHERE i.org_id = p_org
    AND (i.sale_transaction_id = p_transaction_id OR i.sale_id IN (
      SELECT id FROM public.sales WHERE sale_transaction_id = p_transaction_id AND org_id = p_org
    )) ORDER BY i.created_at LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'invoice_id', v_existing.id, 'number', v_existing.number,
      'tipo', CASE v_existing.tipo_comprobante WHEN 1 THEN 'A' WHEN 6 THEN 'B' WHEN 11 THEN 'C' END,
      'already', true, 'autorizar', v_existing.cae IS NULL);
  END IF;
  PERFORM 1 FROM public.sales WHERE sale_transaction_id = p_transaction_id AND org_id = p_org FOR UPDATE;
  SELECT round(sum(total_ars), 2), (array_agg(id ORDER BY created_at, id))[1],
    (array_agg(customer_name ORDER BY created_at, id))[1] INTO v_total, v_sale, v_customer
  FROM public.sales WHERE sale_transaction_id = p_transaction_id AND org_id = p_org;
  IF COALESCE(v_total, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'motivo', 'El ticket es de importe cero'); END IF;
  SELECT COALESCE(a.tipo_emisor, s.afip_tipo_emisor), s.tax_iva_percent INTO v_emisor, v_default_rate
  FROM public.settings s LEFT JOIN public.afip_credentials a ON a.org_id = s.org_id WHERE s.org_id = p_org LIMIT 1;
  IF v_emisor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'Falta declarar la condicion frente al IVA del emisor');
  END IF;
  v_cbte := public.tipo_de_comprobante(v_emisor, 'consumidor_final');
  v_class_c := v_cbte->>'letra' = 'C';
  FOR v_line IN SELECT s.*, p.tax_rate AS product_rate FROM public.sales s
    LEFT JOIN public.products p ON p.id = s.product_id AND p.org_id = p_org
    WHERE s.sale_transaction_id = p_transaction_id AND s.org_id = p_org ORDER BY s.created_at, s.id
  LOOP
    IF v_line.quantity <= 0 OR v_line.total_ars < 0 THEN RAISE EXCEPTION 'El ticket tiene renglones invalidos'; END IF;
    v_rate := CASE WHEN v_class_c THEN 0 ELSE COALESCE(v_line.fiscal_tax_rate, v_line.product_rate, v_default_rate) END;
    IF v_rate IS NULL OR v_rate NOT IN (0, 2.5, 5, 10.5, 21, 27) THEN
      RAISE EXCEPTION 'El producto no tiene una alicuota de IVA admitida por ARCA';
    END IF;
    -- total_ars is already the final charged price, irrespective of list-price settings.
    v_split := public.desglosar_iva(v_line.total_ars, v_rate, true);
    v_net := v_net + (v_split->>'neto')::numeric;
    v_vat := v_vat + (v_split->>'iva')::numeric;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('description', v_line.product_name,
      'quantity', v_line.quantity, 'total', (v_split->>'neto')::numeric,
      'tax_rate', v_rate, 'tax_amount', (v_split->>'iva')::numeric));
  END LOOP;
  SELECT CASE WHEN count(DISTINCT (line->>'tax_rate')::numeric) = 1 THEN min((line->>'tax_rate')::numeric) ELSE 0 END
  INTO v_single_rate FROM jsonb_array_elements(v_lines) line;
  v_number := public.siguiente_numero_factura(p_org);
  INSERT INTO public.invoices (org_id, number, sale_id, sale_transaction_id, customer_name,
    issue_date, due_date, status, currency, subtotal, tax_pct, tax_amount, total,
    tipo_comprobante, condicion_iva_receptor, afip_status, notes, created_by)
  VALUES (p_org, v_number, v_sale, p_transaction_id, COALESCE(NULLIF(btrim(v_customer), ''), 'Consumidor final'),
    CURRENT_DATE, CURRENT_DATE, 'draft', 'ARS', v_net, v_single_rate, v_vat, v_total,
    (v_cbte->>'codigo_afip')::integer, public.condicion_iva_codigo('consumidor_final'),
    'pending', 'Generada desde el POS', v_user) RETURNING id INTO v_id;
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, tax_rate, tax_amount)
  SELECT v_id, line->>'description', (line->>'quantity')::numeric,
    (line->>'total')::numeric / (line->>'quantity')::numeric,
    (line->>'total')::numeric, (line->>'tax_rate')::numeric, (line->>'tax_amount')::numeric
  FROM jsonb_array_elements(v_lines) line;
  PERFORM public.invoice_iva_groups(v_id);
  UPDATE public.sales SET invoice_id = v_id WHERE sale_transaction_id = p_transaction_id AND org_id = p_org;
  PERFORM public.emitir_evento(p_org, 'factura', v_id, 'factura.creada',
    jsonb_build_object('invoice_id', v_id, 'sale_transaction_id', p_transaction_id,
      'numero', v_number, 'tipo', v_cbte->>'letra', 'total', v_total));
  RETURN jsonb_build_object('ok', true, 'invoice_id', v_id, 'number', v_number,
    'tipo', v_cbte->>'letra', 'already', false, 'autorizar', true);
END;
$$;
REVOKE ALL ON FUNCTION public.facturar_venta_pos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facturar_venta_pos(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_processing_invoice_values()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.cae IS NOT NULL OR OLD.afip_status = 'processing' THEN
      RAISE EXCEPTION 'Un comprobante emitido o en autorizacion no se puede eliminar'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF (OLD.afip_status = 'processing' OR OLD.cae IS NOT NULL) AND (
    NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.total IS DISTINCT FROM OLD.total OR
    NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount OR
    NEW.tax_pct IS DISTINCT FROM OLD.tax_pct OR NEW.currency IS DISTINCT FROM OLD.currency OR
    NEW.issue_date IS DISTINCT FROM OLD.issue_date OR NEW.tipo_comprobante IS DISTINCT FROM OLD.tipo_comprobante OR
    NEW.customer_tax_id IS DISTINCT FROM OLD.customer_tax_id OR NEW.customer_name IS DISTINCT FROM OLD.customer_name OR
    NEW.condicion_iva_receptor IS DISTINCT FROM OLD.condicion_iva_receptor OR
    NEW.nota_credito_de IS DISTINCT FROM OLD.nota_credito_de
  ) THEN
    RAISE EXCEPTION 'El comprobante esta en autorizacion; sus valores fiscales no se pueden modificar'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_processing_invoice_values ON public.invoices;
CREATE TRIGGER trg_guard_processing_invoice_values BEFORE UPDATE OR DELETE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.guard_processing_invoice_values();
REVOKE ALL ON FUNCTION public.guard_processing_invoice_values() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.emitir_nota_credito(p_invoice_id uuid, p_motivo text, p_importe numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_original public.invoices%ROWTYPE;
  v_type integer;
  v_previous record;
  v_groups jsonb;
  v_group jsonb;
  v_previous_group jsonb;
  v_credit_lines jsonb := '[]'::jsonb;
  v_weights numeric[] := '{}';
  v_allocated numeric[];
  v_amount numeric;
  v_available numeric;
  v_net numeric := 0;
  v_vat numeric := 0;
  v_line_net numeric;
  v_line_vat numeric;
  v_group_gross numeric;
  v_rate numeric;
  v_single_rate numeric;
  v_index integer := 0;
  v_id uuid;
  v_number text;
BEGIN
  SELECT * INTO v_original FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La factura no existe'; END IF;
  IF auth.uid() IS NULL OR NOT public.is_org_member(v_original.org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(v_original.org_id, 'invoices', 'edit', 'emitir notas de credito');
  IF NULLIF(btrim(v_original.cae), '') IS NULL OR v_original.afip_status <> 'authorized' THEN
    RAISE EXCEPTION 'Solo se puede emitir una nota de credito sobre una factura autorizada por ARCA';
  END IF;
  IF COALESCE(btrim(p_motivo), '') = '' OR length(btrim(p_motivo)) > 500 THEN
    RAISE EXCEPTION 'La nota de credito necesita un motivo de hasta 500 caracteres';
  END IF;
  v_type := public.tipo_nota_credito(v_original.tipo_comprobante);
  IF v_original.nota_credito_de IS NOT NULL OR v_type IS NULL THEN
    RAISE EXCEPTION 'El comprobante no admite una nota de credito';
  END IF;
  v_groups := public.invoice_iva_groups(p_invoice_id);
  -- Previous drafts reserve both money and VAT capacity until explicitly removed.
  FOR v_previous IN SELECT id FROM public.invoices WHERE nota_credito_de = p_invoice_id
  LOOP
    FOR v_previous_group IN SELECT * FROM jsonb_array_elements(public.invoice_iva_groups(v_previous.id))
    LOOP
      SELECT jsonb_agg(CASE WHEN (g->>'rate')::numeric = (v_previous_group->>'rate')::numeric
        THEN g || jsonb_build_object('base', (g->>'base')::numeric - (v_previous_group->>'base')::numeric,
          'amount', (g->>'amount')::numeric - (v_previous_group->>'amount')::numeric)
        ELSE g END ORDER BY (g->>'rate')::numeric) INTO v_groups
      FROM jsonb_array_elements(v_groups) g;
    END LOOP;
  END LOOP;
  FOR v_group IN SELECT * FROM jsonb_array_elements(v_groups)
  LOOP
    IF (v_group->>'base')::numeric < 0 OR (v_group->>'amount')::numeric < 0 THEN
      RAISE EXCEPTION 'Las notas anteriores exceden el desglose fiscal de la factura';
    END IF;
    v_weights := array_append(v_weights, (v_group->>'base')::numeric + (v_group->>'amount')::numeric);
  END LOOP;
  SELECT sum(weight) INTO v_available FROM unnest(v_weights) weight;
  v_amount := public.redondear_moneda(COALESCE(p_importe, v_available), v_original.currency);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'La factura ya esta acreditada por completo'; END IF;
  IF v_amount > v_available THEN RAISE EXCEPTION 'El importe supera el saldo disponible de la factura'; END IF;
  v_allocated := public.prorratear(v_amount, v_weights, v_original.currency);
  FOR v_group IN SELECT * FROM jsonb_array_elements(v_groups)
  LOOP
    v_index := v_index + 1;
    IF v_allocated[v_index] <= 0 THEN CONTINUE; END IF;
    v_rate := (v_group->>'rate')::numeric;
    v_group_gross := v_weights[v_index];
    v_line_vat := CASE WHEN v_allocated[v_index] = v_group_gross THEN (v_group->>'amount')::numeric
      ELSE round((v_group->>'amount')::numeric * v_allocated[v_index] / v_group_gross, 2) END;
    v_line_net := v_allocated[v_index] - v_line_vat;
    v_net := v_net + v_line_net;
    v_vat := v_vat + v_line_vat;
    v_credit_lines := v_credit_lines || jsonb_build_array(jsonb_build_object('tax_rate', v_rate,
      'total', v_line_net, 'tax_amount', v_line_vat));
  END LOOP;
  SELECT CASE WHEN count(DISTINCT (line->>'tax_rate')::numeric) = 1 THEN min((line->>'tax_rate')::numeric) ELSE 0 END
  INTO v_single_rate FROM jsonb_array_elements(v_credit_lines) line;
  v_number := public.siguiente_numero_factura(v_original.org_id);
  INSERT INTO public.invoices (org_id, number, nota_credito_de, motivo_nota_credito, customer_name, customer_email,
    customer_tax_id, customer_address, issue_date, due_date, status, currency, subtotal, tax_pct, tax_amount,
    total, tipo_comprobante, condicion_iva_receptor, afip_status, notes, created_by)
  VALUES (v_original.org_id, v_number, p_invoice_id, btrim(p_motivo), v_original.customer_name, v_original.customer_email,
    v_original.customer_tax_id, v_original.customer_address, CURRENT_DATE, CURRENT_DATE, 'draft', v_original.currency,
    v_net, v_single_rate, v_vat, v_amount, v_type, v_original.condicion_iva_receptor, 'pending',
    'Nota de credito de ' || v_original.number || ': ' || btrim(p_motivo), auth.uid()) RETURNING id INTO v_id;
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, tax_rate, tax_amount)
  SELECT v_id, 'Credito sobre ' || v_original.number || ': ' || btrim(p_motivo), 1,
    (line->>'total')::numeric, (line->>'total')::numeric,
    (line->>'tax_rate')::numeric, (line->>'tax_amount')::numeric FROM jsonb_array_elements(v_credit_lines) line;
  PERFORM public.invoice_iva_groups(v_id);
  PERFORM public.emitir_evento(v_original.org_id, 'factura', v_id, 'nota_credito.creada',
    jsonb_build_object('invoice_id', v_id, 'corrige_a', p_invoice_id, 'numero', v_number,
      'tipo', v_type, 'importe', v_amount, 'motivo', btrim(p_motivo)));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.emitir_nota_credito(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emitir_nota_credito(uuid, text, numeric) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
