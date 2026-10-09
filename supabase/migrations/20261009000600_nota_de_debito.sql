-- Nota de Débito asociada a una factura autorizada.
--
-- Suma un importe a una factura ya emitida (intereses, diferencia de precio,
-- gastos). Tipos WSFE: A=2, B=7, C=12, asociados a la factura 1/6/11 por
-- CbtesAsoc. El importe es final (IVA incluido) y se desglosa con
-- `desglosar_iva` a una alícuota admitida; la clase C no discrimina IVA.
-- La autorización usa el mismo outbox/afip-authorize que facturas y NC.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS nota_debito_de uuid REFERENCES public.invoices(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS motivo_nota_debito text;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_nota_debito_tipo;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_nota_debito_tipo
  CHECK (nota_debito_de IS NULL OR (tipo_comprobante IN (2, 7, 12) AND nota_credito_de IS NULL));

CREATE INDEX IF NOT EXISTS invoices_nota_debito_de_idx ON public.invoices (nota_debito_de) WHERE nota_debito_de IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tipo_nota_debito(p_tipo_factura int)
RETURNS int LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE p_tipo_factura WHEN 1 THEN 2 WHEN 6 THEN 7 WHEN 11 THEN 12 END;
$fn$;

CREATE OR REPLACE FUNCTION public.emitir_nota_debito(p_invoice_id uuid, p_motivo text, p_importe numeric, p_tasa numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_original public.invoices%ROWTYPE;
  v_type integer;
  v_rate numeric;
  v_amount numeric;
  v_split jsonb;
  v_net numeric;
  v_vat numeric;
  v_id uuid;
  v_number text;
BEGIN
  SELECT * INTO v_original FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La factura no existe'; END IF;
  IF auth.uid() IS NULL OR NOT public.is_org_member(v_original.org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(v_original.org_id, 'invoices', 'edit', 'emitir notas de debito');
  IF NULLIF(btrim(v_original.cae), '') IS NULL OR v_original.afip_status <> 'authorized' THEN
    RAISE EXCEPTION 'Solo se puede emitir una nota de debito sobre una factura autorizada por ARCA';
  END IF;
  IF COALESCE(btrim(p_motivo), '') = '' OR length(btrim(p_motivo)) > 500 THEN
    RAISE EXCEPTION 'La nota de debito necesita un motivo de hasta 500 caracteres';
  END IF;
  v_type := public.tipo_nota_debito(v_original.tipo_comprobante);
  IF v_type IS NULL OR v_original.nota_credito_de IS NOT NULL OR v_original.nota_debito_de IS NOT NULL THEN
    RAISE EXCEPTION 'El comprobante no admite una nota de debito';
  END IF;
  v_amount := public.redondear_moneda(p_importe, v_original.currency);
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'El importe de la nota de debito debe ser mayor a cero'; END IF;

  -- Clase C no discrimina IVA; A/B usan la alícuota pedida o la única de la factura.
  IF v_type = 12 THEN
    v_rate := 0;
  ELSE
    v_rate := COALESCE(p_tasa, (SELECT CASE WHEN count(DISTINCT (g->>'rate')::numeric) = 1 THEN min((g->>'rate')::numeric) END
      FROM jsonb_array_elements(public.invoice_iva_groups(p_invoice_id)) g));
    IF v_rate IS NULL THEN RAISE EXCEPTION 'La factura tiene varias alícuotas: indicá la de la nota de debito'; END IF;
    IF v_rate NOT IN (0, 2.5, 5, 10.5, 21, 27) THEN RAISE EXCEPTION 'La alícuota no está admitida por ARCA'; END IF;
  END IF;
  v_split := public.desglosar_iva(v_amount, v_rate, true);
  v_net := (v_split->>'neto')::numeric;
  v_vat := (v_split->>'iva')::numeric;

  v_number := public.siguiente_numero_factura(v_original.org_id);
  INSERT INTO public.invoices (org_id, number, nota_debito_de, motivo_nota_debito, customer_name, customer_email,
    customer_tax_id, customer_address, receptor_tipo_documento, issue_date, due_date, status, currency, subtotal, tax_pct, tax_amount,
    total, tipo_comprobante, condicion_iva_receptor, afip_status, notes, created_by)
  VALUES (v_original.org_id, v_number, p_invoice_id, btrim(p_motivo), v_original.customer_name, v_original.customer_email,
    v_original.customer_tax_id, v_original.customer_address, v_original.receptor_tipo_documento, CURRENT_DATE, CURRENT_DATE, 'draft',
    v_original.currency, v_net, v_rate, v_vat, v_amount, v_type, v_original.condicion_iva_receptor, 'pending',
    'Nota de debito de ' || v_original.number || ': ' || btrim(p_motivo), auth.uid()) RETURNING id INTO v_id;
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, tax_rate, tax_amount)
  VALUES (v_id, 'Debito sobre ' || v_original.number || ': ' || btrim(p_motivo), 1, v_net, v_net, v_rate, v_vat);
  PERFORM public.invoice_iva_groups(v_id);
  PERFORM public.emitir_evento(v_original.org_id, 'factura', v_id, 'nota_debito.creada',
    jsonb_build_object('invoice_id', v_id, 'ajusta_a', p_invoice_id, 'numero', v_number,
      'tipo', v_type, 'importe', v_amount, 'motivo', btrim(p_motivo)));
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.emitir_nota_debito(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emitir_nota_debito(uuid, text, numeric, numeric) TO authenticated, service_role;
