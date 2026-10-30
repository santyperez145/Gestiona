-- Simulacro de 20261030001100 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Responsable inscripto: la venta se asienta con el neto en Ventas y el
--      IVA en IVA débito fiscal, con la alícuota de la venta (21 y 10,5).
--   2. Exento: sin IVA, Ventas por el total.
--   3. Una venta que había quedado afuera se asienta con «Asentar pendientes»;
--      una sin alícuota sigue pendiente y dice por qué. Un lector no puede.
DO $$
DECLARE
  v_owner uuid; v_view uuid; v_org uuid; v_org2 uuid; v_org3 uuid; v_p21 uuid; v_p105 uuid; v_sin uuid;
  v_sale uuid; v_sale2 uuid; v_entry uuid; r jsonb; v_ok text := '';
  v_sufijo text := substr(md5(random()::text), 1, 8);
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_view FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;

  -- 1
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ RI', 'zz-ri-' || v_sufijo, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_view, 'viewer') ON CONFLICT DO NOTHING;
  INSERT INTO public.settings (org_id, user_id, afip_tipo_emisor, tax_iva_percent) VALUES (v_org, v_owner, 'responsable_inscripto', 21)
  ON CONFLICT (org_id) DO UPDATE SET afip_tipo_emisor = EXCLUDED.afip_tipo_emisor, tax_iva_percent = EXCLUDED.tax_iva_percent;
  PERFORM public.ledger_plan_default(v_org);
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, tax_rate) VALUES (v_org, v_owner, 'ZZ Pintura', 1210, 21) RETURNING id INTO v_p21;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, tax_rate) VALUES (v_org, v_owner, 'ZZ Yerba', 1105, 10.5) RETURNING id INTO v_p105;

  -- Cada venta es su propio ticket (como en el mostrador).
  PERFORM set_config('gestiona.sale_transaction_id', '', true);
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, paid, payment_method)
  VALUES (v_org, v_owner, v_p21, 'ZZ Pintura', 1, 1210, 1210, true, 'efectivo') RETURNING id INTO v_sale;
  SELECT e.id INTO v_entry FROM public.ledger_entries e WHERE e.referencia_tipo = 'venta' AND e.referencia_id = v_sale;
  IF v_entry IS NULL THEN RAISE EXCEPTION 'FALLA 1a: la venta del responsable inscripto no se asentó'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id WHERE l.entry_id = v_entry AND a.codigo = '4.1.01' AND l.haber = 1000)
     OR NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id WHERE l.entry_id = v_entry AND a.codigo = '2.1.02' AND l.haber = 210)
     OR NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id WHERE l.entry_id = v_entry AND a.codigo = '1.1.01' AND l.debe = 1210) THEN
    RAISE EXCEPTION 'FALLA 1b: el IVA al 21%% no se separó: %',
      (SELECT jsonb_agg(jsonb_build_object('cuenta', a.codigo, 'debe', l.debe, 'haber', l.haber))
         FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id WHERE l.entry_id = v_entry);
  END IF;
  -- Cada venta es su propio ticket (como en el mostrador).
  PERFORM set_config('gestiona.sale_transaction_id', '', true);
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, paid, payment_method)
  VALUES (v_org, v_owner, v_p105, 'ZZ Yerba', 1, 1105, 1105, true, 'debito') RETURNING id INTO v_sale;
  SELECT e.id INTO v_entry FROM public.ledger_entries e WHERE e.referencia_tipo = 'venta' AND e.referencia_id = v_sale;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id WHERE l.entry_id = v_entry AND a.codigo = '4.1.01' AND l.haber = 1000)
     OR NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id WHERE l.entry_id = v_entry AND a.codigo = '2.1.02' AND l.haber = 105) THEN
    RAISE EXCEPTION 'FALLA 1c: el IVA al 10,5%% no se separó';
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Exento', 'zz-exento-' || v_sufijo, v_owner) RETURNING id INTO v_org2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org2, v_owner, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.settings (org_id, user_id, afip_tipo_emisor, tax_iva_percent) VALUES (v_org2, v_owner, 'exento', 21)
  ON CONFLICT (org_id) DO UPDATE SET afip_tipo_emisor = EXCLUDED.afip_tipo_emisor, tax_iva_percent = EXCLUDED.tax_iva_percent;
  PERFORM public.ledger_plan_default(v_org2);
  -- Cada venta es su propio ticket (como en el mostrador).
  PERFORM set_config('gestiona.sale_transaction_id', '', true);
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid, payment_method)
  VALUES (v_org2, v_owner, 'ZZ Curso', 1, 5000, 5000, true, 'transferencia') RETURNING id INTO v_sale;
  SELECT e.id INTO v_entry FROM public.ledger_entries e WHERE e.referencia_tipo = 'venta' AND e.referencia_id = v_sale;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id WHERE l.entry_id = v_entry AND a.codigo = '4.1.01' AND l.haber = 5000)
     OR EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id WHERE l.entry_id = v_entry AND a.codigo = '2.1.02') THEN
    RAISE EXCEPTION 'FALLA 2: el exento discriminó IVA';
  END IF;
  v_ok := v_ok || '2 ';

  -- 3: un emisor que no se reconocía deja la venta afuera; al corregirlo, se asienta.
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Pendientes', 'zz-pend-' || v_sufijo, v_owner) RETURNING id INTO v_org3;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org3, v_owner, 'owner'), (v_org3, v_view, 'viewer') ON CONFLICT DO NOTHING;
  INSERT INTO public.settings (org_id, user_id, afip_tipo_emisor, tax_iva_percent) VALUES (v_org3, v_owner, 'zz_desconocido', 21)
  ON CONFLICT (org_id) DO UPDATE SET afip_tipo_emisor = EXCLUDED.afip_tipo_emisor, tax_iva_percent = EXCLUDED.tax_iva_percent;
  PERFORM public.ledger_plan_default(v_org3);
  -- Cada venta es su propio ticket (como en el mostrador).
  PERFORM set_config('gestiona.sale_transaction_id', '', true);
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid, payment_method)
  VALUES (v_org3, v_owner, 'ZZ Martillo', 1, 1210, 1210, true, 'efectivo') RETURNING id INTO v_sale;
  -- Una venta vieja, de antes de que cada venta guardara su alícuota
  -- (20261001000100): se reproduce sin el disparador que hoy la completa.
  ALTER TABLE public.sales DISABLE TRIGGER trg_snapshot_sale_tax_rate;
  -- Cada venta es su propio ticket (como en el mostrador).
  PERFORM set_config('gestiona.sale_transaction_id', '', true);
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid, payment_method)
  VALUES (v_org3, v_owner, 'ZZ Clavos', 1, 100, 100, true, 'efectivo') RETURNING id INTO v_sale2;
  ALTER TABLE public.sales ENABLE TRIGGER trg_snapshot_sale_tax_rate;
  IF (SELECT fiscal_tax_rate FROM public.sales WHERE id = v_sale2) IS NOT NULL THEN RAISE EXCEPTION 'FALLA 3pre: la venta vieja tiene alícuota'; END IF;
  IF EXISTS (SELECT 1 FROM public.ledger_entries e WHERE e.referencia_tipo = 'venta' AND e.referencia_id IN (v_sale, v_sale2)) THEN
    RAISE EXCEPTION 'FALLA 3a: se asentó con un emisor desconocido';
  END IF;
  UPDATE public.settings SET afip_tipo_emisor = 'responsable_inscripto' WHERE org_id = v_org3;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.ledger_asentar_pendientes(v_org3);
    RAISE EXCEPTION 'FALLA 3b: un lector asentó en el libro';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.ledger_asentar_pendientes(v_org3);
  RESET ROLE;
  IF (r->>'asentadas')::int <> 1 OR (r->>'fallidas')::int <> 1 OR (r->>'quedan')::int <> 1
     OR NOT EXISTS (SELECT 1 FROM jsonb_object_keys(r->'motivos') k WHERE k LIKE '%alicuota%') THEN
    RAISE EXCEPTION 'FALLA 3c: %', r;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_entries e JOIN public.ledger_lines l ON l.entry_id = e.id
                  JOIN public.ledger_accounts a ON a.id = l.account_id
                  WHERE e.referencia_tipo = 'venta' AND e.referencia_id = v_sale AND a.codigo = '2.1.02' AND l.haber = 210) THEN
    RAISE EXCEPTION 'FALLA 3d: la venta pendiente no se asentó con su IVA';
  END IF;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
