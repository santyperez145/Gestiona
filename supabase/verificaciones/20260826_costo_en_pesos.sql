CREATE TEMP TABLE r(n int, paso text, obtenido text, ok boolean);
CREATE TEMP TABLE ent_antes AS SELECT id FROM public.ledger_entries;

DO $blk$
DECLARE
  v_org uuid; v_dueno uuid;
  v_pesos uuid := gen_random_uuid();   -- producto comprado en pesos
  v_dolar uuid := gen_random_uuid();   -- producto importado
  v_tx uuid := gen_random_uuid();
  v_res jsonb; v_num numeric; v_txt text; v_n int; v_e uuid;
BEGIN
  SELECT s.org_id INTO v_org FROM public.ecommerce_stores s WHERE s.slug='exentryimports';
  SELECT m.user_id INTO v_dueno FROM public.memberships m
   WHERE m.org_id=v_org AND m.role IN ('owner','admin') LIMIT 1;

  CREATE TEMP TABLE zz_p AS SELECT * FROM public.products WHERE org_id=v_org LIMIT 1;

  -- Un producto que se compra en PESOS: harina a $8.000, sin dolar de por medio.
  UPDATE zz_p SET id=v_pesos, name='ZZ Harina', sku='ZZ-HAR', stock=100,
                  sale_price_ars=12000, discount_price_ars=0, tiendanube_id=NULL,
                  cost_usd=0, total_cost_usd=0;
  INSERT INTO public.products SELECT * FROM zz_p;
  UPDATE public.products SET cost_ars=8000, cost_currency='ARS',
                             markup_pct=50, markup_mode='sobre_costo'
   WHERE id=v_pesos;

  -- Un producto importado: US$20.
  DELETE FROM zz_p;
  INSERT INTO zz_p SELECT * FROM public.products WHERE id=v_pesos;
  UPDATE zz_p SET id=v_dolar, name='ZZ Importado', sku='ZZ-IMP',
                  cost_ars=NULL, cost_currency='USD', cost_usd=20, total_cost_usd=20;
  INSERT INTO public.products SELECT * FROM zz_p;

  -- ── 1. El costo en pesos NO pasa por el dolar ───────────────────────────
  v_res := public.costo_unitario_ars(v_org, v_pesos, NULL);
  INSERT INTO r VALUES (1,'un producto en pesos cuesta lo que dice',
    COALESCE(v_res->>'costo_ars','-'), (v_res->>'costo_ars')::numeric = 8000);

  INSERT INTO r VALUES (2,'y NO usa tipo de cambio',
    COALESCE(v_res->>'tipo_cambio','NULL'), v_res->>'tipo_cambio' IS NULL);

  -- ── 3. El importado si convierte ────────────────────────────────────────
  v_res := public.costo_unitario_ars(v_org, v_dolar, NULL);
  INSERT INTO r VALUES (3,'el importado convierte a la cotizacion',
    COALESCE(v_res->>'costo_ars','-'),
    (v_res->>'costo_ars')::numeric = 20 * (v_res->>'tipo_cambio')::numeric);

  -- ── 4. ⚠️ El POS ya no da margen perfecto sobre un producto en pesos ────
  v_res := public.precio_pos_autoritativo(v_org, v_pesos, NULL, 1);
  INSERT INTO r VALUES (4,'el POS toma el costo en pesos',
    COALESCE(v_res->>'costo_ars','-'), (v_res->>'costo_ars')::numeric = 8000);
  INSERT INTO r VALUES (5,'y dice en que moneda esta',
    COALESCE(v_res->>'moneda_costo','-'), v_res->>'moneda_costo' = 'ARS');

  -- ── 6. Las dos convenciones de ganancia dan numeros DISTINTOS ───────────
  INSERT INTO r VALUES (6,'markup sobre costo: 8000 + 50% = 12000',
    public.precio_sugerido(8000, 50, 'sobre_costo')::text,
    public.precio_sugerido(8000, 50, 'sobre_costo') = 12000);
  INSERT INTO r VALUES (7,'margen sobre precio: 8000 / (1-0,5) = 16000',
    public.precio_sugerido(8000, 50, 'sobre_precio')::text,
    public.precio_sugerido(8000, 50, 'sobre_precio') = 16000);
  INSERT INTO r VALUES (8,'un margen del 100% sobre precio no tiene solucion',
    COALESCE(public.precio_sugerido(8000, 100, 'sobre_precio')::text,'NULL'),
    public.precio_sugerido(8000, 100, 'sobre_precio') IS NULL);

  -- ── 9. ⚠️ El movimiento CONGELA el costo en pesos ───────────────────────
  --
  -- Por el camino REAL. La primera version insertaba la venta directo y el paso
  -- 10 fallaba: el ledger del POS lee `sales.cost_of_goods_ars`, que lo calcula
  -- `create_sales_transaction_v2` desde `precio_pos_autoritativo`. Insertando a
  -- mano ese campo queda en cero y el test medía su propio atajo, no el sistema.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_dueno, 'role','authenticated')::text, true);

  v_res := public.create_sales_transaction_v2(
    v_org,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_pesos, 'product_name', 'ZZ Harina', 'quantity', 2,
      'unit_price_ars', 12000, 'total_ars', 24000,
      'payment_method', 'efectivo', 'paid', true,
      'user_id', v_dueno, 'org_id', v_org, 'source', 'pos',
      'date', now())),
    'pos');

  SELECT sale_transaction_id INTO v_tx FROM public.sales
   WHERE product_id = v_pesos ORDER BY created_at DESC LIMIT 1;

  SELECT unit_cost_ars INTO v_num FROM public.stock_movements
   WHERE product_id = v_pesos ORDER BY created_at DESC LIMIT 1;
  INSERT INTO r VALUES (9,'el movimiento guarda el costo en pesos',
    COALESCE(v_num::text,'NULL'), v_num = 8000);

  -- Y el servidor calculó el costo de la venta con la moneda correcta.
  SELECT cost_of_goods_ars INTO v_num FROM public.sales
   WHERE product_id = v_pesos ORDER BY created_at DESC LIMIT 1;
  INSERT INTO r VALUES (13,'la venta guarda 2 x 8000 = 16000 de costo',
    COALESCE(v_num::text,'NULL'), v_num = 16000);

  -- ── 10. Y el asiento lleva costo, no cero ───────────────────────────────
  v_e := public.ledger_asentar_venta_pos(
    jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('transaction_id', v_tx)));
  SELECT COALESCE(SUM(l.debe),0) INTO v_num FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id=l.account_id
   WHERE l.entry_id = v_e AND a.codigo = '5.1.01';
  INSERT INTO r VALUES (10,'el asiento del producto en pesos lleva costo',
    v_num::text, v_num > 0);

  -- ── 11. La vista de productos sin costo utilizable ──────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_dueno, 'role','authenticated')::text, true);
  SELECT count(*) INTO v_n FROM public.productos_sin_costo_utilizable
   WHERE product_id IN (v_pesos, v_dolar);
  INSERT INTO r VALUES (11,'los dos productos tienen costo utilizable', v_n::text, v_n=0);
  PERFORM set_config('request.jwt.claims', NULL, true);

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
  DELETE FROM public.stock_movements WHERE product_id IN (v_pesos, v_dolar);
  DELETE FROM public.products WHERE id IN (v_pesos, v_dolar);
END $blk$;

INSERT INTO r
SELECT 12, 'restos',
  ((SELECT count(*) FROM public.products WHERE name LIKE 'ZZ Harina%' OR name LIKE 'ZZ Importado%')
 + (SELECT count(*) FROM public.ledger_entries WHERE id NOT IN (SELECT id FROM ent_antes)))::text
 || ' restos',
  ((SELECT count(*) FROM public.products WHERE name LIKE 'ZZ Harina%' OR name LIKE 'ZZ Importado%')
 + (SELECT count(*) FROM public.ledger_entries WHERE id NOT IN (SELECT id FROM ent_antes))) = 0;

SELECT n, paso, obtenido, CASE WHEN ok THEN 'OK' ELSE '*** FALLA ***' END AS res
FROM r ORDER BY n;
