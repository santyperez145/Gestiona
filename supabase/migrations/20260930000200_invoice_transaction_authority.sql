-- Facturacion manual y notas de credito: una sola transaccion autoritativa.
--
-- La UI anterior reservaba el numero, insertaba la cabecera, insertaba los
-- items y vinculaba la venta en llamadas distintas. Dos operadores podian
-- repetir un numero y un fallo intermedio dejaba una factura incompleta.
-- La nota de credito tambien intentaba insertar `invoice_items` como si fuera
-- una columna de `invoices`, por lo que el camino real fallaba en PostgREST.

CREATE OR REPLACE FUNCTION public.crear_factura_manual(
  p_org uuid,
  p_customer jsonb,
  p_items jsonb,
  p_fiscal jsonb DEFAULT '{}'::jsonb,
  p_sale_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_customer_name text := NULLIF(btrim(p_customer->>'name'), '');
  v_customer_email text := NULLIF(btrim(p_customer->>'email'), '');
  v_customer_address text := NULLIF(btrim(p_customer->>'address'), '');
  v_customer_tax_id text := NULLIF(btrim(p_customer->>'tax_id'), '');
  v_customer_tax_digits text;
  v_due_text text := NULLIF(btrim(p_customer->>'due_date'), '');
  v_due_date date;
  v_notes text := NULLIF(btrim(p_customer->>'notes'), '');
  v_fiscal_enabled boolean := COALESCE((p_fiscal->>'enabled')::boolean, false);
  v_receptor text := COALESCE(NULLIF(p_fiscal->>'receiver_condition', ''), 'consumidor_final');
  v_tax_pct numeric := COALESCE(NULLIF(p_fiscal->>'tax_pct', '')::numeric, 0);
  v_emisor text;
  v_cbte jsonb;
  v_tipo integer;
  v_condicion integer := 5;
  v_number text;
  v_invoice_id uuid;
  v_existing public.invoices;
  v_item jsonb;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total numeric := 0;
BEGIN
  IF p_org IS NULL OR v_user IS NULL OR NOT public.is_org_member(p_org, v_user) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'invoices', 'edit', 'crear facturas');

  IF v_customer_name IS NULL THEN
    RAISE EXCEPTION 'El nombre o razon social del cliente es obligatorio';
  END IF;
  IF length(v_customer_name) > 200 THEN
    RAISE EXCEPTION 'El nombre del cliente es demasiado largo';
  END IF;
  IF v_customer_email IS NOT NULL AND v_customer_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'El email del cliente no es valido';
  END IF;
  IF v_due_text IS NOT NULL THEN
    IF v_due_text !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'La fecha de vencimiento no es valida';
    END IF;
    v_due_date := v_due_text::date;
    IF v_due_date < CURRENT_DATE THEN
      RAISE EXCEPTION 'El vencimiento no puede ser anterior a la emision';
    END IF;
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un item a la factura';
  END IF;
  IF jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Una factura manual admite hasta 100 items';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_description := NULLIF(btrim(v_item->>'description'), '');
    IF v_description IS NULL THEN
      RAISE EXCEPTION 'Todos los items necesitan una descripcion';
    END IF;
    IF length(v_description) > 500 THEN
      RAISE EXCEPTION 'La descripcion de un item supera los 500 caracteres';
    END IF;
    IF COALESCE(v_item->>'quantity', '') !~ '^\d+(\.\d+)?$'
       OR COALESCE(v_item->>'unit_price', '') !~ '^\d+(\.\d+)?$' THEN
      RAISE EXCEPTION 'Cantidad y precio deben ser numeros positivos';
    END IF;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    IF v_quantity <= 0 OR v_quantity > 1000000 THEN
      RAISE EXCEPTION 'La cantidad de cada item debe ser mayor que cero';
    END IF;
    IF v_unit_price < 0 OR v_unit_price > 999999999999 THEN
      RAISE EXCEPTION 'El precio unitario esta fuera del rango permitido';
    END IF;
    v_line_total := public.redondear_moneda(v_quantity * v_unit_price, 'ARS');
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_subtotal := public.redondear_moneda(v_subtotal, 'ARS');
  IF v_subtotal <= 0 THEN
    RAISE EXCEPTION 'El total de la factura debe ser mayor que cero';
  END IF;
  IF v_tax_pct < 0 OR v_tax_pct > 100 THEN
    RAISE EXCEPTION 'La alicuota de IVA debe estar entre 0 y 100';
  END IF;

  IF v_fiscal_enabled THEN
    IF v_receptor NOT IN ('responsable_inscripto', 'monotributo', 'exento', 'consumidor_final') THEN
      RAISE EXCEPTION 'La condicion frente al IVA del receptor no es valida';
    END IF;
    SELECT tipo_emisor INTO v_emisor
      FROM public.afip_credentials
     WHERE org_id = p_org;
    IF v_emisor IS NULL THEN
      RAISE EXCEPTION 'Configura la identidad fiscal antes de crear un comprobante ARCA';
    END IF;
    v_cbte := public.tipo_de_comprobante(v_emisor, v_receptor);
    v_tipo := (v_cbte->>'codigo_afip')::integer;
    v_condicion := public.condicion_iva_codigo(v_receptor);

    v_customer_tax_digits := regexp_replace(COALESCE(v_customer_tax_id, ''), '\D', '', 'g');
    IF v_receptor <> 'consumidor_final'
       AND (length(v_customer_tax_digits) <> 11 OR NOT public.cuit_valido(v_customer_tax_digits)) THEN
      RAISE EXCEPTION 'La condicion fiscal elegida requiere un CUIT valido del receptor';
    END IF;

    IF v_tipo IN (11, 12, 13) THEN
      v_tax_pct := 0;
    END IF;
  ELSE
    v_tipo := NULL;
    v_condicion := 5;
  END IF;

  v_tax_amount := public.redondear_moneda(v_subtotal * v_tax_pct / 100, 'ARS');
  v_total := public.redondear_moneda(v_subtotal + v_tax_amount, 'ARS');

  IF p_sale_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('factura:venta:' || p_sale_id::text, 0));
    PERFORM 1 FROM public.sales WHERE id = p_sale_id AND org_id = p_org FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La venta vinculada no existe en esta organizacion';
    END IF;
    SELECT * INTO v_existing
      FROM public.invoices
     WHERE org_id = p_org AND sale_id = p_sale_id
     ORDER BY created_at
     LIMIT 1;
    IF v_existing.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true, 'invoice_id', v_existing.id, 'number', v_existing.number,
        'tipo_comprobante', v_existing.tipo_comprobante, 'total', v_existing.total,
        'already', true
      );
    END IF;
  END IF;

  v_number := public.siguiente_numero_factura(p_org);
  INSERT INTO public.invoices (
    org_id, number, customer_name, customer_email, customer_address,
    customer_tax_id, issue_date, due_date, notes, status, currency,
    subtotal, tax_pct, tax_amount, total, created_by, tipo_comprobante,
    condicion_iva_receptor, afip_status, sale_id
  ) VALUES (
    p_org, v_number, v_customer_name, v_customer_email, v_customer_address,
    v_customer_tax_id, CURRENT_DATE, v_due_date, v_notes, 'draft', 'ARS',
    v_subtotal, v_tax_pct, v_tax_amount, v_total, v_user, v_tipo,
    v_condicion, CASE WHEN v_tipo IS NULL THEN 'not_applicable' ELSE 'pending' END,
    p_sale_id
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total)
    VALUES (
      v_invoice_id, btrim(v_item->>'description'), v_quantity, v_unit_price,
      public.redondear_moneda(v_quantity * v_unit_price, 'ARS')
    );
  END LOOP;

  IF p_sale_id IS NOT NULL THEN
    UPDATE public.sales SET invoice_id = v_invoice_id
     WHERE id = p_sale_id AND org_id = p_org;
  END IF;

  IF v_tipo IS NOT NULL THEN
    PERFORM public.emitir_evento(p_org, 'factura', v_invoice_id, 'factura.creada',
      jsonb_build_object(
        'invoice_id', v_invoice_id, 'numero', v_number,
        'tipo', v_tipo, 'total', v_total, 'origen', 'manual'));
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'invoice_id', v_invoice_id, 'number', v_number,
    'tipo_comprobante', v_tipo, 'total', v_total, 'already', false
  );
