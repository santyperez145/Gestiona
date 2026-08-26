CREATE TEMP TABLE r(n int, paso text, obtenido text, ok boolean);
CREATE TEMP TABLE inv_antes AS SELECT id FROM public.invoices;
CREATE TEMP TABLE set_bk AS
  SELECT org_id, afip_tipo_emisor, exchange_rate FROM public.settings;
CREATE TEMP TABLE cred_bk AS
  SELECT org_id, tipo_emisor FROM public.afip_credentials;

DO $blk$
DECLARE
  v_org uuid; v_dueno uuid; v_prod uuid := gen_random_uuid();
  v_items jsonb; v_res jsonb; v_orden uuid; v_id uuid; v_n int; v_txt text;
BEGIN
  -- ── 1. Los defaults se fueron ───────────────────────────────────────────
  SELECT COALESCE(column_default,'(sin default)') INTO v_txt
    FROM information_schema.columns
   WHERE table_name='settings' AND column_name='afip_tipo_emisor';
  INSERT INTO r VALUES (1,'afip_tipo_emisor ya no adivina monotributo', v_txt, v_txt='(sin default)');

  SELECT COALESCE(column_default,'(sin default)') INTO v_txt
    FROM information_schema.columns
   WHERE table_name='settings' AND column_name='exchange_rate';
  INSERT INTO r VALUES (2,'exchange_rate ya no trae una cotizacion congelada',
    v_txt, v_txt='(sin default)');

  -- ── Preparo una orden cobrada ───────────────────────────────────────────
  SELECT s.org_id INTO v_org FROM public.ecommerce_stores s WHERE s.slug='exentryimports';
  SELECT m.user_id INTO v_dueno FROM public.memberships m
   WHERE m.org_id=v_org AND m.role IN ('owner','admin') LIMIT 1;

  CREATE TEMP TABLE zz_p AS SELECT * FROM public.products WHERE org_id=v_org LIMIT 1;
  UPDATE zz_p SET id=v_prod, name='ZZ Sin Emisor', stock=100, sale_price_ars=10000,
                  discount_price_ars=0, tiendanube_id=NULL;
  INSERT INTO public.products SELECT * FROM zz_p;
  v_items := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1));

  v_res := public.create_store_order_idem(
    'exentryimports', v_items, 'ZZ Comprador', 'zz-emisor@zz.com', NULL,
    jsonb_build_object('calle','ZZ','ciudad','CABA','provincia','AR-C','cp','1425'),
    'transferencia', NULL, NULL, 'retiro', NULL, 'zz-emisor-1');
  SELECT id INTO v_orden FROM public.ecommerce_orders WHERE order_number = v_res->>'order_number';
  UPDATE public.ecommerce_orders SET payment_status='paid' WHERE id=v_orden;

  -- ── 3. ⚠️ SIN condicion frente al IVA no se factura ─────────────────────
  UPDATE public.afip_credentials SET tipo_emisor = NULL WHERE org_id = v_org;
  UPDATE public.settings SET afip_tipo_emisor = NULL WHERE org_id = v_org;

  v_id := public.facturar_orden_pagada(
    jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('order_id', v_orden)));
  INSERT INTO r VALUES (3,'sin condicion frente al IVA NO se emite comprobante',
    COALESCE(v_id::text,'NULL'), v_id IS NULL);

  SELECT count(*) INTO v_n FROM public.invoices WHERE ecommerce_order_id = v_orden;
  INSERT INTO r VALUES (4,'y no queda una factura a medias', v_n::text, v_n=0);

  -- ── 5. Pero la orden queda VISIBLE, con el motivo ───────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_dueno, 'role','authenticated')::text, true);
  SELECT motivo INTO v_txt FROM public.ordenes_sin_facturar WHERE order_id = v_orden;
  INSERT INTO r VALUES (5,'la orden figura pendiente y dice por que',
    COALESCE(v_txt,'(sin motivo)'),
    v_txt = 'falta declarar la condicion frente al IVA del emisor');
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ── 6. Y vender sigue funcionando ───────────────────────────────────────
  -- La orden se creó y se cobró con el emisor en NULL: eso es lo que tiene que
  -- seguir andando. Un comercio empieza a vender el primer día.
  SELECT payment_status INTO v_txt FROM public.ecommerce_orders WHERE id = v_orden;
  INSERT INTO r VALUES (6,'vender sigue funcionando sin configurar AFIP', v_txt, v_txt='paid');

  -- ── 7. Al declararlo, factura ───────────────────────────────────────────
  UPDATE public.afip_credentials SET tipo_emisor = 'responsable_inscripto' WHERE org_id = v_org;
  v_id := public.facturar_orden_pagada(
    jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('order_id', v_orden)));
  INSERT INTO r VALUES (7,'declarada la condicion, la factura sale',
    COALESCE(left(v_id::text,8),'NULL'), v_id IS NOT NULL);

  -- ── 8. ⚠️ Y sale con la clase CORRECTA, no la adivinada ─────────────────
  SELECT tipo_comprobante INTO v_n FROM public.invoices WHERE id = v_id;
  INSERT INTO r VALUES (8,'un responsable inscripto emite B (6), no C (11)',
    v_n::text, v_n = 6);

  -- ── Limpieza ────────────────────────────────────────────────────────────
  ALTER TABLE public.domain_events DISABLE TRIGGER trg_domain_events_inmutable;
  DELETE FROM public.outbox_events WHERE event_id IN
    (SELECT id FROM public.domain_events WHERE aggregate_id IN (v_orden, v_id));
  DELETE FROM public.domain_events WHERE aggregate_id IN (v_orden, v_id);
  ALTER TABLE public.domain_events ENABLE TRIGGER trg_domain_events_inmutable;

  DELETE FROM public.invoices WHERE ecommerce_order_id = v_orden;
  DELETE FROM public.coupon_usages     WHERE order_id = v_orden;
  DELETE FROM public.stock_reservations WHERE order_id = v_orden;
  DELETE FROM public.ecommerce_orders   WHERE id = v_orden;
  DELETE FROM public.idempotency_keys   WHERE clave LIKE 'zz-emisor%';
  DELETE FROM public.stock_movements    WHERE product_id = v_prod;
  DELETE FROM public.products           WHERE id = v_prod;
END $blk$;

-- Restauro la configuración real.
UPDATE public.settings s SET afip_tipo_emisor = b.afip_tipo_emisor, exchange_rate = b.exchange_rate
  FROM set_bk b WHERE s.org_id = b.org_id;
UPDATE public.afip_credentials a SET tipo_emisor = b.tipo_emisor
  FROM cred_bk b WHERE a.org_id = b.org_id;

INSERT INTO r
SELECT 9, 'la configuracion real quedo como estaba',
       count(*)||' diferencias', count(*)=0
FROM (
  SELECT org_id, afip_tipo_emisor, exchange_rate FROM public.settings
  EXCEPT SELECT org_id, afip_tipo_emisor, exchange_rate FROM set_bk) d;

INSERT INTO r
SELECT 10, 'restos',
  ((SELECT count(*) FROM public.products WHERE name LIKE 'ZZ Sin Emisor%')
 + (SELECT count(*) FROM public.invoices WHERE id NOT IN (SELECT id FROM inv_antes)))::text
 || ' restos',
  ((SELECT count(*) FROM public.products WHERE name LIKE 'ZZ Sin Emisor%')
 + (SELECT count(*) FROM public.invoices WHERE id NOT IN (SELECT id FROM inv_antes))) = 0;

SELECT n, paso, obtenido, CASE WHEN ok THEN 'OK' ELSE '*** FALLA ***' END AS res
FROM r ORDER BY n;
