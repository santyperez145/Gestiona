-- Isolated synthetic store. No external payment, email or ARCA call; full rollback.
BEGIN;
CREATE TEMP TABLE zz_store_fiscal_results (scenario text, ok boolean) ON COMMIT DROP;
DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
  v_owner uuid;
  v_viewer uuid;
  v_product_a uuid := gen_random_uuid();
  v_product_b uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_unpaid uuid;
  v_retry_order uuid;
  v_invoice_b uuid;
  v_legacy uuid := gen_random_uuid();
  v_class_c uuid := gen_random_uuid();
  v_review uuid := gen_random_uuid();
  v_invoice uuid;
  v_again uuid;
  v_items jsonb;
  v_snapshot jsonb;
  v_result jsonb;
  v_retry jsonb;
  v_checkout_items jsonb;
  v_checkout_key text := gen_random_uuid()::text;
  v_event jsonb;
  v_parts numeric[];
  v_total numeric;
  v_n integer;
  v_units integer;
  v_sign integer;
  v_count integer;
  v_currency text;
  v_reason text;
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  SELECT id INTO v_viewer FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  IF v_owner IS NULL OR v_viewer IS NULL THEN RAISE EXCEPTION 'Se necesitan dos identidades existentes'; END IF;
  INSERT INTO public.organizations(id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ Store fiscal verification', 'zz-store-fiscal-' || v_org, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_viewer, 'viewer');
  INSERT INTO public.settings(org_id, user_id, afip_tipo_emisor, tax_iva_percent, tax_prices_include_iva, tax_enabled, exchange_rate)
  VALUES (v_org, v_owner, 'responsable_inscripto', 21, false, false, 1)
  ON CONFLICT (org_id) DO UPDATE SET afip_tipo_emisor = 'responsable_inscripto', tax_iva_percent = 21,
    tax_prices_include_iva = false, tax_enabled = false, exchange_rate = 1;
  INSERT INTO public.afip_credentials(org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio)
  VALUES (v_org, '20123456786', 1, 'homologacion', 'responsable_inscripto', 'ZZ Store fiscal', 'ZZ Test address');
  INSERT INTO public.ecommerce_stores(id, org_id, name, slug, is_active, shipping_mode, shipping_cost, payment_methods)
  VALUES (v_store, v_org, 'ZZ Store fiscal', 'zz-store-fiscal-' || v_org, true, 'flat', 121, ARRAY['efectivo']);
  INSERT INTO public.products(id, org_id, user_id, name, sale_price_ars, tax_rate, maneja_stock, stock)
  VALUES (v_product_a, v_org, v_owner, 'ZZ IVA 21', 121, 21, false, 100),
    (v_product_b, v_org, v_owner, 'ZZ IVA 10.5', 110.5, 10.5, false, 100);
  v_items := jsonb_build_array(
    jsonb_build_object('product_id', v_product_a, 'name', 'ZZ IVA 21', 'quantity', 1, 'unit_price', 121, 'total', 121),
    jsonb_build_object('product_id', v_product_b, 'name', 'ZZ IVA 10.5', 'quantity', 1, 'unit_price', 110.5, 'total', 110.5));
  INSERT INTO public.ecommerce_orders(id, org_id, store_id, customer_name, customer_email, items,
    subtotal, discount_amount, shipping_cost, total, tax_amount, payment_method, fiscal_snapshot,
    buyer_tax_condition, buyer_doc_number, buyer_business_name, billing_address)
  VALUES (v_order, v_org, v_store, 'ZZ Contact', 'zz-invoice@example.invalid', v_items,
    231.5, 23.15, 121, 329.35, 999, 'efectivo', '{"version":1,"status":"ready","lines":[]}'::jsonb,
    'responsable_inscripto', '20123456786', 'ZZ Buyer business', '{"calle":"ZZ Calle","ciudad":"CABA"}'::jsonb);
  SELECT fiscal_snapshot INTO v_snapshot FROM public.ecommerce_orders WHERE id = v_order;
  INSERT INTO zz_store_fiscal_results VALUES ('server_ignores_injected_snapshot',
    v_snapshot->>'status' = 'ready' AND jsonb_array_length(v_snapshot->'lines') = 3
    AND (v_snapshot->>'gross')::numeric = 329.35 AND (v_snapshot->>'net')::numeric = 280
    AND (v_snapshot->>'tax_amount')::numeric = 49.35);
  INSERT INTO zz_store_fiscal_results VALUES ('discount_and_shipping_lines',
    (v_snapshot#>>'{lines,0,gross}')::numeric = 108.9 AND (v_snapshot#>>'{lines,0,discount}')::numeric = 12.1
    AND (v_snapshot#>>'{lines,1,gross}')::numeric = 99.45 AND (v_snapshot#>>'{lines,1,discount}')::numeric = 11.05
    AND v_snapshot#>>'{lines,2,kind}' = 'shipping' AND (v_snapshot#>>'{lines,2,tax_amount}')::numeric = 21);
  v_event := jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('order_id', v_order));
  BEGIN
    PERFORM public.facturar_orden_pagada(v_event);
    RAISE EXCEPTION 'Se pudo facturar un pedido sin cobro';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El pedido todavia no tiene%' THEN RAISE; END IF;
  END;
  INSERT INTO zz_store_fiscal_results VALUES ('unpaid_order_blocked', true);

  -- Actual anonymous checkout RPC, not a direct row fixture.
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  v_result := public.create_store_order('zz-store-fiscal-' || v_org,
    jsonb_build_array(jsonb_build_object('product_id', v_product_a, 'quantity', 1)),
    'ZZ Checkout', 'zz-checkout@example.invalid', NULL, '{"calle":"ZZ","provincia":"AR-C","cp":"1425"}'::jsonb,
    'efectivo', NULL, NULL, NULL, NULL);
  RESET ROLE;
  SELECT id INTO v_unpaid FROM public.ecommerce_orders WHERE org_id = v_org AND order_number = v_result->>'order_number';
  IF v_unpaid IS NULL THEN RAISE EXCEPTION 'El checkout no creo un pedido'; END IF;
  INSERT INTO zz_store_fiscal_results SELECT 'anonymous_checkout_captures_vat',
    fiscal_snapshot->>'status' = 'ready' AND jsonb_array_length(fiscal_snapshot->'lines') = 2
    AND tax_amount = round(total - total / 1.21, 2)
    FROM public.ecommerce_orders WHERE id = v_unpaid;

  v_checkout_items := jsonb_build_array(jsonb_build_object('product_id', v_product_a, 'quantity', 1));
  SET LOCAL ROLE anon;
  v_result := public.create_store_order_from_cart_idem('zz-store-fiscal-' || v_org,
    v_checkout_items, 'ZZ Retry', 'zz-retry@example.invalid', NULL,
    '{"calle":"ZZ","provincia":"AR-C","cp":"1425"}'::jsonb, 'efectivo',
    NULL, NULL, NULL, NULL, v_checkout_key, NULL);
  v_retry := public.create_store_order_from_cart_idem('zz-store-fiscal-' || v_org,
    v_checkout_items, 'ZZ Retry', 'zz-retry@example.invalid', NULL,
    '{"calle":"ZZ","provincia":"AR-C","cp":"1425"}'::jsonb, 'efectivo',
    NULL, NULL, NULL, NULL, v_checkout_key, NULL);
  RESET ROLE;
  INSERT INTO zz_store_fiscal_results SELECT 'checkout_retry_preserves_one_snapshot',
    count(*) = 1 AND bool_and(fiscal_snapshot->>'status' = 'ready')
    AND v_result->>'order_number' = v_retry->>'order_number'
    FROM public.ecommerce_orders WHERE org_id = v_org AND order_number = v_result->>'order_number';
  SELECT id INTO v_retry_order FROM public.ecommerce_orders WHERE org_id = v_org AND order_number = v_result->>'order_number';

  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.resolve_store_line(v_org, v_product_a, NULL, 1, NULL);
    RAISE EXCEPTION 'El visitante llamo al resolvedor interno';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.sync_newsletter_consent_to_customer(v_org, 'zz-newsletter@example.invalid');
    RAISE EXCEPTION 'El visitante llamo al sincronizador interno';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  v_result := public.register_store_newsletter('zz-store-fiscal-' || v_org, 'zz-newsletter@example.invalid');
  RESET ROLE;
  INSERT INTO zz_store_fiscal_results VALUES ('public_newsletter_still_works', (v_result->>'ok')::boolean
    AND EXISTS (SELECT 1 FROM public.store_newsletter_subscribers WHERE org_id = v_org AND email = 'zz-newsletter@example.invalid'));

  BEGIN
    INSERT INTO public.ecommerce_orders(org_id, store_id, customer_name, customer_email, items,
      subtotal, total, payment_method)
    VALUES (v_org, v_store, 'ZZ Invalid total', 'zz-invalid@example.invalid', v_items, 231.5, 'NaN'::numeric, 'efectivo');
    RAISE EXCEPTION 'Se acepto un importe no finito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO zz_store_fiscal_results VALUES ('non_finite_total_blocked', true);

  UPDATE public.products SET tax_rate = 27 WHERE id = v_product_a;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  v_result := public.mark_store_order_paid(v_order, 'zz-store-fiscal-payment', 'efectivo');
  v_invoice := public.facturar_orden_pagada(v_event);
  v_again := public.facturar_orden_pagada(v_event);
  PERFORM public.mark_store_order_paid(v_retry_order, 'zz-store-fiscal-payment-b', 'efectivo');
  v_invoice_b := public.facturar_orden_pagada(jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('order_id', v_retry_order)));
  RESET ROLE;
  INSERT INTO zz_store_fiscal_results SELECT 'checkout_invoice_b_preserves_original_vat',
    tipo_comprobante = 6 AND total = 242 AND subtotal = 200 AND tax_amount = 42 AND tax_pct = 21
    AND (SELECT count(*) FROM public.invoice_items WHERE invoice_id = v_invoice_b) = 2
    FROM public.invoices WHERE id = v_invoice_b;
  INSERT INTO zz_store_fiscal_results VALUES ('idempotent_invoice', v_invoice = v_again);
  INSERT INTO zz_store_fiscal_results SELECT 'invoice_matches_charged_order',
    total = 329.35 AND subtotal = 280 AND tax_amount = 49.35 AND tax_pct = 0 AND tipo_comprobante = 1
    AND customer_name = 'ZZ Buyer business' AND customer_address = 'ZZ Calle, CABA'
    FROM public.invoices WHERE id = v_invoice;
  INSERT INTO zz_store_fiscal_results VALUES ('original_rates_after_catalog_change',
    public.invoice_iva_groups(v_invoice) = '[{"rate":10.5,"base":90,"amount":9.45},{"rate":21,"base":190,"amount":39.9}]'::jsonb);
  SELECT count(*) INTO v_count FROM public.invoice_items WHERE invoice_id = v_invoice;
  INSERT INTO zz_store_fiscal_results VALUES ('invoice_has_all_lines', v_count = 3);
  INSERT INTO zz_store_fiscal_results SELECT 'sales_use_original_rate_and_invoice',
    count(*) = 2 AND bool_and(invoice_id = v_invoice)
    AND bool_and(fiscal_tax_rate = CASE WHEN product_id = v_product_a THEN 21 ELSE 10.5 END)
    FROM public.sales WHERE ecommerce_order_id = v_order;
  BEGIN
    PERFORM public.facturar_orden_pagada(jsonb_build_object('org_id', gen_random_uuid(), 'data', jsonb_build_object('order_id', v_order)));
    RAISE EXCEPTION 'Un evento ajeno recupero la factura';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El pedido no existe%' THEN RAISE; END IF;
  END;
  INSERT INTO zz_store_fiscal_results VALUES ('foreign_event_blocked', true);

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.resolve_store_line(v_org, v_product_a, NULL, 1, NULL);
    RAISE EXCEPTION 'El miembro llamo al resolvedor interno';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.sync_newsletter_consent_to_customer(v_org, 'zz-newsletter@example.invalid');
    RAISE EXCEPTION 'El miembro llamo al sincronizador interno';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.ecommerce_orders SET total = total + 1 WHERE id = v_order;
    RAISE EXCEPTION 'El miembro reescribio el total';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.ecommerce_orders SET fiscal_snapshot = '{}'::jsonb WHERE id = v_order;
    RAISE EXCEPTION 'El miembro reescribio el snapshot';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.facturar_orden_pagada(v_event);
    RAISE EXCEPTION 'El miembro llamo directamente al consumidor fiscal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  INSERT INTO zz_store_fiscal_results VALUES ('internal_helpers_not_web_rpc', true);
  INSERT INTO zz_store_fiscal_results VALUES ('member_cannot_rewrite_fiscal_order', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.facturar_pendientes(v_org, 50);
    RAISE EXCEPTION 'Viewer pudo facturar pedidos';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Solo el dueno%' THEN RAISE; END IF;
  END;
  RESET ROLE;
  INSERT INTO zz_store_fiscal_results VALUES ('viewer_cannot_invoice_orders', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- Simulate a historical row without changing any real order or backfilling it.
  ALTER TABLE public.ecommerce_orders DISABLE TRIGGER trg_iva_de_orden;
  INSERT INTO public.ecommerce_orders(id, org_id, store_id, customer_name, customer_email, items,
    subtotal, total, payment_method, payment_status)
  VALUES (v_legacy, v_org, v_store, 'ZZ Legacy', 'zz-legacy@example.invalid', v_items, 231.5, 231.5, 'efectivo', 'paid');
  ALTER TABLE public.ecommerce_orders ENABLE TRIGGER trg_iva_de_orden;
  BEGIN
    PERFORM public.facturar_orden_pagada(jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('order_id', v_legacy)));
    RAISE EXCEPTION 'Se invento IVA historico desde el producto vigente';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El pedido necesita revision fiscal:%' THEN RAISE; END IF;
  END;
  INSERT INTO zz_store_fiscal_results VALUES ('legacy_requires_review',
    NOT EXISTS (SELECT 1 FROM public.invoices WHERE ecommerce_order_id = v_legacy));

  UPDATE public.products SET tax_rate = 15 WHERE id = v_product_a;
  INSERT INTO public.ecommerce_orders(id, org_id, store_id, customer_name, customer_email, items,
    subtotal, total, payment_method, payment_status)
  VALUES (v_review, v_org, v_store, 'ZZ Invalid rate', 'zz-review@example.invalid', v_items, 231.5, 231.5, 'efectivo', 'paid');
  BEGIN
    PERFORM public.facturar_orden_pagada(jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('order_id', v_review)));
    RAISE EXCEPTION 'Se facturo con una alicuota inventada';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'El pedido necesita revision fiscal:%' THEN RAISE; END IF;
  END;
  INSERT INTO zz_store_fiscal_results SELECT 'invalid_rate_blocks_invoice_not_order',
    fiscal_snapshot->>'status' = 'requires_review' FROM public.ecommerce_orders WHERE id = v_review;

  UPDATE public.afip_credentials SET tipo_emisor = 'monotributo' WHERE org_id = v_org;
  PERFORM public.mark_store_order_paid(v_unpaid, 'zz-store-fiscal-change', 'efectivo');
  BEGIN
    PERFORM public.facturar_orden_pagada(jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('order_id', v_unpaid)));
    RAISE EXCEPTION 'Se cambio retroactivamente la clase fiscal del pedido';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Cambio la condicion frente al IVA%' THEN RAISE; END IF;
  END;
  INSERT INTO zz_store_fiscal_results VALUES ('issuer_change_requires_review', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT motivo INTO v_reason FROM public.ordenes_sin_facturar WHERE order_id = v_unpaid;
  RESET ROLE;
  INSERT INTO zz_store_fiscal_results VALUES ('pending_view_explains_issuer_change',
    v_reason = 'cambio la condicion frente al IVA del emisor; requiere revision fiscal');
  INSERT INTO public.ecommerce_orders(id, org_id, store_id, customer_name, customer_email, items,
    subtotal, discount_amount, shipping_cost, total, payment_method, payment_status)
  VALUES (v_class_c, v_org, v_store, 'ZZ Class C', 'zz-c@example.invalid', v_items, 231.5, 23.15, 121, 329.35, 'efectivo', 'paid');
  v_again := public.facturar_orden_pagada(jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('order_id', v_class_c)));
  INSERT INTO zz_store_fiscal_results SELECT 'class_c_detailed_without_vat',
    total = 329.35 AND subtotal = 329.35 AND tax_amount = 0 AND tax_pct = 0 AND tipo_comprobante = 11
    AND (SELECT count(*) FROM public.invoice_items WHERE invoice_id = v_again) = 3
    FROM public.invoices WHERE id = v_again;

  IF public.prorratear(0.02, ARRAY[1,1,1,1]::numeric[]) <> ARRAY[0,0,0.01,0.01]::numeric[]
    OR public.prorratear(0.01, ARRAY[500,500,0]::numeric[]) <> ARRAY[0,0.01,0]::numeric[] THEN
    RAISE EXCEPTION 'El prorrateo no coincide con el espejo del cliente';
  END IF;
  FOREACH v_currency IN ARRAY ARRAY['ARS','CLP'] LOOP
    FOR v_n IN 1..12 LOOP
      FOR v_units IN 1..12 LOOP
        FOREACH v_sign IN ARRAY ARRAY[-1,1] LOOP
          v_total := v_sign * v_units / CASE WHEN v_currency = 'ARS' THEN 100::numeric ELSE 1 END;
          v_parts := public.prorratear(v_total,
            ARRAY(SELECT (i % 3) + 1 FROM generate_series(0, v_n - 1) i)::numeric[], v_currency);
          IF (SELECT sum(x) FROM unnest(v_parts) x) <> v_total OR
            EXISTS (SELECT 1 FROM unnest(v_parts) x WHERE x <> 0 AND sign(x) <> v_sign) THEN
            RAISE EXCEPTION 'El prorrateo pierde dinero o cambia signo';
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;
  INSERT INTO zz_store_fiscal_results VALUES ('rounding_preserves_money_and_sign', true);
  IF EXISTS (SELECT 1 FROM zz_store_fiscal_results WHERE ok IS DISTINCT FROM true) OR
    (SELECT count(*) FROM zz_store_fiscal_results) <> 23 THEN RAISE EXCEPTION 'Fallaron aserciones fiscales Commerce'; END IF;
END;
$$;
SELECT * FROM zz_store_fiscal_results ORDER BY scenario;
ROLLBACK;