END;
$fn$;

COMMENT ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid) IS
  'Crea cabecera, items, numero y vinculo de venta de una factura manual en una sola transaccion. El tipo fiscal se deriva de emisor y receptor.';
REVOKE ALL ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid)
  TO authenticated, service_role;

-- La nota de credito es un documento fiscal positivo que referencia a una
-- factura autorizada. Inventario y reintegro se procesan en Devoluciones; no
-- se simulan cambiando `payment_method` en una venta.
CREATE OR REPLACE FUNCTION public.emitir_nota_credito(
  p_invoice_id uuid,
  p_motivo text,
  p_importe numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_f public.invoices;
  v_tipo_nc integer;
  v_acreditado numeric;
  v_importe numeric;
  v_prop numeric;
  v_neto numeric;
  v_iva numeric;
  v_id uuid;
  v_numero text;
BEGIN
  SELECT * INTO v_f FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_f.id IS NULL THEN
    RAISE EXCEPTION 'La factura no existe';
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_org_member(v_f.org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(v_f.org_id, 'invoices', 'edit', 'emitir notas de credito');

  IF NULLIF(btrim(COALESCE(v_f.cae, '')), '') IS NULL OR v_f.afip_status <> 'authorized' THEN
    RAISE EXCEPTION 'Solo se puede emitir una nota de credito sobre una factura autorizada por ARCA';
  END IF;
  IF COALESCE(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'La nota de credito necesita un motivo';
  END IF;
  IF length(btrim(p_motivo)) > 500 THEN
    RAISE EXCEPTION 'El motivo de la nota de credito es demasiado largo';
  END IF;
  IF v_f.nota_credito_de IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede emitir una nota de credito sobre otra nota de credito';
  END IF;

  v_tipo_nc := public.tipo_nota_credito(v_f.tipo_comprobante);
  IF v_tipo_nc IS NULL THEN
    RAISE EXCEPTION 'El tipo de factura no admite una nota de credito ARCA';
  END IF;

  SELECT COALESCE(SUM(total), 0) INTO v_acreditado
    FROM public.invoices WHERE nota_credito_de = p_invoice_id;
  v_importe := public.redondear_moneda(COALESCE(p_importe, v_f.total - v_acreditado), v_f.currency);
  IF v_importe <= 0 THEN
    RAISE EXCEPTION 'La factura ya esta acreditada por completo';
  END IF;
  IF v_acreditado + v_importe > public.redondear_moneda(v_f.total, v_f.currency) + 0.01 THEN
    RAISE EXCEPTION 'El importe supera el saldo disponible de la factura';
  END IF;

  v_prop := CASE WHEN v_f.total > 0 THEN v_importe / v_f.total ELSE 1 END;
  v_iva := public.redondear_moneda(COALESCE(v_f.tax_amount, 0) * v_prop, v_f.currency);
  v_neto := public.redondear_moneda(v_importe - v_iva, v_f.currency);
  v_numero := public.siguiente_numero_factura(v_f.org_id);

  INSERT INTO public.invoices (
    org_id, number, nota_credito_de, motivo_nota_credito,
    customer_name, customer_email, customer_tax_id, customer_address,
    issue_date, due_date, status, currency, subtotal, tax_pct, tax_amount,
    total, tipo_comprobante, condicion_iva_receptor, afip_status, notes,
    created_by
  ) VALUES (
    v_f.org_id, v_numero, p_invoice_id, btrim(p_motivo),
    v_f.customer_name, v_f.customer_email, v_f.customer_tax_id, v_f.customer_address,
    CURRENT_DATE, CURRENT_DATE, 'draft', v_f.currency, v_neto, v_f.tax_pct,
    v_iva, v_importe, v_tipo_nc, v_f.condicion_iva_receptor, 'pending',
    'Nota de credito de ' || v_f.number || ': ' || btrim(p_motivo), auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total)
  VALUES (
    v_id, 'Credito sobre ' || v_f.number || ': ' || btrim(p_motivo),
    1, v_neto, v_neto
  );

  PERFORM public.emitir_evento(v_f.org_id, 'factura', v_id, 'nota_credito.creada',
    jsonb_build_object(
      'invoice_id', v_id, 'corrige_a', p_invoice_id, 'numero', v_numero,
      'tipo', v_tipo_nc, 'importe', v_importe, 'motivo', btrim(p_motivo)));
  RETURN v_id;
END;
$fn$;

COMMENT ON FUNCTION public.emitir_nota_credito(uuid, text, numeric) IS
  'Emite atomicamente una NC A/B/C sobre una factura autorizada, controla el saldo e inserta su renglon. La devolucion fisica y el reintegro viven en el flujo de Devoluciones.';
REVOKE ALL ON FUNCTION public.emitir_nota_credito(uuid, text, numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emitir_nota_credito(uuid, text, numeric)
  TO authenticated, service_role;

DO $guard$
DECLARE
  v_manual text;
  v_nc text;
BEGIN
  SELECT pg_get_functiondef('public.crear_factura_manual(uuid,jsonb,jsonb,jsonb,uuid)'::regprocedure)
    INTO v_manual;
  SELECT pg_get_functiondef('public.emitir_nota_credito(uuid,text,numeric)'::regprocedure)
    INTO v_nc;
  IF v_manual NOT ILIKE '%siguiente_numero_factura%'
     OR v_manual NOT ILIKE '%invoice_items%'
     OR v_manual NOT ILIKE '%exigir_permiso%'
     OR v_nc NOT ILIKE '%afip_status%authorized%'
     OR v_nc NOT ILIKE '%invoice_items%' THEN
    RAISE EXCEPTION 'La autoridad transaccional de facturacion quedo incompleta';
  END IF;
END;
$guard$;
