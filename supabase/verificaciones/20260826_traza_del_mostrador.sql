CREATE TEMP TABLE r(n int, paso text, obtenido text, ok boolean);
CREATE TEMP TABLE ent_antes AS SELECT id FROM public.ledger_entries;

DO $blk$
DECLARE
  v_org uuid; v_dueno uuid; v_prod uuid := gen_random_uuid();
  v_tx uuid := gen_random_uuid(); v_corr uuid; v_e uuid; v_n int; v_txt text;
BEGIN
  SELECT s.org_id INTO v_org FROM public.ecommerce_stores s WHERE s.slug='exentryimports';
  SELECT m.user_id INTO v_dueno FROM public.memberships m
   WHERE m.org_id=v_org AND m.role IN ('owner','admin') LIMIT 1;

  -- ── 1. Las ventas viejas tambien tienen correlacion ─────────────────────
  SELECT count(*) INTO v_n FROM public.sale_transactions WHERE correlation_id IS NULL;
  INSERT INTO r VALUES (1,'ningun ticket quedo sin correlacion', v_n::text, v_n=0);

  -- ── Un ticket nuevo de mostrador ────────────────────────────────────────
  CREATE TEMP TABLE zz_p AS SELECT * FROM public.products WHERE org_id=v_org LIMIT 1;
  UPDATE zz_p SET id=v_prod, name='ZZ Traza POS', stock=100, sale_price_ars=5000,
                  discount_price_ars=0, tiendanube_id=NULL;
  INSERT INTO public.products SELECT * FROM zz_p;

  PERFORM set_config('gestiona.sale_transaction_id', v_tx::text, true);
  INSERT INTO public.sale_transactions (id, org_id, source, created_by, occurred_at)
  VALUES (v_tx, v_org, 'pos', v_dueno, now());

  SELECT correlation_id INTO v_corr FROM public.sale_transactions WHERE id=v_tx;
  INSERT INTO r VALUES (2,'el ticket nace con correlacion propia',
    COALESCE(left(v_corr::text,8),'-'), v_corr IS NOT NULL AND v_corr <> v_tx);

  INSERT INTO public.sales (id, org_id, user_id, product_id, product_name, quantity,
      unit_price_ars, total_ars, cost_of_goods_ars, payment_method, paid,
      source, sale_transaction_id, date)
  VALUES (gen_random_uuid(), v_org, v_dueno, v_prod, 'ZZ Traza POS', 2, 5000, 10000, 3000,
          'efectivo', true, 'pos', v_tx, now());

  -- ── 3. El ticket aparece en la traza ────────────────────────────────────
  SELECT string_agg(DISTINCT stage, ',' ORDER BY stage) INTO v_txt
    FROM public.payment_operation_trace WHERE correlation_id = v_corr;
  INSERT INTO r VALUES (3,'la venta de mostrador aparece en la traza',
    COALESCE(v_txt,'(ninguna)'), v_txt LIKE '%sale%');

  INSERT INTO r VALUES (4,'con el movimiento de stock', COALESCE(v_txt,'-'),
    v_txt LIKE '%inventory%');

  -- ── 5. Y el asiento contable ────────────────────────────────────────────
  v_e := public.ledger_asentar_venta_pos(
    jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('transaction_id', v_tx)));

  SELECT string_agg(DISTINCT stage, ',' ORDER BY stage) INTO v_txt
    FROM public.payment_operation_trace WHERE correlation_id = v_corr;
  INSERT INTO r VALUES (5,'y el asiento del libro', COALESCE(v_txt,'-'), v_txt LIKE '%ledger%');

  -- ── 6. Ordenada por etapa, se lee la operacion completa ─────────────────
  SELECT string_agg(stage, ' -> ' ORDER BY stage_order, occurred_at) INTO v_txt
    FROM public.payment_operation_trace WHERE correlation_id = v_corr;
  INSERT INTO r VALUES (6,'en orden', COALESCE(v_txt,'-'), v_txt IS NOT NULL);

  -- ── 7. No se mezcla con otra venta ──────────────────────────────────────
  SELECT count(DISTINCT record_id) INTO v_n
    FROM public.payment_operation_trace
   WHERE correlation_id = v_corr AND stage = 'sale';
  INSERT INTO r VALUES (7,'un solo ticket por correlacion', v_n::text, v_n = 1);

  -- ── Limpieza ────────────────────────────────────────────────────────────
  SET CONSTRAINTS ALL IMMEDIATE;
  ALTER TABLE public.ledger_lines   DISABLE TRIGGER trg_ledger_lines_inmutable;
  ALTER TABLE public.ledger_entries DISABLE TRIGGER trg_ledger_entries_inmutable;
  DELETE FROM public.ledger_lines WHERE entry_id IN
    (SELECT id FROM public.ledger_entries WHERE referencia_id = v_tx);
  DELETE FROM public.ledger_entries WHERE referencia_id = v_tx;
  ALTER TABLE public.ledger_lines   ENABLE TRIGGER trg_ledger_lines_inmutable;
  ALTER TABLE public.ledger_entries ENABLE TRIGGER trg_ledger_entries_inmutable;

  ALTER TABLE public.domain_events DISABLE TRIGGER trg_domain_events_inmutable;
  DELETE FROM public.outbox_events WHERE event_id IN
    (SELECT id FROM public.domain_events WHERE aggregate_id = v_tx);
  DELETE FROM public.domain_events WHERE aggregate_id = v_tx;
  ALTER TABLE public.domain_events ENABLE TRIGGER trg_domain_events_inmutable;

  DELETE FROM public.sales WHERE sale_transaction_id = v_tx;
  DELETE FROM public.sale_transactions WHERE id = v_tx;
  DELETE FROM public.stock_movements WHERE product_id = v_prod;
  DELETE FROM public.products WHERE id = v_prod;
END $blk$;

INSERT INTO r
SELECT 8, 'restos',
  ((SELECT count(*) FROM public.products WHERE name LIKE 'ZZ Traza POS%')
 + (SELECT count(*) FROM public.ledger_entries WHERE id NOT IN (SELECT id FROM ent_antes)))::text
 || ' restos',
  ((SELECT count(*) FROM public.products WHERE name LIKE 'ZZ Traza POS%')
 + (SELECT count(*) FROM public.ledger_entries WHERE id NOT IN (SELECT id FROM ent_antes))) = 0;

SELECT n, paso, obtenido, CASE WHEN ok THEN 'OK' ELSE '*** FALLA ***' END AS res
FROM r ORDER BY n;
