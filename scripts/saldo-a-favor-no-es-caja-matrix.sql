-- Simulacro de 20261030000800 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Las dos cuentas de cobro mandan el saldo a favor a Deudores por ventas
--      y no cambian nada más.
--   2. El asiento real de un pedido online pagado con saldo: el cobro cae en
--      1.2.01, nunca en Caja ni en Mercado Pago a liquidar, y cuadra.
DO $$
DECLARE
  v_owner uuid; v_comp uuid; v_email text; v_org uuid; v_store uuid; v_a uuid; v_order uuid; v_entry uuid;
  v_slug text := 'zz-saldocaja-' || substr(md5(random()::text), 1, 8);
  r jsonb; v_ok text := '';
  v_envio jsonb := '{"provincia": "Buenos Aires"}'::jsonb;
BEGIN
  -- 1
  IF public.cuenta_de_cobro('saldo_a_favor') <> '1.2.01' OR public.cuenta_de_cobro(' Saldo_A_Favor ') <> '1.2.01'
     OR public.cuenta_de_cobro('saldo_a_favor', true) <> '1.2.01' THEN
    RAISE EXCEPTION 'FALLA 1a: el saldo a favor no va a Deudores por ventas';
  END IF;
  IF public.cuenta_de_cobro('efectivo') <> '1.1.01' OR public.cuenta_de_cobro('mercado_pago') <> '1.1.03'
     OR public.cuenta_de_cobro('fiado') <> '1.2.01' OR public.cuenta_de_cobro('algo raro') IS NOT NULL
     OR public.cuenta_de_cobro('transferencia', true) <> '1.1.02' OR public.cuenta_de_cobro('algo raro', true) <> '1.1.01'
     OR public.cuenta_de_cobro('efectivo', false) <> '1.2.01' THEN
    RAISE EXCEPTION 'FALLA 1b: cambió el mapeo de otro medio';
  END IF;
  v_ok := v_ok || '1 ';

  -- 2: un pedido online pagado entero con saldo
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id, lower(email) INTO v_comp, v_email FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Saldo Caja', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_cost, shipping_mode, pickup_enabled)
  VALUES (v_org, v_slug, 'ZZ Saldo Caja', true, ARRAY['efectivo'], 0, 'free', true) RETURNING id INTO v_store;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Remera', 400, 10) RETURNING id INTO v_a;
  INSERT INTO public.customers (org_id, user_id, name, email) VALUES (v_org, v_owner, 'ZZ Compradora', v_email);
  INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por)
  SELECT v_org, c.id, c.name, 1000, 'ZZ crédito', v_owner FROM public.customers c WHERE c.org_id = v_org;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 1)), 'ZZ Compradora', v_email, NULL, v_envio, 'saldo_a_favor');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT id INTO v_order FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = r->>'order_number';
  IF v_order IS NULL OR (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_order) <> 'paid' THEN
    RAISE EXCEPTION 'FALLA 2a: el pedido no quedó pagado con saldo: %', r;
  END IF;

  v_entry := public.ledger_asentar_orden_pagada(jsonb_build_object(
    'org_id', v_org, 'occurred_at', now(), 'data', jsonb_build_object('order_id', v_order)));
  IF v_entry IS NULL THEN RAISE EXCEPTION 'FALLA 2b: no se asentó'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id
                  WHERE l.entry_id = v_entry AND a.codigo = '1.2.01' AND l.debe = 400) THEN
    RAISE EXCEPTION 'FALLA 2c: el cobro no cayó en Deudores por ventas: %',
      (SELECT jsonb_agg(jsonb_build_object('cuenta', a.codigo, 'debe', l.debe, 'haber', l.haber))
         FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id WHERE l.entry_id = v_entry);
  END IF;
  IF EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id
              WHERE l.entry_id = v_entry AND a.codigo IN ('1.1.01', '1.1.03') AND (l.debe > 0 OR l.haber > 0)) THEN
    RAISE EXCEPTION 'FALLA 2d: el saldo a favor movió Caja o Mercado Pago';
  END IF;
  IF (SELECT sum(l.debe) - sum(l.haber) FROM public.ledger_lines l WHERE l.entry_id = v_entry) <> 0 THEN
    RAISE EXCEPTION 'FALLA 2e: el asiento no cuadra';
  END IF;
  v_ok := v_ok || '2';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
