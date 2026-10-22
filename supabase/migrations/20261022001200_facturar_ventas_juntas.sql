-- Facturar varias ventas juntas: la factura mensual del mayorista.
--
-- Un cliente que retira varias veces en el mes (cada venta con sus remitos)
-- recibe una sola factura. Hasta acá cada venta se facturaba sola.
--
--   1. `facturar_ventas_juntas(org, ventas[])`: las ventas tienen que ser del
--      mismo cliente registrado, ninguna facturada ni emitida en el
--      controlador fiscal. Arma los renglones y el IVA igual que la factura
--      de un ticket (`facturar_venta_pos`), deja cada venta apuntando a la
--      factura (`sales.invoice_id`) y emite `factura.creada`: el outbox la
--      autoriza sola.
--   2. `facturar_venta_pos` reconoce esa factura: antes sólo miraba la
--      cabecera y una venta facturada en grupo podía facturarse de nuevo.
-- Reversible: volver a la definición de 20261009000500; DROP FUNCTION de la nueva.
BEGIN;

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
    ) OR i.id IN (
      -- Una factura de varias ventas (facturar_ventas_juntas) no lleva el
      -- ticket en la cabecera: la venta la apunta con invoice_id.
      SELECT invoice_id FROM public.sales WHERE sale_transaction_id = p_transaction_id AND org_id = p_org AND invoice_id IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.facturar_ventas_juntas(p_org uuid, p_transacciones uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fj$
DECLARE
  v_user uuid := auth.uid();
  v_tx uuid;
  v_customer_id uuid;
  v_otro uuid;
  v_client public.customers%ROWTYPE;
  v_cond text;
  v_tax_id text;
  v_doc_type integer;
  v_customer text;
  v_address text;
  v_email text;
  v_emisor text;
  v_default_rate numeric;
  v_cbte jsonb;
  v_class_c boolean;
  v_line record;
  v_rate numeric;
  v_split jsonb;
  v_net numeric := 0;
  v_vat numeric := 0;
  v_total numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_single_rate numeric;
  v_number text;
  v_id uuid;
  v_n integer;
BEGIN
  IF v_user IS NULL OR NOT public.is_org_member(p_org, v_user) THEN
    RAISE EXCEPTION 'No sos miembro de esta organizacion' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'invoices', 'edit', 'facturar ventas');
  SELECT count(DISTINCT t) INTO v_n FROM unnest(p_transacciones) t WHERE t IS NOT NULL;
  IF v_n < 2 OR v_n <> cardinality(p_transacciones) THEN
    RAISE EXCEPTION 'Elegi al menos dos ventas distintas para facturar juntas' USING ERRCODE = '22023';
  END IF;
  IF v_n > 50 THEN RAISE EXCEPTION 'Se pueden facturar hasta 50 ventas juntas' USING ERRCODE = '22023'; END IF;

  -- Se bloquean en orden fijo: dos personas facturando grupos que se pisan no
  -- se traban entre sí ni facturan dos veces la misma venta.
  FOR v_tx IN SELECT t FROM unnest(p_transacciones) t ORDER BY t LOOP
    PERFORM 1 FROM public.sale_transactions WHERE id = v_tx AND org_id = p_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Una de las ventas no existe en este comercio' USING ERRCODE = '22023'; END IF;
    PERFORM 1 FROM public.sales WHERE sale_transaction_id = v_tx AND org_id = p_org FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.sales WHERE sale_transaction_id = v_tx AND org_id = p_org AND invoice_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.org_id = p_org AND (i.sale_transaction_id = v_tx
            OR i.sale_id IN (SELECT id FROM public.sales WHERE sale_transaction_id = v_tx AND org_id = p_org))) THEN
      RAISE EXCEPTION 'Una de las ventas ya esta facturada' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.fiscal_controller_documents d WHERE d.org_id = p_org AND d.sale_transaction_id = v_tx) THEN
      RAISE EXCEPTION 'Una de las ventas ya se emitio en el controlador fiscal' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sales WHERE sale_transaction_id = v_tx AND org_id = p_org) THEN
      RAISE EXCEPTION 'Una de las ventas no tiene renglones' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Un solo cliente registrado: su ficha fiscal decide la clase.
  SELECT min(customer_id::text)::uuid, max(customer_id::text)::uuid INTO v_customer_id, v_otro
    FROM public.sales WHERE sale_transaction_id = ANY(p_transacciones) AND org_id = p_org;
  IF v_customer_id IS NULL OR v_customer_id <> v_otro
     OR EXISTS (SELECT 1 FROM public.sales WHERE sale_transaction_id = ANY(p_transacciones) AND org_id = p_org AND customer_id IS NULL) THEN
    RAISE EXCEPTION 'Para facturar juntas, todas las ventas tienen que ser del mismo cliente registrado' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_client FROM public.customers c WHERE c.id = v_customer_id AND c.org_id = p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'El cliente de las ventas no existe en este comercio' USING ERRCODE = '22023'; END IF;
  v_cond := COALESCE(v_client.vat_condition, 'consumidor_final');
  v_tax_id := v_client.tax_id;
  v_doc_type := CASE v_client.tax_id_type WHEN 'CUIT' THEN 80 WHEN 'DNI' THEN 96 ELSE 99 END;
  v_customer := COALESCE(NULLIF(btrim(v_client.legal_name), ''), NULLIF(btrim(v_client.name), ''), 'Cliente');
  v_address := COALESCE(NULLIF(btrim(v_client.fiscal_address), ''), NULLIF(btrim(v_client.address), ''));
  v_email := NULLIF(btrim(v_client.email), '');

  SELECT COALESCE(a.tipo_emisor, s.afip_tipo_emisor), s.tax_iva_percent INTO v_emisor, v_default_rate
    FROM public.settings s LEFT JOIN public.afip_credentials a ON a.org_id = s.org_id WHERE s.org_id = p_org LIMIT 1;
  IF v_emisor IS NULL THEN
    RAISE EXCEPTION 'Falta declarar la condicion frente al IVA del emisor' USING ERRCODE = '22023';
  END IF;
  v_cbte := public.tipo_de_comprobante(v_emisor, v_cond);
  IF (v_cbte->>'letra' = 'A' OR v_cond <> 'consumidor_final') AND v_doc_type <> 80 THEN
    RAISE EXCEPTION 'El cliente necesita un CUIT valido para esta factura. Completalo en su ficha.' USING ERRCODE = '22023';
  END IF;
  v_class_c := v_cbte->>'letra' = 'C';

  -- Los mismos renglones e IVA que la factura de un ticket.
  FOR v_line IN SELECT s.*, p.tax_rate AS product_rate, t.occurred_at FROM public.sales s
      JOIN public.sale_transactions t ON t.id = s.sale_transaction_id
      LEFT JOIN public.products p ON p.id = s.product_id AND p.org_id = p_org
     WHERE s.sale_transaction_id = ANY(p_transacciones) AND s.org_id = p_org
     ORDER BY t.occurred_at, s.sale_transaction_id, s.created_at, s.id
  LOOP
    IF v_line.quantity <= 0 OR v_line.total_ars < 0 THEN RAISE EXCEPTION 'Una de las ventas tiene renglones invalidos'; END IF;
    v_rate := CASE WHEN v_class_c THEN 0 ELSE COALESCE(v_line.fiscal_tax_rate, v_line.product_rate, v_default_rate) END;
    IF v_rate IS NULL OR v_rate NOT IN (0, 2.5, 5, 10.5, 21, 27) THEN
      RAISE EXCEPTION 'Un producto no tiene una alicuota de IVA admitida por ARCA';
    END IF;
    v_split := public.desglosar_iva(v_line.total_ars, v_rate, true);
    v_net := v_net + (v_split->>'neto')::numeric;
    v_vat := v_vat + (v_split->>'iva')::numeric;
    v_total := v_total + v_line.total_ars;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('description', v_line.product_name,
      'quantity', v_line.quantity, 'total', (v_split->>'neto')::numeric,
      'tax_rate', v_rate, 'tax_amount', (v_split->>'iva')::numeric));
  END LOOP;
  v_total := round(v_total, 2);
  IF v_total <= 0 THEN RAISE EXCEPTION 'Las ventas suman cero' USING ERRCODE = '22023'; END IF;

  SELECT CASE WHEN count(DISTINCT (line->>'tax_rate')::numeric) = 1 THEN min((line->>'tax_rate')::numeric) ELSE 0 END
    INTO v_single_rate FROM jsonb_array_elements(v_lines) line;
  v_number := public.siguiente_numero_factura(p_org);
  INSERT INTO public.invoices (org_id, number, customer_name, customer_tax_id, customer_address, customer_email,
    receptor_tipo_documento, issue_date, due_date, status, currency, subtotal, tax_pct, tax_amount, total,
    tipo_comprobante, condicion_iva_receptor, afip_status, notes, created_by)
  VALUES (p_org, v_number, v_customer, v_tax_id, v_address, v_email, v_doc_type, CURRENT_DATE, CURRENT_DATE,
    'draft', 'ARS', v_net, v_single_rate, v_vat, v_total, (v_cbte->>'codigo_afip')::integer,
    public.condicion_iva_codigo(v_cond), 'pending', 'Factura de ' || v_n || ' ventas', v_user)
  RETURNING id INTO v_id;
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total, tax_rate, tax_amount)
  SELECT v_id, line->>'description', (line->>'quantity')::numeric,
    (line->>'total')::numeric / (line->>'quantity')::numeric,
    (line->>'total')::numeric, (line->>'tax_rate')::numeric, (line->>'tax_amount')::numeric
  FROM jsonb_array_elements(v_lines) line;
  PERFORM public.invoice_iva_groups(v_id);
  UPDATE public.sales SET invoice_id = v_id WHERE sale_transaction_id = ANY(p_transacciones) AND org_id = p_org;
  PERFORM public.emitir_evento(p_org, 'factura', v_id, 'factura.creada',
    jsonb_build_object('invoice_id', v_id, 'sale_transaction_ids', to_jsonb(p_transacciones),
      'numero', v_number, 'tipo', v_cbte->>'letra', 'total', v_total, 'origen', 'ventas_juntas'));
  RETURN jsonb_build_object('ok', true, 'invoice_id', v_id, 'number', v_number, 'tipo', v_cbte->>'letra',
    'ventas', v_n, 'total', v_total);
END;
$fj$;

REVOKE ALL ON FUNCTION public.facturar_venta_pos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facturar_venta_pos(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.facturar_ventas_juntas(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facturar_ventas_juntas(uuid, uuid[]) TO authenticated, service_role;

INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), 'authenticated_delegate',
       'Exige ser miembro con permiso de editar facturas; sólo factura ventas de su negocio, sin facturar y del mismo cliente.',
       md5(pg_get_functiondef(p.oid)), DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'facturar_ventas_juntas'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on, rationale = EXCLUDED.rationale;

UPDATE public.security_function_contracts c
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-10-22'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = c.function_name
   AND pg_get_function_identity_arguments(p.oid) = c.identity_arguments
   AND c.function_name = 'facturar_venta_pos';

COMMIT;
