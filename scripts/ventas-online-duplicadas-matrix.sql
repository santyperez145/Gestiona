-- Simulacro de 20261030001000 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
-- Se reproduce lo asentado antes de 20261030000900: un pedido online con su
-- asiento de orden y, además, uno por cada venta.
--   1. El diagnóstico lo muestra (owner/admin; un lector no).
--   2. Sólo el dueño corrige.
--   3. La corrección deja Ventas en el total del pedido, fecha cada
--      contraasiento como su original y no deja ventas pendientes.
--   4. Correrla otra vez no hace nada.
DO $$
DECLARE
  v_owner uuid; v_view uuid; v_comp uuid; v_email text; v_org uuid; v_store uuid; v_a uuid; v_b uuid; v_order uuid;
  v_sale record; r jsonb; v_ok text := ''; v_neto numeric; v_n integer;
  v_slug text := 'zz-dup-' || substr(md5(random()::text), 1, 8);
  v_envio jsonb := '{"provincia": "Buenos Aires"}'::jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id, lower(email) INTO v_comp, v_email FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  v_view := v_comp;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ Duplicadas', v_slug, v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_view, 'viewer') ON CONFLICT DO NOTHING;
  PERFORM public.seed_default_permissions(v_org);
  PERFORM public.ledger_plan_default(v_org);
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active, payment_methods, shipping_cost, shipping_mode, pickup_enabled)
  VALUES (v_org, v_slug, 'ZZ Duplicadas', true, ARRAY['efectivo'], 0, 'free', true) RETURNING id INTO v_store;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Remera', 400, 10) RETURNING id INTO v_a;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ Gorra', 100, 10) RETURNING id INTO v_b;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comp, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.create_store_order(v_slug, jsonb_build_array(
    jsonb_build_object('product_id', v_a, 'quantity', 2), jsonb_build_object('product_id', v_b, 'quantity', 1)),
    'ZZ Compradora', v_email, NULL, v_envio, 'efectivo');
  RESET ROLE;
  SELECT id INTO v_order FROM public.ecommerce_orders WHERE store_id = v_store AND order_number = r->>'order_number';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.confirmar_pago_manual_tienda(v_order, 'ZZ');
  RESET ROLE;
  -- Lo de antes: el asiento de la orden y, además, uno por cada venta.
  PERFORM public.ledger_asentar_orden_pagada(jsonb_build_object(
    'org_id', v_org, 'occurred_at', now(), 'data', jsonb_build_object('order_id', v_order)));
  FOR v_sale IN SELECT id FROM public.sales WHERE ecommerce_order_id = v_order LOOP
    PERFORM public.ledger_asentar_venta(v_sale.id);
  END LOOP;

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.ledger_ventas_online_duplicadas(v_org);
    RAISE EXCEPTION 'FALLA 1a: un lector vio el libro';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.ledger_ventas_online_duplicadas(v_org);
  RESET ROLE;
  IF (r->>'cantidad')::int <> 2 OR (r->>'ventas')::numeric <> 900 THEN RAISE EXCEPTION 'FALLA 1b: %', r; END IF;
  v_ok := v_ok || '1 ';

  -- 2
  UPDATE public.memberships SET role = 'admin' WHERE org_id = v_org AND user_id = v_view;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.ledger_corregir_ventas_online_duplicadas(v_org);
    RAISE EXCEPTION 'FALLA 2: un administrador corrigió el libro';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  v_ok := v_ok || '2 ';

  -- 3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.ledger_corregir_ventas_online_duplicadas(v_org);
  RESET ROLE;
  IF (r->>'corregidos')::int <> 2 OR (r->>'ventas')::numeric <> 900 THEN RAISE EXCEPTION 'FALLA 3a: %', r; END IF;
  SELECT COALESCE(sum(l.haber) - sum(l.debe), 0) INTO v_neto
    FROM public.ledger_entries e
    JOIN public.ledger_lines l ON l.entry_id = e.id
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE e.org_id = v_org AND a.codigo = '4.1.01';
  IF v_neto <> 900 THEN RAISE EXCEPTION 'FALLA 3b: Ventas quedó en % para un pedido de 900', v_neto; END IF;
  IF EXISTS (SELECT 1 FROM public.ledger_entries c JOIN public.ledger_entries o ON o.id = c.anula_a
              WHERE c.org_id = v_org AND c.fecha <> o.fecha) THEN
    RAISE EXCEPTION 'FALLA 3c: un contraasiento no quedó en la fecha de su original';
  END IF;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.operaciones_sin_asentar o
   WHERE o.tipo = 'venta' AND o.id IN (SELECT id FROM public.sales WHERE ecommerce_order_id = v_order);
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALLA 3d: las ventas del pedido quedaron como pendientes'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE org_id = v_org AND action = 'ledger_correction') THEN
    RAISE EXCEPTION 'FALLA 3e: la corrección no quedó en la auditoría';
  END IF;
  v_ok := v_ok || '3 ';

  -- 4
  SET LOCAL ROLE authenticated;
  r := public.ledger_corregir_ventas_online_duplicadas(v_org);
  IF (r->>'corregidos')::int <> 0 OR (public.ledger_ventas_online_duplicadas(v_org)->>'cantidad')::int <> 0 THEN
    RAISE EXCEPTION 'FALLA 4: la segunda corrida volvió a corregir: %', r;
  END IF;
  RESET ROLE;
  v_ok := v_ok || '4';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
