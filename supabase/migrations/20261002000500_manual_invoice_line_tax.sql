-- Facturas manuales: IVA por renglon, calculado y persistido por la base.
-- La UI envia precio neto, cantidad y una tasa admitida. El servidor vuelve a
-- calcular neto/IVA/total; nunca confia en totales enviados por el navegador.

CREATE OR REPLACE FUNCTION public.crear_factura_manual(
  p_org uuid,
  p_customer jsonb,
  p_items jsonb,
  p_fiscal jsonb DEFAULT '{}'::jsonb,
  p_sale_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_customer_name text;
  v_customer_email text;
  v_customer_address text;
  v_customer_tax_id text;
  v_customer_tax_digits text;
  v_due_text text;
  v_due_date date;
  v_notes text;
  v_fiscal_enabled boolean;
  v_receptor text;
  v_default_tax_pct numeric;
  v_emisor text;
  v_cbte jsonb;
  v_tipo integer;
  v_condicion integer := 5;
  v_number text;
  v_invoice_id uuid;
  v_item jsonb;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_line_tax_rate numeric;
  v_line_tax_amount numeric;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total numeric := 0;
  v_rate_count integer := 0;
  v_header_tax_pct numeric := 0;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  IF p_org IS NULL OR v_user IS NULL OR NOT public.is_org_member(p_org, v_user) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'invoices', 'edit', 'crear facturas');

  IF p_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'Factura la venta desde su flujo de origen';
  END IF;
  IF jsonb_typeof(COALESCE(p_customer, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_fiscal, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Los datos de la factura no son validos';
  END IF;

  v_customer_name := NULLIF(btrim(p_customer->>'name'), '');
  v_customer_email := NULLIF(btrim(p_customer->>'email'), '');
  v_customer_address := NULLIF(btrim(p_customer->>'address'), '');
  v_customer_tax_id := NULLIF(btrim(p_customer->>'tax_id'), '');
  v_due_text := NULLIF(btrim(p_customer->>'due_date'), '');
  v_notes := NULLIF(btrim(p_customer->>'notes'), '');
  v_fiscal_enabled := COALESCE((p_fiscal->>'enabled')::boolean, false);
  v_receptor := COALESCE(NULLIF(p_fiscal->>'receiver_condition', ''), 'consumidor_final');
  v_default_tax_pct := COALESCE(NULLIF(p_fiscal->>'tax_pct', '')::numeric, 0);

  IF v_customer_name IS NULL THEN
    RAISE EXCEPTION 'El nombre o razon social del cliente es obligatorio';
  END IF;
  IF length(v_customer_name) > 200 THEN
    RAISE EXCEPTION 'El nombre del cliente es demasiado largo';
  END IF;
  IF v_customer_email IS NOT NULL
     AND v_customer_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
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
    IF v_tipo NOT IN (11, 12, 13)
       AND v_default_tax_pct NOT IN (0, 2.5, 5, 10.5, 21, 27) THEN
      RAISE EXCEPTION 'La alicuota predeterminada no esta admitida por ARCA';
    END IF;
  ELSE
    v_tipo := NULL;
    v_condicion := 5;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Cada item debe ser un objeto';
    END IF;
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
    IF v_tipo IS NULL THEN
      v_line_tax_rate := NULL;
      v_line_tax_amount := 0;
    ELSIF v_tipo IN (11, 12, 13) THEN
      v_line_tax_rate := 0;
      v_line_tax_amount := 0;
    ELSE
      v_line_tax_rate := COALESCE(NULLIF(v_item->>'tax_rate', '')::numeric, v_default_tax_pct);
      IF v_line_tax_rate NOT IN (0, 2.5, 5, 10.5, 21, 27) THEN
        RAISE EXCEPTION 'Un renglon tiene una alicuota no admitida por ARCA';
      END IF;
      v_line_tax_amount := public.redondear_moneda(v_line_total * v_line_tax_rate / 100, 'ARS');
    END IF;

    v_subtotal := v_subtotal + v_line_total;
    v_tax_amount := v_tax_amount + v_line_tax_amount;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'description', v_description,
      'quantity', v_quantity,
      'unit_price', v_unit_price,
      'total', v_line_total,
      'tax_rate', v_line_tax_rate,
      'tax_amount', CASE WHEN v_line_tax_rate IS NULL THEN NULL ELSE v_line_tax_amount END
    ));
  END LOOP;

  v_subtotal := public.redondear_moneda(v_subtotal, 'ARS');
  v_tax_amount := public.redondear_moneda(v_tax_amount, 'ARS');
  v_total := public.redondear_moneda(v_subtotal + v_tax_amount, 'ARS');
  IF v_subtotal <= 0 OR v_total <= 0 THEN
    RAISE EXCEPTION 'El total de la factura debe ser mayor que cero';
  END IF;

  IF v_tipo IS NOT NULL THEN
    SELECT count(DISTINCT (line->>'tax_rate')::numeric), min((line->>'tax_rate')::numeric)
      INTO v_rate_count, v_header_tax_pct
      FROM jsonb_array_elements(v_lines) line;
    IF v_rate_count <> 1 THEN v_header_tax_pct := 0; END IF;
  ELSE
    v_header_tax_pct := 0;
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
    v_subtotal, v_header_tax_pct, v_tax_amount, v_total, v_user, v_tipo,
    v_condicion, CASE WHEN v_tipo IS NULL THEN 'not_applicable' ELSE 'pending' END,
    NULL
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit_price, total, tax_rate, tax_amount
  )
  SELECT v_invoice_id, line->>'description', (line->>'quantity')::numeric,
    (line->>'unit_price')::numeric, (line->>'total')::numeric,
    NULLIF(line->>'tax_rate', '')::numeric, NULLIF(line->>'tax_amount', '')::numeric
  FROM jsonb_array_elements(v_lines) line;

  IF v_tipo IS NOT NULL THEN
    PERFORM public.invoice_iva_groups(v_invoice_id);
    PERFORM public.emitir_evento(p_org, 'factura', v_invoice_id, 'factura.creada',
      jsonb_build_object(
        'invoice_id', v_invoice_id,
        'numero', v_number,
        'tipo', v_tipo,
        'total', v_total,
        'origen', 'manual',
        'alicuotas', (SELECT jsonb_agg(DISTINCT line->'tax_rate')
          FROM jsonb_array_elements(v_lines) line)
      ));
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'invoice_id', v_invoice_id,
    'number', v_number,
    'tipo_comprobante', v_tipo,
    'total', v_total,
    'already', false
  );
END;
$fn$;

COMMENT ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid) IS
  'Crea una factura manual atomica. Recalcula neto e IVA por renglon, persiste el desglose fiscal y no admite vincular ventas.';
REVOKE ALL ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_factura_manual(uuid, jsonb, jsonb, jsonb, uuid)
  TO authenticated, service_role;

DO $guard$
DECLARE v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.crear_factura_manual(uuid,jsonb,jsonb,jsonb,uuid)'::regprocedure
  ) INTO v_definition;
  IF v_definition NOT ILIKE '%tax_rate%'
     OR v_definition NOT ILIKE '%invoice_iva_groups%'
     OR v_definition NOT ILIKE '%Factura la venta desde su flujo de origen%' THEN
    RAISE EXCEPTION 'La factura manual no conserva la autoridad fiscal por renglon';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public._crear_factura_manual_interna(uuid,jsonb,jsonb,jsonb,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'La implementacion manual anterior sigue expuesta';
  END IF;
END;
$guard$;
