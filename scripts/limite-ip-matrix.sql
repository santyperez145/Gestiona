-- Matriz reversible de 20261011002400 (límite por IP en lo público).
--   node scripts/db.mjs --file scripts/limite-ip-matrix.sql
-- Sin IP (desde la base) el límite cae en la tienda: 6 avisos seguidos → el
-- 6º se rechaza; 70 búsquedas seguidas del mismo término → cuenta 60; 40
-- errores → 30. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE zz_li (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_li TO anon;
DO $d$
DECLARE v_owner uuid; v_org uuid; v_tienda text; i int; v_ok int := 0; v_rech int := 0; v_n int;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  v_tienda := 'zz-ip-' || substr(md5(random()::text), 1, 8);
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ ip', 'zz-ip-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active) VALUES (v_org, v_tienda, 'ZZ tienda', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  FOR i IN 1..6 LOOP
    BEGIN
      PERFORM public.pedir_aviso_de_busqueda(v_tienda, 'taladro', 'c' || i || '@ejemplo.com');
      v_ok := v_ok + 1;
    EXCEPTION WHEN SQLSTATE '53400' THEN v_rech := v_rech + 1; END;
  END LOOP;
  INSERT INTO zz_li VALUES ('avisos: aceptados/rechazados (5/1)', v_ok || '/' || v_rech);
  FOR i IN 1..70 LOOP PERFORM public.registrar_busqueda(v_tienda, 'martillo'); END LOOP;
  FOR i IN 1..40 LOOP PERFORM public.registrar_error_app('zz', 'ZZ error repetido', '/x'); END LOOP;
  RESET ROLE;
  SELECT veces INTO v_n FROM public.store_busquedas WHERE org_id = v_org AND termino = 'martillo';
  INSERT INTO zz_li VALUES ('búsquedas contadas (60)', v_n::text);
  SELECT veces INTO v_n FROM public.app_errores WHERE dia = current_date AND mensaje = 'ZZ error repetido';
  INSERT INTO zz_li VALUES ('errores contados (30)', v_n::text);
END $d$;
SELECT * FROM zz_li;
ROLLBACK;
