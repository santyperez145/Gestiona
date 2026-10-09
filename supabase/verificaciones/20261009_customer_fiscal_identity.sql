-- Identidad fiscal de clientes y factura POS con cliente. Datos ZZ; sin ARCA; ROLLBACK.
BEGIN;
DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_owner uuid;
  v_product uuid := gen_random_uuid();
  v_ri uuid; v_cf uuid; v_foreign uuid;
  v_tx_a uuid := gen_random_uuid(); v_tx_b uuid := gen_random_uuid(); v_tx_x uuid := gen_random_uuid(); v_tx_none uuid := gen_random_uuid();
  v_result jsonb;
  v_inv public.invoices%ROWTYPE;
  v_rejected boolean;
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_owner IS NOT NULL, 'Se necesita una identidad existente';
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Customer fiscal', 'zz-customer-fiscal-' || v_org, v_owner),
    (v_other, 'ZZ Customer fiscal other', 'zz-customer-fiscal-' || v_other, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_other, v_owner, 'owner');
  INSERT INTO public.settings(org_id, user_id, afip_tipo_emisor, tax_iva_percent, tax_prices_include_iva, exchange_rate)
  VALUES (v_org, v_owner, 'responsable_inscripto', 21, false, 1)
  ON CONFLICT (org_id) DO UPDATE SET afip_tipo_emisor = 'responsable_inscripto', tax_iva_percent = 21;
  INSERT INTO public.afip_credentials(org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio)
  VALUES (v_org, '20123456786', 1, 'homologacion', 'responsable_inscripto', 'ZZ Emisor', 'ZZ Calle 1');
  INSERT INTO public.products(id, org_id, user_id, name, sale_price_ars, tax_rate, maneja_stock)
  VALUES (v_product, v_org, v_owner, 'ZZ Producto', 121, 21, false);

  -- Normalización y validación del documento.
  INSERT INTO public.customers(org_id, user_id, name, legal_name, tax_id, vat_condition, fiscal_address, email)
  VALUES (v_org, v_owner, 'ZZ Ferretería', '  ZZ Ferretería SA ', '20-12345678-6', 'responsable_inscripto', 'ZZ Av 2', 'zz@example.com')
  RETURNING id INTO v_ri;
  ASSERT (SELECT tax_id = '20123456786' AND tax_id_type = 'CUIT' AND legal_name = 'ZZ Ferretería SA' FROM public.customers WHERE id = v_ri), 'CUIT no normalizado';
  INSERT INTO public.customers(org_id, user_id, name) VALUES (v_org, v_owner, 'ZZ Mostrador') RETURNING id INTO v_cf;
  ASSERT (SELECT vat_condition = 'consumidor_final' AND tax_id IS NULL FROM public.customers WHERE id = v_cf), 'Default distinto de consumidor final';
  v_rejected := false;
  BEGIN INSERT INTO public.customers(org_id, user_id, name, tax_id) VALUES (v_org, v_owner, 'ZZ CUIT malo', '20123456780');
  EXCEPTION WHEN check_violation THEN v_rejected := true; END;
  ASSERT v_rejected, 'CUIT con dígito verificador inválido aceptado';
  v_rejected := false;
  BEGIN INSERT INTO public.customers(org_id, user_id, name, vat_condition, tax_id) VALUES (v_org, v_owner, 'ZZ Mono DNI', 'monotributo', '30111222');
  EXCEPTION WHEN check_violation THEN v_rejected := true; END;
  ASSERT v_rejected, 'Monotributista sin CUIT aceptado';
  INSERT INTO public.customers(org_id, user_id, name, tax_id, vat_condition)
  VALUES (v_other, v_owner, 'ZZ Ajeno', '20123456786', 'responsable_inscripto') RETURNING id INTO v_foreign;

  -- Tickets: cliente RI, cliente CF, cliente de otra organización y sin cliente.
  INSERT INTO public.sale_transactions(id, org_id, created_by, source) VALUES
    (v_tx_a, v_org, v_owner, 'pos'), (v_tx_b, v_org, v_owner, 'pos'), (v_tx_x, v_org, v_owner, 'pos'), (v_tx_none, v_org, v_owner, 'pos');
  PERFORM set_config('gestiona.sale_transaction_id', v_tx_a::text, true);
  INSERT INTO public.sales(org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, payment_method, paid, source, sale_transaction_id, customer_id, customer_name)
  VALUES (v_org, v_owner, v_product, 'ZZ Producto', 1, 121, 121, 'efectivo', true, 'pos', v_tx_a, v_ri, 'ZZ Ferretería');
  PERFORM set_config('gestiona.sale_transaction_id', v_tx_b::text, true);
  INSERT INTO public.sales(org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, payment_method, paid, source, sale_transaction_id, customer_id, customer_name)
  VALUES (v_org, v_owner, v_product, 'ZZ Producto', 1, 121, 121, 'efectivo', true, 'pos', v_tx_b, v_cf, 'ZZ Mostrador');
  PERFORM set_config('gestiona.sale_transaction_id', v_tx_x::text, true);
  INSERT INTO public.sales(org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, payment_method, paid, source, sale_transaction_id, customer_id, customer_name)
  VALUES (v_org, v_owner, v_product, 'ZZ Producto', 1, 121, 121, 'efectivo', true, 'pos', v_tx_x, v_foreign, 'ZZ Ajeno');
  PERFORM set_config('gestiona.sale_transaction_id', v_tx_none::text, true);
  INSERT INTO public.sales(org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, payment_method, paid, source, sale_transaction_id)
  VALUES (v_org, v_owner, v_product, 'ZZ Producto', 1, 121, 121, 'efectivo', true, 'pos', v_tx_none);
  PERFORM set_config('gestiona.sale_transaction_id', '', true);

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_result := public.facturar_venta_pos(v_org, v_tx_a);
  ASSERT (v_result->>'ok')::boolean AND v_result->>'tipo' = 'A', 'Cliente RI no generó factura A: ' || v_result;
  SELECT * INTO v_inv FROM public.invoices WHERE id = (v_result->>'invoice_id')::uuid;
  ASSERT v_inv.tipo_comprobante = 1 AND v_inv.condicion_iva_receptor = 1 AND v_inv.customer_tax_id = '20123456786'
    AND v_inv.customer_name = 'ZZ Ferretería SA' AND v_inv.customer_address = 'ZZ Av 2' AND v_inv.receptor_tipo_documento = 80,
    'Identidad del receptor no congelada';
  ASSERT v_inv.tax_amount = 21 AND v_inv.subtotal = 100, 'Factura A sin IVA discriminado';

  v_result := public.facturar_venta_pos(v_org, v_tx_b);
  ASSERT (v_result->>'ok')::boolean AND v_result->>'tipo' = 'B', 'Consumidor final no generó B: ' || v_result;
  SELECT * INTO v_inv FROM public.invoices WHERE id = (v_result->>'invoice_id')::uuid;
  ASSERT v_inv.condicion_iva_receptor = 5 AND v_inv.customer_tax_id IS NULL AND v_inv.customer_name = 'ZZ Mostrador', 'CF mal congelado';

  v_result := public.facturar_venta_pos(v_org, v_tx_x);
  ASSERT v_result->>'tipo' = 'B', 'Se usó un cliente de otra organización: ' || v_result;
  SELECT * INTO v_inv FROM public.invoices WHERE id = (v_result->>'invoice_id')::uuid;
  ASSERT v_inv.customer_tax_id IS NULL, 'Se filtró el CUIT de otra organización';

  v_result := public.facturar_venta_pos(v_org, v_tx_none);
  ASSERT v_result->>'tipo' = 'B', 'Ticket sin cliente cambió de clase';
  RESET ROLE;

  -- Después de facturar, editar el cliente no cambia la factura emitida.
  UPDATE public.customers SET legal_name = 'ZZ Otro nombre' WHERE id = v_ri;
  ASSERT (SELECT customer_name FROM public.invoices WHERE sale_transaction_id = v_tx_a) = 'ZZ Ferretería SA', 'La factura siguió la ficha';
  RAISE NOTICE 'OK: CUIT/DNI validados, factura A/B según cliente, aislamiento y snapshot';
END;
$$;
ROLLBACK;
SELECT count(*) AS remaining_synthetic_organizations FROM public.organizations WHERE slug LIKE 'zz-customer-fiscal-%';
