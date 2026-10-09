-- Comprobantes emitidos en controladores fiscales (Epson TM-T900FA y otros).
--
-- El navegador habla con el controlador por la red local; la base registra
-- qué ticket se fiscalizó así y evita un segundo comprobante del mismo ticket:
--   reservar  → antes de imprimir; falla si el ticket ya tiene factura ARCA.
--   confirmar → con número/tipo/total que devolvió el equipo.
--   liberar   → si la impresión falló y el comprobante se canceló.
-- `facturar_venta_pos` (copia de 20261009000200 con una guarda) rechaza los
-- tickets reservados o emitidos en controlador.

CREATE TABLE IF NOT EXISTS public.fiscal_controller_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_transaction_id uuid NOT NULL,
  modelo text NOT NULL CHECK (modelo IN ('epson_tm_t900fa')),
  estado text NOT NULL DEFAULT 'reservado' CHECK (estado IN ('reservado', 'emitido')),
  tipo text CHECK (tipo IS NULL OR tipo IN ('A', 'B', 'C', 'M')),
  numero text,
  total numeric(14, 2),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  emitted_at timestamptz,
  UNIQUE (org_id, sale_transaction_id),
  CHECK (estado = 'reservado' OR (tipo IS NOT NULL AND numero IS NOT NULL))
);
ALTER TABLE public.fiscal_controller_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fiscal_controller_documents_read ON public.fiscal_controller_documents;
CREATE POLICY fiscal_controller_documents_read ON public.fiscal_controller_documents
  FOR SELECT TO authenticated USING (public.is_org_member(org_id, auth.uid()));
REVOKE ALL ON public.fiscal_controller_documents FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.fiscal_controller_documents FROM authenticated;
GRANT SELECT ON public.fiscal_controller_documents TO authenticated;

CREATE OR REPLACE FUNCTION public.reservar_comprobante_controlador(p_org uuid, p_transaction_id uuid, p_modelo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_doc public.fiscal_controller_documents%ROWTYPE;
BEGIN
  IF v_user IS NULL OR NOT public.is_org_member(p_org, v_user) THEN
    RAISE EXCEPTION 'No sos miembro de esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'invoices', 'edit', 'emitir en el controlador fiscal');
  PERFORM 1 FROM public.sale_transactions WHERE id = p_transaction_id AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'motivo', 'El ticket no existe en este comercio'); END IF;
  SELECT * INTO v_doc FROM public.fiscal_controller_documents WHERE org_id = p_org AND sale_transaction_id = p_transaction_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', v_doc.estado = 'reservado', 'estado', v_doc.estado, 'tipo', v_doc.tipo, 'numero', v_doc.numero,
      'motivo', CASE WHEN v_doc.estado = 'emitido' THEN 'El ticket ya se emitió en el controlador fiscal' END);
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoices i WHERE i.org_id = p_org AND (i.sale_transaction_id = p_transaction_id
      OR i.sale_id IN (SELECT id FROM public.sales WHERE sale_transaction_id = p_transaction_id AND org_id = p_org))) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'El ticket ya tiene una factura electrónica');
  END IF;
  INSERT INTO public.fiscal_controller_documents (org_id, sale_transaction_id, modelo, created_by)
  VALUES (p_org, p_transaction_id, p_modelo, v_user);
  RETURN jsonb_build_object('ok', true, 'estado', 'reservado');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.confirmar_comprobante_controlador(p_org uuid, p_transaction_id uuid, p_tipo text, p_numero text, p_total numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_user uuid := auth.uid(); v_count integer;
BEGIN
  IF v_user IS NULL OR NOT public.is_org_member(p_org, v_user) THEN
    RAISE EXCEPTION 'No sos miembro de esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'invoices', 'edit', 'emitir en el controlador fiscal');
  IF NULLIF(btrim(p_numero), '') IS NULL OR upper(btrim(COALESCE(p_tipo, ''))) NOT IN ('A', 'B', 'C', 'M') THEN
    RAISE EXCEPTION 'Número o tipo de comprobante inválido';
  END IF;
  UPDATE public.fiscal_controller_documents
  SET estado = 'emitido', tipo = upper(btrim(p_tipo)), numero = btrim(p_numero), total = p_total, emitted_at = now()
  WHERE org_id = p_org AND sale_transaction_id = p_transaction_id AND estado = 'reservado';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 AND NOT EXISTS (SELECT 1 FROM public.fiscal_controller_documents
      WHERE org_id = p_org AND sale_transaction_id = p_transaction_id AND estado = 'emitido' AND numero = btrim(p_numero)) THEN
    RAISE EXCEPTION 'El ticket no estaba reservado para el controlador fiscal';
  END IF;
  IF v_count > 0 THEN
    PERFORM public.emitir_evento(p_org, 'comprobante_controlador', p_transaction_id, 'comprobante_controlador.emitido',
      jsonb_build_object('sale_transaction_id', p_transaction_id, 'tipo', upper(btrim(p_tipo)), 'numero', btrim(p_numero), 'total', p_total));
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.liberar_comprobante_controlador(p_org uuid, p_transaction_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR NOT public.is_org_member(p_org, v_user) THEN
    RAISE EXCEPTION 'No sos miembro de esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'invoices', 'edit', 'emitir en el controlador fiscal');
  -- Sólo una reserva sin número: un comprobante emitido no se borra.
  DELETE FROM public.fiscal_controller_documents
  WHERE org_id = p_org AND sale_transaction_id = p_transaction_id AND estado = 'reservado';
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.reservar_comprobante_controlador(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirmar_comprobante_controlador(uuid, uuid, text, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.liberar_comprobante_controlador(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reservar_comprobante_controlador(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirmar_comprobante_controlador(uuid, uuid, text, text, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.liberar_comprobante_controlador(uuid, uuid) TO authenticated, service_role;

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
  -- Un ticket emitido (o en emisión) en el controlador fiscal ya es un
  -- comprobante: no se le agrega una factura electrónica.
  IF EXISTS (SELECT 1 FROM public.fiscal_controller_documents d WHERE d.org_id = p_org AND d.sale_transaction_id = p_transaction_id) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'Este ticket ya se emitió en el controlador fiscal');
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
