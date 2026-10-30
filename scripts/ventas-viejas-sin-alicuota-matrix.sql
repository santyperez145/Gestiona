-- Simulacro de 20261030001300 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
-- Un responsable inscripto con dos ventas viejas sin alícuota (una de un
-- producto con alícuota 10,5 y otra sin producto), que quedaron afuera.
--   1. Sólo el dueño decide; la alícuota tiene que ser una de ARCA.
--   2. Se asientan con la del producto o, si no tiene, la indicada; el asiento
--      dice que fue supuesta y la corrida queda en la auditoría.
--   3. Una venta nueva sigue asentándose sola con su alícuota.
DO $$
DECLARE
  v_owner uuid; v_admin uuid; v_org uuid; v_p uuid; v_s1 uuid; v_s2 uuid; v_s3 uuid; v_entry uuid; r jsonb; v_ok text := '';
  v_sufijo text := substr(md5(random()::text), 1, 8);
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_admin FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Viejas', 'zz-viejas-' || v_sufijo, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_admin, 'admin') ON CONFLICT DO NOTHING;
  INSERT INTO public.settings (org_id, user_id, afip_tipo_emisor, tax_iva_percent) VALUES (v_org, v_owner, 'responsable_inscripto', 21)
  ON CONFLICT (org_id) DO UPDATE SET afip_tipo_emisor = EXCLUDED.afip_tipo_emisor, tax_iva_percent = EXCLUDED.tax_iva_percent;
  PERFORM public.ledger_plan_default(v_org);
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, tax_rate) VALUES (v_org, v_owner, 'ZZ Yerba', 1105, 10.5) RETURNING id INTO v_p;

  -- Ventas viejas: sin el disparador que hoy guarda la alícuota.
  ALTER TABLE public.sales DISABLE TRIGGER trg_snapshot_sale_tax_rate;
  PERFORM set_config('gestiona.sale_transaction_id', '', true);
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, paid, payment_method)
  VALUES (v_org, v_owner, v_p, 'ZZ Yerba', 1, 1105, 1105, true, 'efectivo') RETURNING id INTO v_s1;
  PERFORM set_config('gestiona.sale_transaction_id', '', true);
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid, payment_method)
  VALUES (v_org, v_owner, 'ZZ Varios', 1, 1210, 1210, true, 'efectivo') RETURNING id INTO v_s2;
  ALTER TABLE public.sales ENABLE TRIGGER trg_snapshot_sale_tax_rate;
  IF EXISTS (SELECT 1 FROM public.ledger_entries e WHERE e.referencia_tipo = 'venta' AND e.referencia_id IN (v_s1, v_s2)) THEN
    RAISE EXCEPTION 'FALLA 0: una venta sin alícuota se asentó sola';
  END IF;

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.ledger_asentar_ventas_sin_alicuota(v_org, 21, true);
    RAISE EXCEPTION 'FALLA 1a: un administrador supuso la alícuota';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.ledger_asentar_ventas_sin_alicuota(v_org, 19, true);
    RAISE EXCEPTION 'FALLA 1b: aceptó una alícuota que no es de ARCA';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '1 ';

  -- 2
  SET LOCAL ROLE authenticated;
  r := public.ledger_asentar_ventas_sin_alicuota(v_org, 21, true);
  RESET ROLE;
  IF (r->>'asentadas')::int <> 2 OR (r->>'fallidas')::int <> 0 OR (r->>'quedan')::int <> 0 THEN RAISE EXCEPTION 'FALLA 2a: %', r; END IF;
  SELECT e.id INTO v_entry FROM public.ledger_entries e WHERE e.referencia_tipo = 'venta' AND e.referencia_id = v_s1;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id
                  WHERE l.entry_id = v_entry AND a.codigo = '2.1.02' AND l.haber = 105) THEN
    RAISE EXCEPTION 'FALLA 2b: no usó la alícuota del producto (10,5)';
  END IF;
  SELECT e.id INTO v_entry FROM public.ledger_entries e WHERE e.referencia_tipo = 'venta' AND e.referencia_id = v_s2;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id
                  WHERE l.entry_id = v_entry AND a.codigo = '2.1.02' AND l.haber = 210) THEN
    RAISE EXCEPTION 'FALLA 2c: no usó la alícuota indicada (21)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_lines l WHERE l.entry_id = v_entry AND (l.metadata->>'alicuota_supuesta')::boolean) THEN
    RAISE EXCEPTION 'FALLA 2d: el asiento no dice que la alícuota fue supuesta';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE org_id = v_org AND action = 'ledger_supposed_vat') THEN
    RAISE EXCEPTION 'FALLA 2e: la decisión no quedó en la auditoría';
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  PERFORM set_config('gestiona.sale_transaction_id', '', true);
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, paid, payment_method)
  VALUES (v_org, v_owner, v_p, 'ZZ Yerba', 1, 1105, 1105, true, 'efectivo') RETURNING id INTO v_s3;
  SELECT e.id INTO v_entry FROM public.ledger_entries e WHERE e.referencia_tipo = 'venta' AND e.referencia_id = v_s3;
  IF v_entry IS NULL OR NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id
                                     WHERE l.entry_id = v_entry AND a.codigo = '2.1.02' AND l.haber = 105) THEN
    RAISE EXCEPTION 'FALLA 3: la venta nueva no se asentó sola con su alícuota';
  END IF;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
