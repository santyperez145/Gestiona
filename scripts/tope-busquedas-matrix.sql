-- Matriz reversible de 20261011002300 (tope de términos por día).
--   node scripts/db.mjs --file scripts/tope-busquedas-matrix.sql
-- Un anónimo manda 2.000 términos distintos a una tienda ZZ (con y sin
-- resultado): el 2.001 se ignora y uno que ya existía sigue sumando. Todo se
-- revierte.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE zz_tb (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_tb TO anon;
DO $d$
DECLARE v_owner uuid; v_org uuid; v_tienda text; i int;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  v_tienda := 'zz-tope-' || substr(md5(random()::text), 1, 8);
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ tope', 'zz-tope-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active) VALUES (v_org, v_tienda, 'ZZ tienda', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  FOR i IN 1..2000 LOOP
    PERFORM public.registrar_busqueda(v_tienda, 'termino ' || i);
    PERFORM public.registrar_busqueda_sin_resultado(v_tienda, 'nada ' || i);
  END LOOP;
  PERFORM public.registrar_busqueda(v_tienda, 'termino extra');
  PERFORM public.registrar_busqueda_sin_resultado(v_tienda, 'nada extra');
  PERFORM public.registrar_clic_de_busqueda(v_tienda, 'clic extra');
  PERFORM public.registrar_pedido_de_busqueda(v_tienda, ARRAY['pedido extra']);
  PERFORM public.registrar_busqueda(v_tienda, 'termino 7');
  RESET ROLE;
  INSERT INTO zz_tb SELECT 'con resultado: filas (2000)', count(*)::text FROM public.store_busquedas WHERE org_id = v_org;
  INSERT INTO zz_tb SELECT 'sin resultado: filas (2000)', count(*)::text FROM public.store_busquedas_sin_resultado WHERE org_id = v_org;
  INSERT INTO zz_tb SELECT 'términos nuevos después del tope (0)', count(*)::text FROM public.store_busquedas WHERE org_id = v_org AND termino LIKE '%extra';
  INSERT INTO zz_tb SELECT 'uno existente sigue sumando (2)', veces::text FROM public.store_busquedas WHERE org_id = v_org AND termino = 'termino 7';
END $d$;
SELECT * FROM zz_tb;
ROLLBACK;
