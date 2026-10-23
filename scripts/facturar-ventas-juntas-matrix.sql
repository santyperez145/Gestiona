-- Simulacro de 20261022001200 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Dos ventas del mismo cliente salen en una sola factura, con los
--      renglones de las dos, y quedan apuntando a ella.
--   2. Facturar el ticket de una de ellas devuelve esa factura (no otra) y
--      volver a agruparlas se rechaza.
--   3. Ventas de clientes distintos, una sola venta o un cliente sin registrar
--      no se agrupan.
DO $$
DECLARE
  v_user uuid; v_org uuid; v_cli uuid; v_cli2 uuid; v_prod uuid; r jsonb; v_inv uuid;
  tx1 uuid; tx2 uuid; tx3 uuid; tx4 uuid; tx5 uuid; i public.invoices%ROWTYPE; v_ok text := '';
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Mayorista', 'zz-juntas-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.afip_credentials (org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio)
  VALUES (v_org, '20123456786', 3, 'homologacion', 'monotributo', 'ZZ SRL', 'ZZ Calle 1')
  ON CONFLICT (org_id) DO UPDATE SET tipo_emisor = 'monotributo';
  INSERT INTO public.customers (org_id, user_id, name) VALUES (v_org, v_user, 'ZZ Ferretería') RETURNING id INTO v_cli;
  INSERT INTO public.customers (org_id, user_id, name) VALUES (v_org, v_user, 'ZZ Otra') RETURNING id INTO v_cli2;
  INSERT INTO public.products (org_id, user_id, name, stock) VALUES (v_org, v_user, 'ZZ Tornillo', 100) RETURNING id INTO v_prod;
  INSERT INTO public.sale_transactions (org_id, occurred_at, source) VALUES (v_org, now() - interval '3 day', 'manual') RETURNING id INTO tx1;
  INSERT INTO public.sale_transactions (org_id, occurred_at, source) VALUES (v_org, now() - interval '1 day', 'manual') RETURNING id INTO tx2;
  INSERT INTO public.sale_transactions (org_id, occurred_at, source) VALUES (v_org, now(), 'manual') RETURNING id INTO tx3;
  INSERT INTO public.sale_transactions (org_id, occurred_at, source) VALUES (v_org, now(), 'manual') RETURNING id INTO tx4;
  INSERT INTO public.sale_transactions (org_id, occurred_at, source) VALUES (v_org, now(), 'manual') RETURNING id INTO tx5;
  -- `trg_assign_sale_transaction` toma la transacción del contexto, no de la
  -- columna: cada venta va con la suya fijada antes.
  PERFORM set_config('gestiona.sale_transaction_id', tx1::text, true);
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, date, customer_name, customer_id)
  VALUES (v_org, v_user, v_prod, 'ZZ Tornillo', 10, 100, 1000, now(), 'ZZ Ferretería', v_cli);
  PERFORM set_config('gestiona.sale_transaction_id', tx2::text, true);
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, date, customer_name, customer_id)
  VALUES (v_org, v_user, v_prod, 'ZZ Tornillo', 5, 100, 500, now(), 'ZZ Ferretería', v_cli);
  PERFORM set_config('gestiona.sale_transaction_id', tx3::text, true);
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, date, customer_name, customer_id)
  VALUES (v_org, v_user, v_prod, 'ZZ Tornillo', 1, 100, 100, now(), 'ZZ Ferretería', v_cli);
  PERFORM set_config('gestiona.sale_transaction_id', tx4::text, true);
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, date, customer_name, customer_id)
  VALUES (v_org, v_user, v_prod, 'ZZ Tornillo', 1, 100, 100, now(), 'ZZ Otra', v_cli2);
  PERFORM set_config('gestiona.sale_transaction_id', tx5::text, true);
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, date, customer_name, customer_id)
  VALUES (v_org, v_user, v_prod, 'ZZ Tornillo', 1, 100, 100, now(), 'Mostrador', NULL);
  PERFORM set_config('gestiona.sale_transaction_id', '', true);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  r := public.facturar_ventas_juntas(v_org, ARRAY[tx2, tx1]);
  v_inv := (r->>'invoice_id')::uuid;
  SELECT * INTO i FROM public.invoices WHERE id = v_inv;
  IF i.total <> 1500 OR i.tipo_comprobante <> 11 OR i.sale_transaction_id IS NOT NULL
     OR (SELECT count(*) FROM public.invoice_items WHERE invoice_id = v_inv) <> 2
     OR (SELECT count(*) FROM public.sales WHERE sale_transaction_id IN (tx1, tx2) AND invoice_id = v_inv) <> 2 THEN
    RAISE EXCEPTION 'FALLA 1: % %', r, to_jsonb(i);
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  r := public.facturar_venta_pos(v_org, tx1);
  IF NOT (r->>'already')::boolean OR (r->>'invoice_id')::uuid <> v_inv THEN RAISE EXCEPTION 'FALLA 2a: %', r; END IF;
  BEGIN
    PERFORM public.facturar_ventas_juntas(v_org, ARRAY[tx1, tx3]);
    RAISE EXCEPTION 'FALLA 2b: facturó dos veces una venta';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_ok := v_ok || '2 ';

  -- 3
  BEGIN
    PERFORM public.facturar_ventas_juntas(v_org, ARRAY[tx3, tx4]);
    RAISE EXCEPTION 'FALLA 3a: agrupó clientes distintos';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.facturar_ventas_juntas(v_org, ARRAY[tx3]);
    RAISE EXCEPTION 'FALLA 3b: agrupó una sola venta';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.facturar_ventas_juntas(v_org, ARRAY[tx3, tx5]);
    RAISE EXCEPTION 'FALLA 3c: agrupó una venta sin cliente registrado';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
