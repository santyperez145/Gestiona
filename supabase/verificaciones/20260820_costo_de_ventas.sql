-- Verificación de H7 (costo de ventas). NO es una migración.
--
-- Va envuelta en BEGIN/ROLLBACK porque el libro es inmutable: un bloque que
-- asiente no puede limpiar lo que asentó, y la guarda que lo impide es
-- deseable. El rollback deshace todo, incluido el asiento.
--
--   npx supabase db query --linked --file supabase/verificaciones/20260820_costo_de_ventas.sql

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación contra producción, con limpieza
-- ═══════════════════════════════════════════════════════════════════════════
DO $verif$
DECLARE
  v_org     uuid;
  v_store   uuid;
  v_user    uuid;
  v_prod    uuid;
  v_orden   uuid;
  v_asiento uuid;
  v_costo   numeric;
  v_cuadra  numeric;
  v_meta    jsonb;
  v_restos  int;
BEGIN
  SELECT s.org_id, s.id INTO v_org, v_store
    FROM public.ecommerce_stores s WHERE s.is_active LIMIT 1;
  SELECT m.user_id INTO v_user FROM public.memberships m WHERE m.org_id = v_org LIMIT 1;
  IF v_org IS NULL OR v_user IS NULL THEN
    RAISE NOTICE 'H7: sin tienda o sin miembro, no se puede verificar'; RETURN;
  END IF;

  PERFORM public.ledger_plan_default(v_org);

  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, cost_usd, total_cost_usd)
  VALUES (v_org, v_user, 'ZZ H7 costo', 12100, 10, 2, 2) RETURNING id INTO v_prod;

  INSERT INTO public.ecommerce_orders (
    org_id, store_id, order_number, customer_name, customer_email,
    items, subtotal, shipping_cost, discount_amount, total, payment_status, payment_method
  ) VALUES (
    v_org, v_store, 'ZZ-H7-1', 'ZZ H7', 'zz-h7@ejemplo.invalid',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'quantity', 2, 'unit_price', 12100, 'name', 'ZZ H7 costo')),
    24200, 0, 0, 24200, 'pending', 'transferencia'
  ) RETURNING id INTO v_orden;

  -- El movimiento de stock con su costo del momento, que es la fuente de H7.
  INSERT INTO public.stock_movements (
    org_id, product_id, product_name, movement_type, quantity,
    stock_before, stock_after, reference_type, reference_id, unit_cost_usd)
  VALUES (v_org, v_prod, 'ZZ H7 costo', 'sale', -2, 10, 8,
          'ecommerce_order', v_orden, 2);

  v_asiento := public.ledger_asentar_orden_pagada(
    jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('order_id', v_orden)));

  -- 1. El asiento cuadra: es la regla que la base ya validaba y no puede
  --    romperse por agregar dos partidas.
  SELECT SUM(l.debe) - SUM(l.haber) INTO v_cuadra
    FROM public.ledger_lines l WHERE l.entry_id = v_asiento;
  ASSERT COALESCE(v_cuadra, 0) = 0,
    format('el asiento no cuadra: diferencia %s', v_cuadra);

  -- 2. El costo se descargó: 2 unidades x USD 2 x 1600 = 6400.
  SELECT l.debe INTO v_costo FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.entry_id = v_asiento AND a.codigo = '5.1.01';
  ASSERT COALESCE(v_costo, 0) > 0, 'no se asento costo de mercaderia vendida';
  RAISE NOTICE 'H7: costo asentado %', v_costo;

  -- 3. Y la contrapartida sale de Mercadería, no de la nada.
  ASSERT EXISTS (
    SELECT 1 FROM public.ledger_lines l
      JOIN public.ledger_accounts a ON a.id = l.account_id
     WHERE l.entry_id = v_asiento AND a.codigo = '1.3.01' AND l.haber = v_costo),
    'el costo no descargo Mercaderia';

  -- 4. Queda escrito con qué tipo de cambio se armó: sin eso no se audita.
  SELECT l.metadata INTO v_meta FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.entry_id = v_asiento AND a.codigo = '5.1.01';
  ASSERT (v_meta->>'tipo_cambio') IS NOT NULL, 'el asiento no dice el tipo de cambio';
  ASSERT (v_meta->>'tipo_cambio_fuente') IS NOT NULL, 'no dice de donde salio el tipo de cambio';

  -- 5. Volver a asentar la misma orden no duplica: la guarda sigue valiendo
  --    con las dos partidas nuevas adentro del mismo asiento.
  ASSERT public.ledger_asentar_orden_pagada(
           jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('order_id', v_orden))) = v_asiento,
    'la segunda pasada creo otro asiento';

  -- La limpieza la hace el ROLLBACK de abajo, no un DELETE: el libro no se
  -- puede borrar y está bien que no se pueda.
  RAISE NOTICE 'H7: las 5 aserciones pasaron';
END;
$verif$;

ROLLBACK;
