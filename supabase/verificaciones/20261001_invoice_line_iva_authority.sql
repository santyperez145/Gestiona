-- Synthetic organization; no ARCA/provider calls. All data is rolled back.
BEGIN;
CREATE TEMP TABLE zz_invoice_iva_results (scenario text, ok boolean) ON COMMIT DROP;
DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_owner uuid;
  v_viewer uuid;
  v_tx uuid := gen_random_uuid();
  v_product_a uuid := gen_random_uuid();
  v_product_b uuid := gen_random_uuid();
  v_invoice uuid;
  v_first_credit uuid;
  v_second_credit uuid;
  v_result jsonb;
  v_groups jsonb;
  v_count integer;
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  SELECT id INTO v_viewer FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL OR v_viewer IS NULL THEN RAISE EXCEPTION 'Se necesitan dos identidades existentes'; END IF;
  INSERT INTO public.organizations(id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ Invoice VAT verification', 'zz-invoice-vat-' || v_org, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_viewer, 'viewer');
  INSERT INTO public.settings(org_id, user_id, afip_tipo_emisor, tax_iva_percent, tax_prices_include_iva, exchange_rate)
  VALUES (v_org, v_owner, 'responsable_inscripto', 21, false, 1)
  ON CONFLICT (org_id) DO UPDATE SET afip_tipo_emisor = 'responsable_inscripto', tax_iva_percent = 21,
    tax_prices_include_iva = false, exchange_rate = 1;
  INSERT INTO public.afip_credentials(org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio)
  VALUES (v_org, '20123456786', 1, 'homologacion', 'responsable_inscripto', 'ZZ Invoice VAT', 'ZZ Test address');
  INSERT INTO public.products(id, org_id, user_id, name, sale_price_ars, tax_rate, maneja_stock)
  VALUES (v_product_a, v_org, v_owner, 'ZZ VAT 21', 121, 21, false),
    (v_product_b, v_org, v_owner, 'ZZ VAT 10.5', 110.5, 10.5, false);
  INSERT INTO public.sale_transactions(id, org_id, created_by, source) VALUES (v_tx, v_org, v_owner, 'pos');
  PERFORM set_config('gestiona.sale_transaction_id', v_tx::text, true);
  INSERT INTO public.sales(org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars,
    payment_method, paid, source, sale_transaction_id, customer_name)
  VALUES (v_org, v_owner, v_product_a, 'ZZ VAT 21', 1, 121, 121, 'efectivo', true, 'pos', v_tx, 'ZZ Buyer'),
    (v_org, v_owner, v_product_b, 'ZZ VAT 10.5', 1, 110.5, 110.5, 'efectivo', true, 'pos', v_tx, 'ZZ Buyer');
  PERFORM set_config('gestiona.sale_transaction_id', '', true);
  UPDATE public.products SET tax_rate = 27 WHERE id = v_product_a;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_result := public.facturar_venta_pos(v_org, v_tx);
  v_invoice := (v_result->>'invoice_id')::uuid;
  IF NOT COALESCE((v_result->>'ok')::boolean, false) OR v_invoice IS NULL THEN
    RAISE EXCEPTION 'No se creo la factura POS: %', v_result;
  END IF;
  v_result := public.facturar_venta_pos(v_org, v_tx);
  IF (v_result->>'invoice_id')::uuid <> v_invoice OR NOT (v_result->>'already')::boolean THEN
    RAISE EXCEPTION 'El reintento duplico la factura';
  END IF;
  RESET ROLE;
  v_groups := public.invoice_iva_groups(v_invoice);
  INSERT INTO zz_invoice_iva_results SELECT 'charged_total_and_snapshot',
    subtotal = 200 AND tax_amount = 31.5 AND total = 231.5 AND tax_pct = 0
    FROM public.invoices WHERE id = v_invoice;
  INSERT INTO zz_invoice_iva_results VALUES ('separate_rates',
    v_groups = '[{"rate":10.5,"base":100,"amount":10.5},{"rate":21,"base":100,"amount":21}]'::jsonb);
  SELECT count(*) INTO v_count FROM public.invoices WHERE sale_transaction_id = v_tx;
  INSERT INTO zz_invoice_iva_results VALUES ('one_invoice_per_ticket', v_count = 1);

  BEGIN
    UPDATE public.sales SET fiscal_tax_rate = 27 WHERE sale_transaction_id = v_tx;
    RAISE EXCEPTION 'Se pudo sobrescribir la tasa de la venta';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'La alicuota registrada%' THEN RAISE; END IF;
  END;
  INSERT INTO zz_invoice_iva_results VALUES ('sale_rate_immutable', true);

  -- A processing fixture exercises the freeze, not a real authorization.
  UPDATE public.invoices SET afip_status = 'processing' WHERE id = v_invoice;
  BEGIN
    UPDATE public.invoice_items SET description = 'ZZ modified' WHERE invoice_id = v_invoice;
    RAISE EXCEPTION 'Se pudo editar durante la autorizacion';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.invoice_items WHERE invoice_id = v_invoice;
    RAISE EXCEPTION 'Se pudo eliminar durante la autorizacion';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.invoice_items(invoice_id, description, quantity, unit_price, total)
    VALUES (v_invoice, 'ZZ extra', 1, 1, 1);
    RAISE EXCEPTION 'Se pudo agregar durante la autorizacion';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.invoices SET total = total + 1 WHERE id = v_invoice;
    RAISE EXCEPTION 'Se pudo cambiar el total reservado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.invoices WHERE id = v_invoice;
    RAISE EXCEPTION 'Se pudo eliminar la cabecera reservada';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO zz_invoice_iva_results VALUES ('processing_document_frozen', true);

  UPDATE public.invoices SET afip_status = 'authorized', cae = '99999999999999', numero_afip = 999999,
    cae_vencimiento = CURRENT_DATE + 10 WHERE id = v_invoice;
  BEGIN
    UPDATE public.invoice_items SET total = total + 1 WHERE invoice_id = v_invoice;
    RAISE EXCEPTION 'Se pudo modificar una factura emitida';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.invoices WHERE id = v_invoice;
    RAISE EXCEPTION 'Se pudo eliminar una factura emitida';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO zz_invoice_iva_results VALUES ('issued_document_frozen', true);

  SET LOCAL ROLE authenticated;
  v_first_credit := public.emitir_nota_credito(v_invoice, 'ZZ Partial VAT credit', 115.75);
  BEGIN
    PERFORM public.emitir_nota_credito(v_invoice, 'ZZ Excess credit', 116);
    RAISE EXCEPTION 'Se pudo acreditar mas del saldo';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El importe supera%' THEN RAISE; END IF;
  END;
  v_second_credit := public.emitir_nota_credito(v_invoice, 'ZZ Remaining VAT credit', NULL);
  BEGIN
    PERFORM public.emitir_nota_credito(v_invoice, 'ZZ Extra credit', NULL);
    RAISE EXCEPTION 'Se pudo acreditar una factura totalmente acreditada';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'La factura ya esta acreditada%' THEN RAISE; END IF;
  END;
  RESET ROLE;
  INSERT INTO zz_invoice_iva_results SELECT 'credits_close_original',
    sum(subtotal) = 200 AND sum(tax_amount) = 31.5 AND sum(total) = 231.5 AND count(*) = 2
    FROM public.invoices WHERE nota_credito_de = v_invoice;
  INSERT INTO zz_invoice_iva_results VALUES ('credit_rates_preserved',
    public.invoice_iva_groups(v_first_credit) = '[{"rate":10.5,"base":50,"amount":5.25},{"rate":21,"base":50,"amount":10.5}]'::jsonb
    AND public.invoice_iva_groups(v_second_credit) = public.invoice_iva_groups(v_first_credit));
  INSERT INTO zz_invoice_iva_results VALUES ('over_credit_blocked', true);

  DELETE FROM public.invoices WHERE id IN (v_first_credit, v_second_credit);
  SET LOCAL ROLE authenticated;
  v_first_credit := public.emitir_nota_credito(v_invoice, 'ZZ One cent VAT credit', 0.01);
  v_second_credit := public.emitir_nota_credito(v_invoice, 'ZZ Remaining cents VAT credit', NULL);
  RESET ROLE;
  INSERT INTO zz_invoice_iva_results SELECT 'one_cent_credits_close_original',
    sum(subtotal) = 200 AND sum(tax_amount) = 31.5 AND sum(total) = 231.5 AND count(*) = 2
    FROM public.invoices WHERE nota_credito_de = v_invoice;
  INSERT INTO zz_invoice_iva_results SELECT 'one_cent_credit_amount', total = 0.01
    FROM public.invoices WHERE id = v_first_credit;

  UPDATE public.afip_credentials SET tipo_emisor = 'monotributista' WHERE org_id = v_org;
  v_tx := gen_random_uuid();
  PERFORM set_config('gestiona.sale_transaction_id', v_tx::text, true);
  INSERT INTO public.sales(org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars,
    payment_method, paid, source, customer_name)
  VALUES (v_org, v_owner, v_product_a, 'ZZ VAT C', 1, 121, 121, 'efectivo', true, 'pos', 'ZZ Buyer C');
  PERFORM set_config('gestiona.sale_transaction_id', '', true);
  SET LOCAL ROLE authenticated;
  v_result := public.facturar_venta_pos(v_org, v_tx);
  RESET ROLE;
  INSERT INTO zz_invoice_iva_results SELECT 'class_c_no_vat',
    tipo_comprobante = 11 AND subtotal = 121 AND tax_amount = 0 AND tax_pct = 0 AND total = 121
    AND public.invoice_iva_groups(id) = '[{"rate":0,"base":121,"amount":0}]'::jsonb
    FROM public.invoices WHERE id = (v_result->>'invoice_id')::uuid;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.facturar_venta_pos(v_org, v_tx);
    RAISE EXCEPTION 'Viewer pudo facturar';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.emitir_nota_credito(v_invoice, 'ZZ No permission', 1);
    RAISE EXCEPTION 'Viewer pudo acreditar';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.facturar_venta_pos(v_org, v_tx);
    RAISE EXCEPTION 'Un ajeno pudo facturar';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  INSERT INTO zz_invoice_iva_results VALUES ('viewer_and_foreign_tenant_blocked', true);
  IF EXISTS (SELECT 1 FROM zz_invoice_iva_results WHERE ok IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'Fallaron aserciones de IVA';
  END IF;
END;
$$;
SELECT * FROM zz_invoice_iva_results ORDER BY scenario;
ROLLBACK;
