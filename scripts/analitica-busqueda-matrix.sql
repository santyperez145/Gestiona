-- Matriz reversible de 20261011000700 (analítica de búsqueda).
--   node scripts/db.mjs --file scripts/analitica-busqueda-matrix.sql
-- Un anónimo registra búsquedas con resultado y clics en una tienda ZZ: se
-- normalizan y se cuentan; un clic sin búsqueda previa cuenta también la
-- búsqueda (nunca más clics que búsquedas); términos cortos y tiendas
-- inexistentes no dejan filas; el anónimo no lee la tabla ni la función
-- interna; el dueño lee y no escribe directo. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_ab (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_ab TO anon, authenticated;

DO $d$
DECLARE v_owner uuid; v_org uuid; v_tienda text; v_n int; v_antes int;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  v_tienda := 'zz-analitica-' || substr(md5(random()::text), 1, 8);
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ analitica', 'zz-analitica-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active) VALUES (v_org, v_tienda, 'ZZ tienda', true);
  SELECT count(*) INTO v_antes FROM public.store_busquedas;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  PERFORM public.registrar_busqueda(upper(v_tienda), '  Taladro   INALÁMBRICO ');
  PERFORM public.registrar_busqueda(v_tienda, 'taladro inalambrico');
  PERFORM public.registrar_clic_de_busqueda(v_tienda, 'Taladro inalámbrico');
  PERFORM public.registrar_clic_de_busqueda(v_tienda, 'pintura');
  PERFORM public.registrar_busqueda(v_tienda, 'a');
  PERFORM public.registrar_clic_de_busqueda(v_tienda, 'a');
  PERFORM public.registrar_busqueda('zz-no-existe', 'taladro');
  PERFORM public.registrar_clic_de_busqueda('zz-no-existe', 'taladro');
  BEGIN
    SELECT count(*) INTO v_n FROM public.store_busquedas;
    INSERT INTO zz_ab VALUES ('el anónimo lee la tabla', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_ab VALUES ('el anónimo lee la tabla', 'rechazado');
  END;
  BEGIN
    PERFORM public._busqueda_de_tienda(v_tienda, 'taladro');
    INSERT INTO zz_ab VALUES ('el anónimo usa la función interna', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_ab VALUES ('el anónimo usa la función interna', 'rechazado');
  END;
  RESET ROLE;

  INSERT INTO zz_ab SELECT 'taladro: 2 búsquedas, 1 clic', termino || ' ' || veces || '/' || con_clic
    FROM public.store_busquedas WHERE org_id = v_org AND termino LIKE 'taladro%';
  INSERT INTO zz_ab SELECT 'pintura: clic sin búsqueda cuenta 1/1', termino || ' ' || veces || '/' || con_clic
    FROM public.store_busquedas WHERE org_id = v_org AND termino = 'pintura';
  INSERT INTO zz_ab SELECT 'términos guardados (2, sin cortos)', count(*)::text
    FROM public.store_busquedas WHERE org_id = v_org;
  INSERT INTO zz_ab SELECT 'tienda inexistente no deja filas (2 en total)', (count(*) - v_antes)::text
    FROM public.store_busquedas;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.store_busquedas WHERE org_id = v_org;
  INSERT INTO zz_ab VALUES ('el dueño lee (2)', v_n::text);
  BEGIN
    INSERT INTO public.store_busquedas (org_id, termino, veces) VALUES (v_org, 'zz directo', 1);
    INSERT INTO zz_ab VALUES ('el dueño escribe directo', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_ab VALUES ('el dueño escribe directo', 'rechazado');
  END;
  RESET ROLE;
END $d$;

SELECT * FROM zz_ab;
ROLLBACK;
