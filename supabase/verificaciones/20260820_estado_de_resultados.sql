-- Verificación de I1 (estado de resultados). NO es una migración.
-- Envuelta en BEGIN/ROLLBACK: asienta en el libro, que es inmutable.
BEGIN;

DO $verif$
DECLARE
  v_org   uuid;
  v_store uuid;
  v_user  uuid;
  v_prod  uuid;
  v_orden uuid;
  v_r     jsonb;
BEGIN
  SELECT s.org_id, s.id INTO v_org, v_store
    FROM public.ecommerce_stores s WHERE s.is_active LIMIT 1;
  SELECT m.user_id INTO v_user FROM public.memberships m WHERE m.org_id = v_org LIMIT 1;
  IF v_org IS NULL OR v_user IS NULL THEN
    RAISE NOTICE 'I1: sin tienda o miembro'; RETURN;
  END IF;

  PERFORM public.ledger_plan_default(v_org);
  -- `is_org_member` mira auth.uid(), que en un script es NULL. Se simula la
  -- sesión del dueño para que la guarda se evalúe de verdad y no por ser
  -- superusuario, que es el error que este repo ya cometió una vez.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, cost_usd, total_cost_usd)
  VALUES (v_org, v_user, 'ZZ I1', 12100, 10, 2, 2) RETURNING id INTO v_prod;

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_name, customer_email,
    items, subtotal, shipping_cost, discount_amount, total, payment_status, payment_method)
  VALUES (v_org, v_store, 'ZZ-I1-1', 'ZZ', 'zz-i1@ejemplo.invalid',
    jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 2,
      'unit_price', 12100, 'name', 'ZZ I1')),
    24200, 0, 0, 24200, 'pending', 'transferencia') RETURNING id INTO v_orden;

  INSERT INTO public.stock_movements (
    org_id, product_id, product_name, movement_type, quantity,
    stock_before, stock_after, reference_type, reference_id, unit_cost_usd)
  VALUES (v_org, v_prod, 'ZZ I1', 'sale', -2, 10, 8, 'ecommerce_order', v_orden, 2);

  PERFORM public.ledger_asentar_orden_pagada(
    jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('order_id', v_orden)));

  v_r := public.ledger_resultado(v_org, CURRENT_DATE, CURRENT_DATE);
  RAISE NOTICE 'I1 resultado: %', v_r;

  -- Venta 24200 con IVA 21% incluido -> neto 20000, IVA 4200.
  -- Costo 2 u x USD 2 x 1600 = 6400. Margen bruto = 20000 - 6400 = 13600.
  ASSERT (v_r->>'ventas')::numeric > 0, 'no registro ventas';
  ASSERT (v_r->>'costo_mercaderia')::numeric > 0,
    'el costo no llego al estado de resultados';
  ASSERT (v_r->>'margen_bruto')::numeric
         = (v_r->>'ventas')::numeric - (v_r->>'costo_mercaderia')::numeric,
    'el margen bruto no es ventas menos costo';

  -- Lo que hace creible al margen: si hubiera ventas sin costo, tiene que
  -- decirlo. Esta la asentamos CON costo, asi que tiene que dar cero.
  ASSERT (v_r->>'ventas_sin_costo')::int = 0,
    format('ventas_sin_costo deberia ser 0 y dio %s', v_r->>'ventas_sin_costo');

  -- El signo ya viene resuelto: ningun importe sale negativo.
  ASSERT (v_r->>'costo_mercaderia')::numeric > 0
     AND (v_r->>'comision_medios_pago')::numeric >= 0,
    'los gastos tienen que salir positivos, no por el debe';

  -- La serie del grafico ve el mismo dia.
  ASSERT EXISTS (SELECT 1 FROM public.ledger_resultado_diario(v_org, CURRENT_DATE, CURRENT_DATE)),
    'la serie diaria no devolvio nada';

  RAISE NOTICE 'I1: las 6 aserciones pasaron. Margen bruto: %', v_r->>'margen_bruto';
END;
$verif$;

ROLLBACK;
