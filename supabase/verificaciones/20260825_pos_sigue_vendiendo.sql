-- ⚠️ Revocar permisos no puede haber roto el POS. `create_sales_transaction_v2`
-- llama a `precio_pos_autoritativo` por dentro; si el permiso se evaluara
-- contra el usuario y no contra el dueño de la función, ninguna venta entraría.
-- Se prueba VENDIENDO como el dueño real, no leyendo el catálogo.

CREATE TEMP TABLE r(n int, paso text, obtenido text, ok boolean);
GRANT ALL ON r TO authenticated, anon;
CREATE TEMP TABLE ventas_antes AS SELECT id FROM public.sales;

DO $blk$
DECLARE
  v_org uuid; v_dueno uuid; v_prod uuid := gen_random_uuid();
  v_res jsonb; v_n int; v_tx uuid; v_costo numeric;
BEGIN
  SELECT s.org_id INTO v_org FROM public.ecommerce_stores s WHERE s.slug='exentryimports';
  SELECT m.user_id INTO v_dueno FROM public.memberships m
   WHERE m.org_id=v_org AND m.role IN ('owner','admin') LIMIT 1;

  CREATE TEMP TABLE zz_p AS SELECT * FROM public.products WHERE org_id=v_org LIMIT 1;
  UPDATE zz_p SET id=v_prod, name='ZZ Permisos POS', stock=50, sale_price_ars=5000,
                  discount_price_ars=0, cost_usd=2, tiendanube_id=NULL;
  INSERT INTO public.products SELECT * FROM zz_p;

  -- ── 1. La vista de costo expuesto quedó vacía ───────────────────────────
  SELECT count(*) INTO v_n FROM public.audit_costo_expuesto;
  INSERT INTO r VALUES (1,'ninguna funcion anonima devuelve costo', v_n::text, v_n=0);

  -- ── 2. ⚠️ El POS sigue vendiendo ────────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_dueno, 'role','authenticated')::text, true);

  v_res := public.create_sales_transaction_v2(
    v_org,
    jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'product_name', 'ZZ Permisos POS', 'quantity', 2,
      'unit_price_ars', 5000, 'total_ars', 10000,
      'payment_method', 'efectivo', 'paid', true,
      'user_id', v_dueno, 'org_id', v_org, 'source', 'pos',
      'date', now())),
    'pos');

  INSERT INTO r VALUES (2,'create_sales_transaction_v2 sigue funcionando',
    COALESCE(left(v_res::text,40),'(nada)'), v_res IS NOT NULL);

  SELECT count(*) INTO v_n FROM public.sales
   WHERE product_id = v_prod AND id NOT IN (SELECT id FROM ventas_antes);
  INSERT INTO r VALUES (3,'la venta entro', v_n::text, v_n=1);

  -- ── 3. ⚠️ Y el costo lo puso el SERVIDOR, no el cliente ─────────────────
  -- Es la razon por la que precio_pos_autoritativo existe (C12). Si el REVOKE
  -- la hubiera roto, el costo saldria en cero y el margen seria una mentira
  -- optimista, sin ningun error a la vista.
  SELECT cost_of_goods_ars INTO v_costo FROM public.sales
   WHERE product_id = v_prod AND id NOT IN (SELECT id FROM ventas_antes) LIMIT 1;
  INSERT INTO r VALUES (4,'el servidor siguio calculando el costo',
    COALESCE(v_costo::text,'(null)'), COALESCE(v_costo,0) > 0);

  SELECT sale_transaction_id INTO v_tx FROM public.sales
   WHERE product_id = v_prod AND id NOT IN (SELECT id FROM ventas_antes) LIMIT 1;
  INSERT INTO r VALUES (5,'y agrupo el ticket', COALESCE(v_tx::text,'(null)'), v_tx IS NOT NULL);

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

  DELETE FROM public.sales WHERE product_id = v_prod;
  DELETE FROM public.sale_transactions WHERE id = v_tx;
  DELETE FROM public.stock_movements WHERE product_id = v_prod;
  DELETE FROM public.products WHERE id = v_prod;
END $blk$;

INSERT INTO r
SELECT 6, 'restos',
  ((SELECT count(*) FROM public.products WHERE name LIKE 'ZZ Permisos POS%')
 + (SELECT count(*) FROM public.sales WHERE product_name LIKE 'ZZ Permisos POS%'))::text || ' restos',
  ((SELECT count(*) FROM public.products WHERE name LIKE 'ZZ Permisos POS%')
 + (SELECT count(*) FROM public.sales WHERE product_name LIKE 'ZZ Permisos POS%')) = 0;

SELECT n, paso, obtenido, CASE WHEN ok THEN 'OK' ELSE '*** FALLA ***' END AS res
FROM r ORDER BY n;
