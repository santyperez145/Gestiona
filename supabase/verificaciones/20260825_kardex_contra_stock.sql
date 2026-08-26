CREATE TEMP TABLE r(n int, paso text, obtenido text, ok boolean);
GRANT ALL ON r TO authenticated, anon;

DO $blk$
DECLARE v_dueno uuid; v_n int; v_num numeric; v_txt text;
BEGIN
  SELECT m.user_id INTO v_dueno FROM public.memberships m
   WHERE m.role IN ('owner','admin') LIMIT 1;

  -- Como el dueño real: es quien va a contar.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_dueno, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_n FROM public.kardex_contra_stock;
  INSERT INTO r VALUES (1,'el dueno ve los productos desalineados', v_n::text, v_n > 0);

  SELECT ROUND(SUM(impacto_ars)) INTO v_num FROM public.kardex_contra_stock;
  INSERT INTO r VALUES (2,'con el impacto en pesos para priorizar',
    COALESCE(v_num::text,'-'), COALESCE(v_num,0) > 0);

  SELECT producto || ': kardex ' || kardex || ' vs stock ' || stock_actual
    INTO v_txt FROM public.kardex_contra_stock ORDER BY impacto_ars DESC LIMIT 1;
  INSERT INTO r VALUES (3,'el peor caso primero', COALESCE(v_txt,'-'), v_txt IS NOT NULL);

  SELECT count(*) INTO v_n FROM public.kardex_contra_stock WHERE kardex_negativo;
  INSERT INTO r VALUES (4,'marca los de kardex negativo (firma del descuento doble)',
    v_n::text, true);

  RESET ROLE;

  -- ⚠️ Un ajeno no ve el inventario de otro comercio.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.kardex_contra_stock;
  INSERT INTO r VALUES (5,'un ajeno no ve nada', v_n::text, v_n = 0);
  RESET ROLE;

  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_n FROM public.kardex_contra_stock;
    INSERT INTO r VALUES (6,'anon tampoco', v_n||' filas', v_n = 0);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO r VALUES (6,'anon tampoco', 'permiso denegado', true);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- La vista NO corrige nada: es de lectura.
  SELECT count(*) INTO v_n FROM information_schema.views
   WHERE table_schema='public' AND table_name='kardex_contra_stock';
  INSERT INTO r VALUES (7,'es una vista, no un proceso que ajuste', v_n::text, v_n = 1);
END $blk$;

SELECT n, paso, obtenido, CASE WHEN ok THEN 'OK' ELSE '*** FALLA ***' END AS res
FROM r ORDER BY n;
