CREATE TEMP TABLE r(n int, paso text, obtenido text, ok boolean);
GRANT ALL ON r TO authenticated, anon;

DO $blk$
DECLARE v_org uuid; v_dueno uuid; v_n int; v_txt text; v_num numeric;
BEGIN
  SELECT s.org_id INTO v_org FROM public.ecommerce_stores s WHERE s.slug='exentryimports';
  SELECT m.user_id INTO v_dueno FROM public.memberships m
   WHERE m.org_id=v_org AND m.role IN ('owner','admin') LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_dueno, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- ── 1. El comercio ve el costo de cada medio ────────────────────────────
  SELECT count(*) INTO v_n FROM public.costos_por_medio_de_pago WHERE org_id = v_org;
  INSERT INTO r VALUES (1,'el comercio ve el costo de cada medio', v_n::text, v_n > 0);

  -- ── 2. Con el IVA de la comision incluido ───────────────────────────────
  -- 6,29% + 21% de IVA = 7,6109%. Sin sumar el IVA el numero miente por un 21%.
  SELECT costo_proveedor_pct INTO v_num FROM public.costos_por_medio_de_pago
   WHERE org_id=v_org AND provider='mercadopago' AND medio='credit' AND cuotas=0;
  INSERT INTO r VALUES (2,'el costo lleva el IVA de la comision',
    COALESCE(v_num::text,'-'), ROUND(v_num,2) = ROUND(6.29*1.21,2));

  -- ── 3. Y dice cuanto le queda de cada 100 ───────────────────────────────
  SELECT neto_cada_100 INTO v_num FROM public.costos_por_medio_de_pago
   WHERE org_id=v_org AND provider='mercadopago' AND medio='credit' AND cuotas=0;
  INSERT INTO r VALUES (3,'y cuanto le queda de cada $100', COALESCE(v_num::text,'-'),
    v_num > 90 AND v_num < 93);

  -- ── 4. ⚠️ 12 cuotas cuesta MUCHO mas que 1 pago ─────────────────────────
  -- Es el dato que decide un precio y el que nadie veia.
  SELECT costo_total_pct INTO v_num FROM public.costos_por_medio_de_pago
   WHERE org_id=v_org AND provider='mercadopago' AND medio='credit' AND cuotas=12;
  INSERT INTO r VALUES (4,'12 cuotas se ve como lo que cuesta',
    COALESCE(v_num::text,'-'), v_num > 20);

  -- ── 5. Y las tarifas dicen que no estan verificadas ─────────────────────
  SELECT count(*) INTO v_n FROM public.costos_por_medio_de_pago
   WHERE org_id=v_org AND provider='mercadopago' AND NOT sin_verificar;
  INSERT INTO r VALUES (5,'ninguna tarifa de MP se presenta como verificada', v_n::text, v_n=0);

  SELECT fuente INTO v_txt FROM public.costos_por_medio_de_pago
   WHERE org_id=v_org AND provider='mercadopago' LIMIT 1;
  INSERT INTO r VALUES (6,'y dicen de donde salieron', COALESCE(left(v_txt,40),'(sin fuente)'),
    v_txt IS NOT NULL);

  -- ── 7. Lo que el proveedor cobro de verdad ──────────────────────────────
  SELECT count(*) INTO v_n FROM public.comisiones_cobradas WHERE org_id = v_org;
  INSERT INTO r VALUES (7,'los cobros reales se ven', v_n::text, v_n = 2);

  SELECT costo_total_real_pct INTO v_num FROM public.comisiones_cobradas
   WHERE org_id=v_org LIMIT 1;
  INSERT INTO r VALUES (8,'con el costo real en porcentaje', COALESCE(v_num::text,'-'),
    v_num IS NOT NULL);

  -- ── 9. ⚠️ Y avisa que con $1 el porcentaje no significa nada ────────────
  SELECT bool_and(monto_muy_chico_para_comparar) INTO v_txt FROM public.comisiones_cobradas
   WHERE org_id = v_org;
  INSERT INTO r VALUES (9,'marca que $1 es muy chico para comparar', v_txt, v_txt='true');

  -- ── 10. El desvio se ve, y dice si es puro redondeo ─────────────────────
  SELECT solo_montos_chicos::text INTO v_txt FROM public.desvio_de_comisiones
   WHERE org_id=v_org LIMIT 1;
  INSERT INTO r VALUES (10,'el desvio avisa si es solo redondeo',
    COALESCE(v_txt,'(sin datos)'), v_txt = 'true');

  RESET ROLE;

  -- ── 11. ⚠️ Un ajeno no ve los costos de otro comercio ───────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.costos_por_medio_de_pago;
  INSERT INTO r VALUES (11,'un ajeno no ve costos de otro comercio', v_n::text, v_n=0);
  SELECT count(*) INTO v_n FROM public.comisiones_cobradas;
  INSERT INTO r VALUES (12,'ni sus cobros', v_n::text, v_n=0);
  RESET ROLE;

  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_n FROM public.costos_por_medio_de_pago;
    INSERT INTO r VALUES (13,'anon tampoco', v_n||' filas', v_n=0);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO r VALUES (13,'anon tampoco', 'permiso denegado', true);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
END $blk$;

SELECT n, paso, obtenido, CASE WHEN ok THEN 'OK' ELSE '*** FALLA ***' END AS res
FROM r ORDER BY n;
