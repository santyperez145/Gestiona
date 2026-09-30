-- Una venta existente ya tiene un total cobrado. No puede pasar por el flujo
-- de factura manual (precios netos + IVA) porque eso volveria a sumar IVA.
-- Esta RPC toma producto, cantidad y total de `sales`, y desglosa el impuesto
-- segun la configuracion del comercio sin confiar en importes de la URL.

CREATE OR REPLACE FUNCTION public.facturar_venta_individual(
  p_org uuid,
  p_sale_id uuid,
  p_customer jsonb,
  p_fiscal jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_sale public.sales;
  v_existing public.invoices;
  v_customer_name text;
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
  v_breakdown jsonb;
  v_subtotal numeric;
  v_tax_amount numeric := 0;
  v_total numeric;
  v_number text;
  v_invoice_id uuid;
  v_item_unit numeric;
BEGIN
  IF p_org IS NULL OR p_sale_id IS NULL OR v_user IS NULL
     OR NOT public.is_org_member(p_org, v_user) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org, 'invoices', 'edit', 'facturar una venta');

  PERFORM pg_advisory_xact_lock(hashtextextended('factura:venta:' || p_sale_id::text, 0));
  SELECT * INTO v_sale
    FROM public.sales
   WHERE id = p_sale_id AND org_id = p_org
   FOR UPDATE;
  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'La venta no existe en esta organizacion';
  END IF;

  SELECT * INTO v_existing
    FROM public.invoices
   WHERE org_id = p_org
     AND nota_credito_de IS NULL
     AND (
       id = v_sale.invoice_id
       OR sale_id = p_sale_id
       OR sale_transaction_id = v_sale.sale_transaction_id
       OR ecommerce_order_id = v_sale.ecommerce_order_id
     )
   ORDER BY created_at
   LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'invoice_id', v_existing.id, 'number', v_existing.number,
      'tipo_comprobante', v_existing.tipo_comprobante, 'total', v_existing.total,
      'already', true
    );
  END IF;

  IF v_sale.sale_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta venta pertenece a un ticket POS. Factura el ticket completo desde Ventas';
  END IF;
  IF v_sale.ecommerce_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta venta pertenece a una orden online. Factura la orden completa desde Facturas';
  END IF;

  v_customer_name := COALESCE(
    NULLIF(btrim(p_customer->>'name'), ''),
    NULLIF(btrim(v_sale.customer_name), ''),
    'Consumidor final'
  );
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

  v_total := public.redondear_moneda(v_sale.total_ars, 'ARS');
  IF v_total <= 0 OR v_sale.quantity <= 0 THEN
    RAISE EXCEPTION 'La venta no tiene un importe o cantidad facturable';
  END IF;
  IF v_tax_pct < 0 OR v_tax_pct > 100 THEN
    RAISE EXCEPTION 'La alicuota de IVA debe estar entre 0 y 100';
  END IF;

  IF v_fiscal_enabled THEN
    IF v_receptor NOT IN ('responsable_inscripto', 'monotributo', 'exento', 'consumidor_final') THEN
      RAISE EXCEPTION 'La condicion frente al IVA del receptor no es valida';
    END IF;
    SELECT tipo_emisor INTO v_emisor
      FROM public.afip_credentials WHERE org_id = p_org;
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
  END IF;

  IF v_tipo IN (11, 12, 13) OR NOT v_fiscal_enabled THEN
    v_subtotal := v_total;
    v_tax_pct := 0;
    v_tax_amount := 0;
  ELSE
    -- sales.total_ars is the amount recorded for the sale. A later change to
    -- tax_prices_include_iva must not increase the already-recorded charge.
    v_breakdown := public.desglosar_iva(v_total, v_tax_pct, true);
    v_subtotal := (v_breakdown->>'neto')::numeric;
    v_tax_amount := (v_breakdown->>'iva')::numeric;
  END IF;

  v_number := public.siguiente_numero_factura(p_org);
  INSERT INTO public.invoices (
    org_id, number, sale_id, customer_name, customer_email, customer_address,
    customer_tax_id, issue_date, due_date, notes, status, currency,
    subtotal, tax_pct, tax_amount, total, created_by, tipo_comprobante,
    condicion_iva_receptor, afip_status
  ) VALUES (
    p_org, v_number, p_sale_id, v_customer_name, v_customer_email,
    v_customer_address, v_customer_tax_id, CURRENT_DATE, v_due_date, v_notes,
    'draft', 'ARS', v_subtotal, v_tax_pct, v_tax_amount, v_total, v_user,
    v_tipo, v_condicion,
    CASE WHEN v_tipo IS NULL THEN 'not_applicable' ELSE 'pending' END
  ) RETURNING id INTO v_invoice_id;

  v_item_unit := public.redondear_moneda(v_subtotal / v_sale.quantity, 'ARS');
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total)
  VALUES (
    v_invoice_id, COALESCE(NULLIF(btrim(v_sale.product_name), ''), 'Venta'),
    v_sale.quantity, v_item_unit, v_subtotal
  );

  UPDATE public.sales SET invoice_id = v_invoice_id
   WHERE id = p_sale_id AND org_id = p_org;

  IF v_tipo IS NOT NULL THEN
    PERFORM public.emitir_evento(p_org, 'factura', v_invoice_id, 'factura.creada',
      jsonb_build_object(
        'invoice_id', v_invoice_id, 'sale_id', p_sale_id, 'numero', v_number,
        'tipo', v_tipo, 'total', v_total, 'origen', 'venta_individual'));
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'invoice_id', v_invoice_id, 'number', v_number,
    'tipo_comprobante', v_tipo, 'total', v_total, 'already', false
  );
END;
$fn$;

COMMENT ON FUNCTION public.facturar_venta_individual(uuid, uuid, jsonb, jsonb) IS
  'Factura una linea de venta con importe autoritativo y desglose de IVA incluido. Idempotente por sale_id.';
REVOKE ALL ON FUNCTION public.facturar_venta_individual(uuid, uuid, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facturar_venta_individual(uuid, uuid, jsonb, jsonb)
  TO authenticated, service_role;

DO $guard$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.facturar_venta_individual(uuid,uuid,jsonb,jsonb)'::regprocedure)
    INTO v_def;
  IF v_def NOT ILIKE '%desglosar_iva%'
     OR v_def NOT ILIKE '%FROM public.sales%FOR UPDATE%'
     OR v_def NOT ILIKE '%exigir_permiso%'
     OR v_def NOT ILIKE '%invoice_items%' THEN
    RAISE EXCEPTION 'La factura autoritativa de venta individual quedo incompleta';
  END IF;
END;
$guard$;
