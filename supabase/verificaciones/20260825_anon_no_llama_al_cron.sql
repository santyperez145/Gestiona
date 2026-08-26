-- ⚠️ Ataque real como `anon`, el rol de la clave anónima que viaja en el bundle.
-- Todo dentro de BEGIN/ROLLBACK: si algo entra, no queda.
-- Lo que "funciona" acá es un agujero.

CREATE TEMP TABLE r(n int, ataque text, resultado text, seguro boolean);
GRANT ALL ON r TO anon;

DO $blk$
DECLARE v_org uuid; v_po uuid; v_n int; v_txt text; v_res jsonb;
BEGIN
  SELECT id INTO v_org FROM public.organizations LIMIT 1;
  SELECT id INTO v_po FROM public.purchase_orders LIMIT 1;

  SET LOCAL ROLE anon;

  -- 1. ¿Puede anon invocar una Edge Function arbitraria?
  BEGIN
    PERFORM public.invoke_edge_function('daily-kpi');
    INSERT INTO r VALUES (1,'invoke_edge_function(''daily-kpi'')','EJECUTO', false);
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES (1,'invoke_edge_function(''daily-kpi'')', left(SQLERRM,60), true);
  END;

  -- 2. ¿Puede recibir una orden de compra? Eso MUEVE STOCK.
  BEGIN
    v_res := public.receive_purchase_order_idem(v_po, '[]'::jsonb, 'zz-ataque-1');
    INSERT INTO r VALUES (2,'receive_purchase_order_idem (mueve stock)','EJECUTO', false);
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES (2,'receive_purchase_order_idem (mueve stock)', left(SQLERRM,60), true);
  END;

  -- 3. ¿Puede confirmar una transferencia como cobrada?
  BEGIN
    PERFORM public.confirm_payment_link_transfer(gen_random_uuid());
    INSERT INTO r VALUES (3,'confirm_payment_link_transfer (marca cobrado)','EJECUTO', false);
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES (3,'confirm_payment_link_transfer (marca cobrado)', left(SQLERRM,60), true);
  END;

  -- 4. ¿Puede tocar la RLS del esquema?
  BEGIN
    PERFORM public.rls_auto_enable();
    INSERT INTO r VALUES (4,'rls_auto_enable()','EJECUTO', false);
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES (4,'rls_auto_enable()', left(SQLERRM,60), true);
  END;

  -- 5. ¿Puede vencer las reservas de stock de cualquiera?
  BEGIN
    PERFORM public.vencer_reservas();
    INSERT INTO r VALUES (5,'vencer_reservas() (libera stock ajeno)','EJECUTO', false);
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES (5,'vencer_reservas() (libera stock ajeno)', left(SQLERRM,60), true);
  END;

  -- 6. ¿Puede vencer los trials de todos los comercios?
  BEGIN
    PERFORM public.expire_overdue_trials();
    INSERT INTO r VALUES (6,'expire_overdue_trials() (corta el servicio)','EJECUTO', false);
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES (6,'expire_overdue_trials() (corta el servicio)', left(SQLERRM,60), true);
  END;

  -- 7. ¿Puede leer los carritos abandonados de todos? Son emails de clientes.
  BEGIN
    SELECT count(*) INTO v_n FROM public.pending_abandoned_carts();
    INSERT INTO r VALUES (7,'pending_abandoned_carts() (emails de clientes)',
                          'LEYO '||v_n||' filas', false);
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES (7,'pending_abandoned_carts() (emails de clientes)', left(SQLERRM,60), true);
  END;

  -- 8. ¿Puede leer las deudas vencidas de cualquier comercio?
  BEGIN
    SELECT count(*) INTO v_n FROM public.check_overdue_debts();
    INSERT INTO r VALUES (8,'check_overdue_debts() (deuda de clientes)',
                          'LEYO '||v_n||' filas', false);
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES (8,'check_overdue_debts() (deuda de clientes)', left(SQLERRM,60), true);
  END;

  -- 9. ¿Puede ver el costo/precio autoritativo del POS de otro comercio?
  BEGIN
    v_res := public.precio_pos_autoritativo(v_org, (SELECT id FROM public.products LIMIT 1), NULL, 1);
    INSERT INTO r VALUES (9,'precio_pos_autoritativo (costo ajeno)',
                          'DEVOLVIO '||left(v_res::text,40), false);
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES (9,'precio_pos_autoritativo (costo ajeno)', left(SQLERRM,60), true);
  END;

  RESET ROLE;
END $blk$;

SELECT n, ataque, resultado,
       CASE WHEN seguro THEN 'frenado' ELSE '*** AGUJERO ***' END AS veredicto
FROM r ORDER BY n;
