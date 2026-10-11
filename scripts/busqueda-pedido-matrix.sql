-- Matriz reversible de 20261011001100 (búsquedas que terminan en pedido).
--   node scripts/db.mjs --file scripts/busqueda-pedido-matrix.sql
-- En una tienda ZZ: «taladro» se buscó 3 veces y se abrió 2; un pedido con
-- «Taladro» (repetido) y «pintura» (sin búsqueda previa) suma 1 a cada uno sin
-- pasar nunca a las búsquedas; términos cortos, más de 10 y tiendas
-- inexistentes no dejan filas. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_bp (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_bp TO anon, authenticated;

DO $d$
DECLARE v_owner uuid; v_org uuid; v_tienda text; v_n int; v_txt text;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  v_tienda := 'zz-pedido-' || substr(md5(random()::text), 1, 8);
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ pedido', 'zz-pedido-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active) VALUES (v_org, v_tienda, 'ZZ tienda', true);

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  PERFORM public.registrar_busqueda(v_tienda, 'taladro');
  PERFORM public.registrar_busqueda(v_tienda, 'taladro');
  PERFORM public.registrar_busqueda(v_tienda, 'taladro');
  PERFORM public.registrar_clic_de_busqueda(v_tienda, 'taladro');
  PERFORM public.registrar_clic_de_busqueda(v_tienda, 'taladro');
  PERFORM public.registrar_pedido_de_busqueda(v_tienda, ARRAY['Taladro', 'taladro', 'pintura', 'a']);
  PERFORM public.registrar_pedido_de_busqueda('zz-no-existe', ARRAY['taladro']);
  PERFORM public.registrar_pedido_de_busqueda(v_tienda, ARRAY['t01','t02','t03','t04','t05','t06','t07','t08','t09','t10','t11','t12']);
  PERFORM public.registrar_pedido_de_busqueda(v_tienda, NULL);
  RESET ROLE;

  SELECT termino || ' ' || veces || '/' || con_clic || '/' || con_pedido INTO v_txt FROM public.store_busquedas WHERE org_id = v_org AND termino = 'taladro';
  INSERT INTO zz_bp VALUES ('taladro 3/2/1 (repetido cuenta una vez)', v_txt);
  SELECT termino || ' ' || veces || '/' || con_clic || '/' || con_pedido INTO v_txt FROM public.store_busquedas WHERE org_id = v_org AND termino = 'pintura';
  INSERT INTO zz_bp VALUES ('pintura 1/1/1 (nunca más pedidos que búsquedas)', v_txt);
  SELECT count(*) INTO v_n FROM public.store_busquedas WHERE org_id = v_org AND termino ~ '^t[0-9]+$';
  INSERT INTO zz_bp VALUES ('tope de 10 términos por pedido (10)', v_n::text);
  SELECT count(*) INTO v_n FROM public.store_busquedas WHERE org_id = v_org AND char_length(termino) < 2;
  INSERT INTO zz_bp VALUES ('términos cortos (0)', v_n::text);
  SELECT count(*) INTO v_n FROM public.store_busquedas WHERE org_id = v_org AND con_pedido > veces;
  INSERT INTO zz_bp VALUES ('filas con más pedidos que búsquedas (0)', v_n::text);
END $d$;

SELECT * FROM zz_bp;
ROLLBACK;
