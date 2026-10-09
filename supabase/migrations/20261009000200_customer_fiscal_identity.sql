-- Identidad fiscal de clientes y facturación POS con cliente identificado.
--
-- Clientes guardan tipo/número de documento (CUIT con dígito verificador o
-- DNI), condición frente al IVA, razón social y domicilio fiscal. Quien no es
-- consumidor final se identifica con CUIT.
-- `facturar_venta_pos` es copia de 20261001000100 (equivalente a la base
-- vinculada el 2026-10-09) que, si el ticket tiene cliente de la organización,
-- usa su condición para la clase A/B/C y congela documento, razón social,
-- domicilio y correo en la factura. Sin cliente sigue siendo consumidor final.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS tax_id text,
  ADD COLUMN IF NOT EXISTS tax_id_type text,
  ADD COLUMN IF NOT EXISTS vat_condition text NOT NULL DEFAULT 'consumidor_final',
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS fiscal_address text;

CREATE OR REPLACE FUNCTION public.normalizar_identidad_fiscal_cliente()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  NEW.tax_id := NULLIF(regexp_replace(COALESCE(NEW.tax_id, ''), '[^0-9]', '', 'g'), '');
  NEW.legal_name := NULLIF(btrim(COALESCE(NEW.legal_name, '')), '');
  NEW.fiscal_address := NULLIF(btrim(COALESCE(NEW.fiscal_address, '')), '');
  NEW.vat_condition := COALESCE(NULLIF(btrim(NEW.vat_condition), ''), 'consumidor_final');
  IF NEW.tax_id IS NULL THEN
    NEW.tax_id_type := NULL;
  ELSIF NEW.tax_id_type IS NULL THEN
    NEW.tax_id_type := CASE WHEN length(NEW.tax_id) = 11 THEN 'CUIT' ELSE 'DNI' END;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.normalizar_identidad_fiscal_cliente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS customers_normalizar_identidad_fiscal ON public.customers;
CREATE TRIGGER customers_normalizar_identidad_fiscal
  BEFORE INSERT OR UPDATE OF tax_id, tax_id_type, vat_condition, legal_name, fiscal_address ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.normalizar_identidad_fiscal_cliente();

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_vat_condition_valida;
ALTER TABLE public.customers ADD CONSTRAINT customers_vat_condition_valida
  CHECK (vat_condition IN ('consumidor_final', 'responsable_inscripto', 'monotributo', 'exento'));
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_documento_fiscal_valido;
ALTER TABLE public.customers ADD CONSTRAINT customers_documento_fiscal_valido CHECK (
  (tax_id IS NULL AND tax_id_type IS NULL)
  OR (tax_id_type = 'CUIT' AND public.cuit_valido(tax_id))
  OR (tax_id_type = 'DNI' AND tax_id ~ '^[0-9]{7,8}$')
);
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_condicion_requiere_cuit;
ALTER TABLE public.customers ADD CONSTRAINT customers_condicion_requiere_cuit
  CHECK (vat_condition = 'consumidor_final' OR tax_id_type = 'CUIT');

CREATE INDEX IF NOT EXISTS customers_org_tax_id_idx ON public.customers (org_id, tax_id) WHERE tax_id IS NOT NULL;

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
  v_customer_id uuid;
  v_client public.customers%ROWTYPE;
  v_cond text := 'consumidor_final';
  v_tax_id text;
  v_doc_type integer := 99;
  v_address text;
  v_email text;
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
    (array_agg(customer_name ORDER BY created_at, id))[1],
    (array_agg(customer_id ORDER BY created_at, id) FILTER (WHERE customer_id IS NOT NULL))[1]
    INTO v_total, v_sale, v_customer, v_customer_id
  FROM public.sales WHERE sale_transaction_id = p_transaction_id AND org_id = p_org;
  -- Cliente identificado: su ficha fiscal decide la clase y se congela en la
  -- factura. Un id de otra organización se ignora como consumidor final.
  IF v_customer_id IS NOT NULL THEN
    SELECT * INTO v_client FROM public.customers c WHERE c.id = v_customer_id AND c.org_id = p_org;
    IF FOUND THEN
      v_cond := COALESCE(v_client.vat_condition, 'consumidor_final');
      v_tax_id := v_client.tax_id;
      v_doc_type := CASE v_client.tax_id_type WHEN 'CUIT' THEN 80 WHEN 'DNI' THEN 96 ELSE 99 END;
      v_customer := COALESCE(NULLIF(btrim(v_client.legal_name), ''), NULLIF(btrim(v_client.name), ''), v_customer);
      v_address := COALESCE(NULLIF(btrim(v_client.fiscal_address), ''), NULLIF(btrim(v_client.address), ''));
      v_email := NULLIF(btrim(v_client.email), '');
    END IF;
  END IF;
  IF COALESCE(v_total, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'motivo', 'El ticket es de importe cero'); END IF;
  SELECT COALESCE(a.tipo_emisor, s.afip_tipo_emisor), s.tax_iva_percent INTO v_emisor, v_default_rate
  FROM public.settings s LEFT JOIN public.afip_credentials a ON a.org_id = s.org_id WHERE s.org_id = p_org LIMIT 1;
  IF v_emisor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'Falta declarar la condicion frente al IVA del emisor');
  END IF;
  v_cbte := public.tipo_de_comprobante(v_emisor, v_cond);
  IF (v_cbte->>'letra' = 'A' OR v_cond <> 'consumidor_final') AND v_doc_type <> 80 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'El cliente necesita un CUIT válido para esta factura. Completalo en su ficha.');
  END IF;
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
    customer_tax_id, customer_address, customer_email, receptor_tipo_documento,
    issue_date, due_date, status, currency, subtotal, tax_pct, tax_amount, total,
    tipo_comprobante, condicion_iva_receptor, afip_status, notes, created_by)
  VALUES (p_org, v_number, v_sale, p_transaction_id, COALESCE(NULLIF(btrim(v_customer), ''), 'Consumidor final'),
    v_tax_id, v_address, v_email, v_doc_type,
    CURRENT_DATE, CURRENT_DATE, 'draft', 'ARS', v_net, v_single_rate, v_vat, v_total,
    (v_cbte->>'codigo_afip')::integer, public.condicion_iva_codigo(v_cond),
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
