-- Simulacro de 20261022001300 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Una factura de un proveedor nuevo genera su deuda una sola vez y da de
--      alta al proveedor con su CUIT.
--   2. Una nota de crédito cancela deuda abierta; lo que sobra queda como
--      saldo a favor.
--   3. Un comprobante en la cuenta corriente no se borra.
DO $$
DECLARE
  v_user uuid; v_org uuid; v_fa uuid; v_nc uuid; v_nc2 uuid; r jsonb; d public.supplier_debts%ROWTYPE; v_ok text := '';
  periodo text := to_char(current_date, 'YYYY-MM');
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Compras', 'zz-ccprov-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.comprobantes_de_compra (org_id, periodo, fecha, tipo_comprobante, punto_venta, numero, cuit_emisor, razon_social_emisor, alicuotas, total, created_by)
  VALUES (v_org, periodo, current_date, 1, 3, 1234, '30712345671', 'ZZ Distribuidora SA', '[{"tasa": 21, "neto": 1000, "iva": 210}]', 1210, v_user) RETURNING id INTO v_fa;
  INSERT INTO public.comprobantes_de_compra (org_id, periodo, fecha, tipo_comprobante, punto_venta, numero, cuit_emisor, razon_social_emisor, alicuotas, total, created_by)
  VALUES (v_org, periodo, current_date, 3, 3, 15, '30712345671', 'ZZ Distribuidora SA', '[{"tasa": 21, "neto": 247.93, "iva": 52.07}]', 300, v_user) RETURNING id INTO v_nc;
  INSERT INTO public.comprobantes_de_compra (org_id, periodo, fecha, tipo_comprobante, punto_venta, numero, cuit_emisor, razon_social_emisor, alicuotas, total, created_by)
  VALUES (v_org, periodo, current_date, 3, 3, 16, '30712345671', 'ZZ Distribuidora SA', '[{"tasa": 21, "neto": 1652.89, "iva": 347.11}]', 2000, v_user) RETURNING id INTO v_nc2;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  r := public.pasar_comprobante_a_cuenta_corriente(v_fa, current_date + 15, NULL);
  SELECT * INTO d FROM public.supplier_debts WHERE id = (r->>'supplier_debt_id')::uuid;
  IF d.amount_ars <> 1210 OR d.due_date <> current_date + 15 OR d.comprobante_de_compra_id <> v_fa
     OR (SELECT cuit FROM public.suppliers WHERE id = d.supplier_id) <> '30712345671' THEN
    RAISE EXCEPTION 'FALLA 1a: % %', r, to_jsonb(d);
  END IF;
  r := public.pasar_comprobante_a_cuenta_corriente(v_fa, NULL, NULL);
  IF NOT (r->>'idempotente')::boolean OR (SELECT count(*) FROM public.supplier_debts WHERE org_id = v_org) <> 1 THEN
    RAISE EXCEPTION 'FALLA 1b: %', r;
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  r := public.pasar_comprobante_a_cuenta_corriente(v_nc, NULL, NULL);
  SELECT * INTO d FROM public.supplier_debts WHERE comprobante_de_compra_id = v_fa;
  IF (r->>'aplicado')::numeric <> 300 OR d.paid_ars <> 300 OR d.status <> 'partial' THEN RAISE EXCEPTION 'FALLA 2a: % %', r, to_jsonb(d); END IF;
  r := public.pasar_comprobante_a_cuenta_corriente(v_nc2, NULL, NULL);
  SELECT * INTO d FROM public.supplier_debts WHERE comprobante_de_compra_id = v_fa;
  IF (r->>'aplicado')::numeric <> 910 OR (r->>'saldo_a_favor')::numeric <> 1090 OR d.status <> 'paid'
     OR (SELECT saldo_a_favor FROM public.comprobantes_de_compra WHERE id = v_nc2) <> 1090 THEN
    RAISE EXCEPTION 'FALLA 2b: % %', r, to_jsonb(d);
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  RESET ROLE;
  BEGIN
    DELETE FROM public.comprobantes_de_compra WHERE id = v_fa;
    RAISE EXCEPTION 'FALLA 3: borró un comprobante con deuda';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
