-- Simulacro de 20261030000900 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
-- Un negocio monotributista (sin configuración = monotributo):
--   1. Una venta con débito se asienta en Banco, no en Caja.
--   2. Una venta cobrada mitad en efectivo y mitad con débito reparte el cobro
--      en Caja y Banco; con un reparto que no suma exacto, el redondeo lo
--      absorbe el último medio y el asiento cuadra.
--   3. Un pedido online pagado se asienta una sola vez: sus ventas no tienen
--      asiento propio, el de la orden lleva Ventas por el total, y mientras la
--      orden no está asentada sus ventas figuran como pendientes.
DO $$
DECLARE
  v_owner uuid; v_comp uuid; v_email text; v_org uuid; v_store uuid; v_a uuid; v_order uuid;
  v_sale uuid; v_entry uuid; r jsonb; v_ok text := ''; v_n integer; v_haber numeric;
  v_slug text := 'zz-libro-' || substr(md5(random()::text), 1, 8);
  v_envio jsonb := '{"provincia": "Buenos Aires"}'::jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id, lower(email) INTO v_comp, v_email FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Libro', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  PERFORM public.ledger_plan_default(v_org);

  -- 1
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid, payment_method)
  VALUES (v_org, v_owner, 'ZZ Martillo', 1, 1000, 1000, true, 'debito') RETURNING id INTO v_sale;
  SELECT e.id INTO v_entry FROM public.ledger_entries e WHERE e.org_id = v_org AND e.referencia_tipo = 'venta' AND e.referencia_id = v_sale;
  IF v_entry IS NULL THEN RAISE EXCEPTION 'FALLA 1a: la venta no se asentó'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id
                  WHERE l.entry_id = v_entry AND a.codigo = '1.1.02' AND l.debe = 1000)
     OR EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id
                 WHERE l.entry_id = v_entry AND a.codigo = '1.1.01') THEN
    RAISE EXCEPTION 'FALLA 1b: el débito no fue a Banco';
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid, payment_method, split_payments)
  VALUES (v_org, v_owner, 'ZZ Taladro', 1, 1000, 1000, true, 'efectivo',
          '[{"method": "efectivo", "amount": 600}, {"method": "debito", "amount": 399}]'::jsonb) RETURNING id INTO v_sale;
  SELECT e.id INTO v_entry FROM public.ledger_entries e WHERE e.org_id = v_org AND e.referencia_tipo = 'venta' AND e.referencia_id = v_sale;
  IF NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id
                  WHERE l.entry_id = v_entry AND a.codigo = '1.1.01' AND l.debe = 600)
     OR NOT EXISTS (SELECT 1 FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id
                     WHERE l.entry_id = v_entry AND a.codigo = '1.1.02' AND l.debe = 400) THEN
    RAISE EXCEPTION 'FALLA 2a: el cobro dividido no se repartió: %',
      (SELECT jsonb_agg(jsonb_build_object('cuenta', a.codigo, 'debe', l.debe, 'haber', l.haber))
         FROM public.ledger_lines l JOIN public.ledger_accounts a ON a.id = l.account_id WHERE l.entry_id = v_entry);
  END IF;
  IF (SELECT sum(l.debe) - sum(l.haber) FROM public.ledger_lines l WHERE l.entry_id = v_entry) <> 0 THEN
    RAISE EXCEPTION 'FALLA 2b: el asiento dividido no cuadra';
  END IF;
  v_ok := v_ok || '2 ';

  -- 3: un pedido online pagado en efectivo al retirar
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_cost, shipping_mode, pickup_enabled)
  VALUES (v_org, v_slug, 'ZZ Libro', true, ARRAY['efectivo'], 0, 'free', true) RETURNING id INTO v_store;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Remera', 400, 10) RETURNING id INTO v_a;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(jsonb_build_object('product_id', v_a, 'quantity', 2)), 'ZZ Compradora', v_email, NULL, v_envio, 'efectivo');
  RESET ROLE;
  SELECT id INTO v_order FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = r->>'order_number';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirmar_pago_manual_tienda(v_order, 'ZZ');
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.sales WHERE ecommerce_order_id = v_order) THEN RAISE EXCEPTION 'FALLA 3a: el pedido no creó ventas'; END IF;
  IF EXISTS (SELECT 1 FROM public.ledger_entries e JOIN public.sales s ON s.id = e.referencia_id
              WHERE e.referencia_tipo = 'venta' AND s.ecommerce_order_id = v_order) THEN
    RAISE EXCEPTION 'FALLA 3b: las ventas del pedido se asentaron solas (el pedido contaría dos veces)';
  END IF;
  -- Sin asiento de la orden todavía: sus ventas figuran pendientes.
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.operaciones_sin_asentar o
   WHERE o.tipo = 'venta' AND o.id IN (SELECT id FROM public.sales WHERE ecommerce_order_id = v_order);
  RESET ROLE;
  IF v_n = 0 THEN RAISE EXCEPTION 'FALLA 3c: una venta online sin asiento no figuró como pendiente'; END IF;
  -- El outbox asienta la orden.
  v_entry := public.ledger_asentar_orden_pagada(jsonb_build_object(
    'org_id', v_org, 'occurred_at', now(), 'data', jsonb_build_object('order_id', v_order)));
  SELECT COALESCE(sum(l.haber), 0) INTO v_haber
    FROM public.ledger_entries e
    JOIN public.ledger_lines l ON l.entry_id = e.id
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE e.org_id = v_org AND a.codigo = '4.1.01'
     AND ((e.referencia_tipo = 'orden' AND e.referencia_id = v_order)
       OR (e.referencia_tipo = 'venta' AND e.referencia_id IN (SELECT id FROM public.sales WHERE ecommerce_order_id = v_order)));
  IF v_haber <> 800 THEN RAISE EXCEPTION 'FALLA 3d: Ventas recibió % por un pedido de 800', v_haber; END IF;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.operaciones_sin_asentar o
   WHERE o.tipo = 'venta' AND o.id IN (SELECT id FROM public.sales WHERE ecommerce_order_id = v_order);
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALLA 3e: con la orden asentada sus ventas siguen pendientes'; END IF;
  v_ok := v_ok || '3';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
