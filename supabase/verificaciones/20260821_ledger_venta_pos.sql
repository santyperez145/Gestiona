CREATE TEMP TABLE r(n int, paso text, obtenido text, ok boolean);
CREATE TEMP TABLE ent_antes AS SELECT id FROM public.ledger_entries;

DO $blk$
DECLARE
  v_org uuid; v_dueno uuid; v_prod uuid := gen_random_uuid();
  v_tx1 uuid := gen_random_uuid();
  v_tx2 uuid := gen_random_uuid();
  v_tx3 uuid := gen_random_uuid();
  v_tx4 uuid := gen_random_uuid();
  v_e uuid; v_n int; v_d numeric; v_h numeric; v_txt text; v_emisor text;
BEGIN
  SELECT s.org_id INTO v_org FROM public.ecommerce_stores s WHERE s.slug='exentryimports';
  SELECT m.user_id INTO v_dueno FROM public.memberships m
   WHERE m.org_id=v_org AND m.role IN ('owner','admin') LIMIT 1;
  SELECT s.afip_tipo_emisor INTO v_emisor FROM public.settings s WHERE s.org_id=v_org;

  CREATE TEMP TABLE zz_p AS SELECT * FROM public.products WHERE org_id=v_org LIMIT 1;
  UPDATE zz_p SET id=v_prod, name='ZZ Ledger POS', stock=1000, sale_price_ars=1000,
                  discount_price_ars=0, tiendanube_id=NULL;
  INSERT INTO public.products SELECT * FROM zz_p;

  -- ── Ticket 1: dos renglones en efectivo ─────────────────────────────────
  -- ⚠️ `assign_sale_transaction` IGNORA el sale_transaction_id de la fila: lo
  -- lee de este set_config o genera uno nuevo. Insertar con el id puesto no
  -- alcanza — la primera version del test lo hacia y el trigger lo pisaba, asi
  -- que el consumidor no encontraba renglones. Es el mismo camino que usa
  -- `create_sales_transaction`.
  PERFORM set_config('gestiona.sale_transaction_id', v_tx1::text, true);
  INSERT INTO public.sale_transactions (id, org_id, source, created_by, occurred_at)
  VALUES (v_tx1, v_org, 'pos', v_dueno, now());

  INSERT INTO public.sales (id, org_id, user_id, product_id, product_name, quantity,
      unit_price_ars, total_ars, cost_of_goods_ars, payment_method, paid,
      source, sale_transaction_id, date)
  VALUES
    (gen_random_uuid(), v_org, v_dueno, v_prod, 'ZZ Ledger POS', 2, 1000, 2000, 600,
     'efectivo', true, 'pos', v_tx1, now()),
    (gen_random_uuid(), v_org, v_dueno, v_prod, 'ZZ Ledger POS', 1, 1000, 1000, 300,
     'efectivo', true, 'pos', v_tx1, now());

  -- ── 1. El evento salio, uno solo, no uno por renglon ────────────────────
  SELECT count(*) INTO v_n FROM public.domain_events
   WHERE aggregate_type='venta' AND aggregate_id=v_tx1 AND event_type='venta.registrada';
  INSERT INTO r VALUES (1,'un evento por ticket, no por renglon', v_n::text, v_n=1);

  -- ── 2. Se asienta ───────────────────────────────────────────────────────
  v_e := public.ledger_asentar_venta_pos(
    jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('transaction_id', v_tx1)));
  INSERT INTO r VALUES (2,'la venta de mostrador genera asiento',
    COALESCE(v_e::text,'(ninguno)'), v_e IS NOT NULL);

  -- ── 3. ⚠️ Y CUADRA ──────────────────────────────────────────────────────
  SELECT COALESCE(SUM(debe),0), COALESCE(SUM(haber),0) INTO v_d, v_h
    FROM public.ledger_lines WHERE entry_id = v_e;
  INSERT INTO r VALUES (3,'debe = haber', v_d||' vs '||v_h, v_d = v_h);

  -- ── 4. La caja recibe lo cobrado ────────────────────────────────────────
  SELECT COALESCE(SUM(l.debe),0) INTO v_d FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.entry_id = v_e AND a.codigo = '1.1.01';
  INSERT INTO r VALUES (4,'los 3000 entran a Caja', v_d::text, v_d = 3000);

  -- ── 5. El costo de la mercaderia queda registrado ───────────────────────
  SELECT COALESCE(SUM(l.debe),0) INTO v_d FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.entry_id = v_e AND a.codigo = '5.1.01';
  INSERT INTO r VALUES (5,'el costo de lo vendido tambien', v_d::text, v_d = 900);

  -- ── 6. Monotributo: sin IVA discriminado ────────────────────────────────
  SELECT COALESCE(SUM(l.haber),0) INTO v_d FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.entry_id = v_e AND a.codigo = '2.1.02';
  INSERT INTO r VALUES (6,'emisor '||COALESCE(v_emisor,'?')||': IVA segun la regla real',
    v_d::text, CASE WHEN public.discrimina_iva(v_emisor) THEN v_d > 0 ELSE v_d = 0 END);

  -- ── 7. Reprocesar no duplica ────────────────────────────────────────────
  PERFORM public.ledger_asentar_venta_pos(
    jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('transaction_id', v_tx1)));
  SELECT count(*) INTO v_n FROM public.ledger_entries
   WHERE referencia_tipo='venta_pos' AND referencia_id=v_tx1;
  INSERT INTO r VALUES (7,'reprocesar el evento no crea otro asiento', v_n::text, v_n=1);

  -- ── Ticket 2: FIADO ─────────────────────────────────────────────────────
  PERFORM set_config('gestiona.sale_transaction_id', v_tx2::text, true);
  INSERT INTO public.sale_transactions (id, org_id, source, created_by, occurred_at)
  VALUES (v_tx2, v_org, 'pos', v_dueno, now());
  INSERT INTO public.sales (id, org_id, user_id, product_id, product_name, quantity,
      unit_price_ars, total_ars, cost_of_goods_ars, payment_method, paid,
      source, sale_transaction_id, date)
  VALUES (gen_random_uuid(), v_org, v_dueno, v_prod, 'ZZ Ledger POS', 5, 1000, 5000, 1500,
          'fiado', false, 'pos', v_tx2, now());

  v_e := public.ledger_asentar_venta_pos(
    jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('transaction_id', v_tx2)));

  -- ⚠️ Lo importante: el fiado NO puede entrar a Caja. Si entrara, la caja del
  -- dia sale inflada y el credito contra el cliente desaparece: los dos
  -- errores a la vez.
  SELECT COALESCE(SUM(l.debe),0) INTO v_d FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.entry_id = v_e AND a.codigo = '1.1.01';
  INSERT INTO r VALUES (8,'el fiado NO entra a Caja', v_d::text, v_d = 0);

  SELECT COALESCE(SUM(l.debe),0) INTO v_d FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.entry_id = v_e AND a.codigo = '1.2.01';
  INSERT INTO r VALUES (9,'va a Deudores por ventas', v_d::text, v_d = 5000);

  SELECT COALESCE(SUM(debe),0), COALESCE(SUM(haber),0) INTO v_d, v_h
    FROM public.ledger_lines WHERE entry_id = v_e;
  INSERT INTO r VALUES (10,'y el asiento del fiado tambien cuadra', v_d||' vs '||v_h, v_d = v_h);

  -- ── Ticket 3: cobro dividido con un metodo desconocido ──────────────────
  PERFORM set_config('gestiona.sale_transaction_id', v_tx3::text, true);
  INSERT INTO public.sale_transactions (id, org_id, source, created_by, occurred_at)
  VALUES (v_tx3, v_org, 'pos', v_dueno, now());
  INSERT INTO public.sales (id, org_id, user_id, product_id, product_name, quantity,
      unit_price_ars, total_ars, cost_of_goods_ars, payment_method, paid,
      split_payments, source, sale_transaction_id, date)
  VALUES (gen_random_uuid(), v_org, v_dueno, v_prod, 'ZZ Ledger POS', 10, 1000, 10000, 3000,
          'efectivo', true,
          jsonb_build_array(
            jsonb_build_object('method','efectivo','amount',4000),
            jsonb_build_object('method','transferencia','amount',6000)),
          'pos', v_tx3, now());

  v_e := public.ledger_asentar_venta_pos(
    jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('transaction_id', v_tx3)));

  SELECT COALESCE(SUM(l.debe),0) INTO v_d FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.entry_id = v_e AND a.codigo = '1.1.01';
  INSERT INTO r VALUES (11,'el cobro dividido reparte: 4000 a Caja', v_d::text, v_d = 4000);

  SELECT COALESCE(SUM(l.debe),0) INTO v_d FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id = l.account_id
   WHERE l.entry_id = v_e AND a.codigo = '1.1.02';
  INSERT INTO r VALUES (12,'y 6000 a Banco', v_d::text, v_d = 6000);

  SELECT COALESCE(SUM(debe),0), COALESCE(SUM(haber),0) INTO v_d, v_h
    FROM public.ledger_lines WHERE entry_id = v_e;
  INSERT INTO r VALUES (13,'el dividido cuadra', v_d||' vs '||v_h, v_d = v_h);

  -- ── 14. El mapeo es unico y avisa lo que no conoce ──────────────────────
  INSERT INTO r VALUES (14,'un metodo desconocido devuelve NULL, no un default',
    COALESCE(public.cuenta_de_cobro('bitcoin'),'NULL'),
    public.cuenta_de_cobro('bitcoin') IS NULL);
  INSERT INTO r VALUES (15,'y fiado nunca mapea a una cuenta de caja',
    public.cuenta_de_cobro('fiado'), public.cuenta_de_cobro('fiado') = '1.2.01');

  -- ── 16. La vista de control ─────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_dueno, 'role','authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.ventas_sin_asentar
   WHERE transaction_id IN (v_tx1,v_tx2,v_tx3,v_tx4);
  INSERT INTO r VALUES (16,'las tres figuran asentadas', v_n::text, v_n=0);
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ── 17. Una venta online NO se asienta dos veces ────────────────────────
  -- La orden ya la asienta `ledger_asentar_orden_pagada`; hacerlo tambien desde
  -- el renglon contaria el mismo dinero dos veces.
  INSERT INTO public.sale_transactions (id, org_id, source, created_by, occurred_at)
  VALUES (v_tx4, v_org, 'tienda_online', v_dueno, now());
  v_e := public.ledger_asentar_venta_pos(
    jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('transaction_id', v_tx4)));
  INSERT INTO r VALUES (17,'una venta de la tienda no se asienta por este camino',
    COALESCE(v_e::text,'NULL'), v_e IS NULL);

  -- ── Limpieza ────────────────────────────────────────────────────────────
  -- ⚠️ El chequeo de balance del ledger es un trigger DIFERIDO: mientras haya
  -- eventos pendientes, PostgreSQL no deja hacer ALTER TABLE sobre la tabla.
  -- Forzarlos ahora tambien confirma que los asientos cuadran de verdad: si
  -- alguno no balanceara, esta linea lo haria fallar aca.
  SET CONSTRAINTS ALL IMMEDIATE;
  ALTER TABLE public.ledger_lines   DISABLE TRIGGER trg_ledger_lines_inmutable;
  ALTER TABLE public.ledger_entries DISABLE TRIGGER trg_ledger_entries_inmutable;
  DELETE FROM public.ledger_lines WHERE entry_id IN
    (SELECT id FROM public.ledger_entries WHERE referencia_id IN (v_tx1,v_tx2,v_tx3,v_tx4));
  DELETE FROM public.ledger_entries WHERE referencia_id IN (v_tx1,v_tx2,v_tx3,v_tx4);
  ALTER TABLE public.ledger_lines   ENABLE TRIGGER trg_ledger_lines_inmutable;
  ALTER TABLE public.ledger_entries ENABLE TRIGGER trg_ledger_entries_inmutable;

  ALTER TABLE public.domain_events DISABLE TRIGGER trg_domain_events_inmutable;
  DELETE FROM public.outbox_events WHERE event_id IN
    (SELECT id FROM public.domain_events WHERE aggregate_id IN (v_tx1,v_tx2,v_tx3,v_tx4));
  DELETE FROM public.domain_events WHERE aggregate_id IN (v_tx1,v_tx2,v_tx3,v_tx4);
  ALTER TABLE public.domain_events ENABLE TRIGGER trg_domain_events_inmutable;

  DELETE FROM public.sales WHERE sale_transaction_id IN (v_tx1,v_tx2,v_tx3,v_tx4);
  DELETE FROM public.sale_transactions WHERE id IN (v_tx1,v_tx2,v_tx3,v_tx4);
  DELETE FROM public.stock_movements WHERE product_id = v_prod;
  DELETE FROM public.products WHERE id = v_prod;
END $blk$;

INSERT INTO r
SELECT 18, 'restos',
  ((SELECT count(*) FROM public.products WHERE name LIKE 'ZZ Ledger POS%')
 + (SELECT count(*) FROM public.sales WHERE product_name LIKE 'ZZ Ledger POS%')
 + (SELECT count(*) FROM public.ledger_entries WHERE id NOT IN (SELECT id FROM ent_antes)))::text
 || ' restos',
  ((SELECT count(*) FROM public.products WHERE name LIKE 'ZZ Ledger POS%')
 + (SELECT count(*) FROM public.sales WHERE product_name LIKE 'ZZ Ledger POS%')
 + (SELECT count(*) FROM public.ledger_entries WHERE id NOT IN (SELECT id FROM ent_antes))) = 0;

SELECT n, paso, obtenido, CASE WHEN ok THEN 'OK' ELSE '*** FALLA ***' END AS res
FROM r ORDER BY n;
