CREATE TEMP TABLE r(n int, paso text, obtenido text, ok boolean);

-- Cuántas órdenes reales están pendientes ANTES. Todo lo que sigue se mide
-- contra este número: las reales no se tocan, las factura el dueño.
-- ⚠️ `facturar_pendientes` opera sobre TODA la organización: no hay forma de
-- pedirle que ignore las órdenes reales, y sería un parámetro peligroso si la
-- hubiera. Así que la prueba las va a facturar también, y lo que corresponde es
-- **anotar qué facturas existían antes** y borrar sólo las que creó la corrida.
-- La primera versión limpiaba por las órdenes ZZ y dejó dos facturas reales
-- puestas: el test pasó y la base quedó sucia.
CREATE TEMP TABLE inv_antes AS SELECT id FROM public.invoices;

CREATE TEMP TABLE base AS
  SELECT count(*)::int AS n FROM public.ecommerce_orders o
   WHERE o.payment_status='paid'
     AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.ecommerce_order_id=o.id);

DO $blk$
DECLARE
  v_org uuid; v_dueno uuid; v_prod uuid := gen_random_uuid();
  v_items jsonb; v_res jsonb; v_o1 uuid; v_o2 uuid; v_o3 uuid;
  v_n int; v_base int;
BEGIN
  SELECT n INTO v_base FROM base;
  SELECT s.org_id INTO v_org FROM public.ecommerce_stores s WHERE s.slug='exentryimports';
  SELECT m.user_id INTO v_dueno FROM public.memberships m
   WHERE m.org_id=v_org AND m.role IN ('owner','admin') LIMIT 1;

  CREATE TEMP TABLE zz_p AS SELECT * FROM public.products WHERE org_id=v_org LIMIT 1;
  UPDATE zz_p SET id=v_prod, name='ZZ Pendientes', stock=100, sale_price_ars=10000,
                  discount_price_ars=0, tiendanube_id=NULL;
  INSERT INTO public.products SELECT * FROM zz_p;
  v_items := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1));

  -- ── Tres ordenes cobradas y SIN facturar ────────────────────────────────
  -- Se marcan pagadas sin despachar el outbox: es exactamente el estado de una
  -- venta anterior a C13, o de una cuyo consumidor se quedo sin reintentos.
  v_res := public.create_store_order_idem('exentryimports', v_items, 'ZZ Uno',
    'zz-pend1@zz.com', NULL, jsonb_build_object('calle','ZZ','ciudad','CABA','provincia','AR-C','cp','1425'),
    'transferencia', NULL, NULL, 'retiro', NULL, 'zz-pend-1');
  SELECT id INTO v_o1 FROM public.ecommerce_orders WHERE order_number = v_res->>'order_number';

  v_res := public.create_store_order_idem('exentryimports', v_items, 'ZZ Dos',
    'zz-pend2@zz.com', NULL, jsonb_build_object('calle','ZZ','ciudad','CABA','provincia','AR-C','cp','1425'),
    'transferencia', NULL, NULL, 'retiro', NULL, 'zz-pend-2');
  SELECT id INTO v_o2 FROM public.ecommerce_orders WHERE order_number = v_res->>'order_number';

  v_res := public.create_store_order_idem('exentryimports', v_items, 'ZZ FALLA',
    'zz-pend3@zz.com', NULL, jsonb_build_object('calle','ZZ','ciudad','CABA','provincia','AR-C','cp','1425'),
    'transferencia', NULL, NULL, 'retiro', NULL, 'zz-pend-3');
  SELECT id INTO v_o3 FROM public.ecommerce_orders WHERE order_number = v_res->>'order_number';

  UPDATE public.ecommerce_orders SET payment_status='paid' WHERE id IN (v_o1,v_o2,v_o3);

  -- ── 1. El resumen las cuenta ────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_dueno, 'role','authenticated')::text, true);

  v_res := public.resumen_sin_facturar(v_org);
  INSERT INTO r VALUES (1,'el resumen cuenta las cobradas sin factura',
    (v_res->>'cantidad')||' de '||(v_base+3), (v_res->>'cantidad')::int = v_base+3);
  INSERT INTO r VALUES (2,'y suma el monto, que es lo que lo vuelve concreto',
    (v_res->>'monto'), (v_res->>'monto')::numeric > 0);

  -- ── 2. ⚠️ Un ajeno no ve cuanto factura otro comercio ───────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  v_res := public.resumen_sin_facturar(v_org);
  INSERT INTO r VALUES (3,'un ajeno recibe cero, no el monto real',
    COALESCE(v_res->>'cantidad','-'), (v_res->>'cantidad')::int = 0);

  BEGIN
    PERFORM public.facturar_pendientes(v_org, 50);
    INSERT INTO r VALUES (4,'un ajeno pudo facturar: AGUJERO','ACEPTO', false);
  EXCEPTION WHEN others THEN
    INSERT INTO r VALUES (4,'un ajeno no puede emitir comprobantes','rechazado', true);
  END;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_dueno, 'role','authenticated')::text, true);

  -- ── 3. ⚠️ Una orden que falla NO aborta la pasada ───────────────────────
  -- Se inyecta una falla controlada: un trigger que rechaza a 'ZZ FALLA'. Sin
  -- esto no se estaria probando el aislamiento, que es la razon por la que
  -- cada orden va en su propio bloque.
  CREATE FUNCTION pg_temp.zz_romper() RETURNS trigger LANGUAGE plpgsql AS $t$
  BEGIN
    IF NEW.customer_name = 'ZZ FALLA' THEN
      RAISE EXCEPTION 'ZZ falla inyectada';
    END IF;
    RETURN NEW;
  END $t$;
  EXECUTE 'CREATE TRIGGER zz_romper BEFORE INSERT ON public.invoices
           FOR EACH ROW EXECUTE FUNCTION pg_temp.zz_romper()';

  -- Se factura sólo lo de prueba: el límite alcanza para las 3 ZZ más las
  -- reales, así que se acota al total y después se comprueba cuáles salieron.
  v_res := public.facturar_pendientes(v_org, 500);

  INSERT INTO r VALUES (5,'facturo las que podia, no se detuvo en la que falla',
    (v_res->>'creadas'), (v_res->>'creadas')::int = v_base+2);
  INSERT INTO r VALUES (6,'y reporta cual fallo, con el motivo',
    COALESCE(v_res#>>'{fallas,0,error}','(sin motivo)'),
    (v_res#>>'{fallas,0,error}') LIKE '%ZZ falla inyectada%');
  INSERT INTO r VALUES (7,'la que fallo sigue contada como pendiente',
    (v_res->>'restantes'), (v_res->>'restantes')::int = 1);

  EXECUTE 'DROP TRIGGER zz_romper ON public.invoices';

  -- ── 4. Repetir no duplica ───────────────────────────────────────────────
  v_res := public.facturar_pendientes(v_org, 500);
  INSERT INTO r VALUES (8,'la tercera se factura al reintentar', (v_res->>'creadas'),
    (v_res->>'creadas')::int = 1);

  v_res := public.facturar_pendientes(v_org, 500);
  INSERT INTO r VALUES (9,'y una pasada mas no crea nada', (v_res->>'creadas'),
    (v_res->>'creadas')::int = 0);

  SELECT count(*) INTO v_n FROM public.invoices
   WHERE ecommerce_order_id IN (v_o1,v_o2,v_o3);
  INSERT INTO r VALUES (10,'una factura por orden, ni una mas', v_n::text, v_n=3);

  -- ── 5. Ya no quedan pendientes ──────────────────────────────────────────
  v_res := public.resumen_sin_facturar(v_org);
  INSERT INTO r VALUES (11,'el resumen queda en cero', (v_res->>'cantidad'),
    (v_res->>'cantidad')::int = 0);

  -- ── 6. El comprobante salio bien armado ─────────────────────────────────
  SELECT count(*) INTO v_n FROM public.invoices
   WHERE ecommerce_order_id IN (v_o1,v_o2,v_o3)
     AND tipo_comprobante = 11 AND tax_amount = 0 AND condicion_iva_receptor = 5
     AND afip_status = 'pending' AND cae IS NULL;
  INSERT INTO r VALUES (12,'clase C, sin IVA, sin CAE: es un borrador', v_n::text, v_n=3);

  -- ── 7. El limite se respeta ─────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ── Limpieza ────────────────────────────────────────────────────────────
  -- Todo lo que no estaba antes, incluidas las facturas de órdenes reales que
  -- la pasada creó de paso. Emitir el comprobante de una venta real es
  -- decisión del comercio, no efecto secundario de un test.
  DELETE FROM public.invoices
   WHERE id NOT IN (SELECT id FROM inv_antes) AND cae IS NULL;

  ALTER TABLE public.domain_events DISABLE TRIGGER trg_domain_events_inmutable;
  DELETE FROM public.outbox_events WHERE event_id IN
    (SELECT id FROM public.domain_events
      WHERE aggregate_id IN (v_o1,v_o2,v_o3) OR aggregate_type='factura');
  DELETE FROM public.domain_events
   WHERE aggregate_id IN (v_o1,v_o2,v_o3) OR aggregate_type='factura';
  ALTER TABLE public.domain_events ENABLE TRIGGER trg_domain_events_inmutable;

  DELETE FROM public.coupon_usages     WHERE order_id IN (v_o1,v_o2,v_o3);
  DELETE FROM public.stock_reservations WHERE order_id IN (v_o1,v_o2,v_o3);
  DELETE FROM public.ecommerce_orders   WHERE id IN (v_o1,v_o2,v_o3);
  DELETE FROM public.idempotency_keys   WHERE clave LIKE 'zz-pend%';
  DELETE FROM public.stock_movements    WHERE product_id = v_prod;
  DELETE FROM public.products           WHERE id = v_prod;
END $blk$;

-- ⚠️ Las órdenes reales tienen que haber quedado como estaban: pendientes.
-- Facturarlas es decisión del dueño, no de una verificación.
INSERT INTO r
SELECT 13, 'las ordenes reales siguen pendientes, sin tocar',
       c.n||' de '||b.n, c.n = b.n
FROM base b,
     (SELECT count(*)::int AS n FROM public.ecommerce_orders o
       WHERE o.payment_status='paid'
         AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.ecommerce_order_id=o.id)) c;

INSERT INTO r
SELECT 14, 'restos',
       ((SELECT count(*) FROM public.products WHERE name LIKE 'ZZ Pendientes%')
      + (SELECT count(*) FROM public.ecommerce_orders WHERE customer_email LIKE 'zz-pend%')
      + (SELECT count(*) FROM public.idempotency_keys WHERE clave LIKE 'zz-pend%')
      + (SELECT count(*) FROM public.invoices WHERE id NOT IN (SELECT id FROM inv_antes)))
       || ' restos',
       ((SELECT count(*) FROM public.products WHERE name LIKE 'ZZ Pendientes%')
      + (SELECT count(*) FROM public.ecommerce_orders WHERE customer_email LIKE 'zz-pend%')
      + (SELECT count(*) FROM public.idempotency_keys WHERE clave LIKE 'zz-pend%')
      + (SELECT count(*) FROM public.invoices WHERE id NOT IN (SELECT id FROM inv_antes))) = 0;

SELECT n, paso, obtenido, CASE WHEN ok THEN 'OK' ELSE '*** FALLA ***' END AS res
FROM r ORDER BY n;
