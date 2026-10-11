-- Matriz reversible de 20261011002000 (errores de la app).
--   node scripts/db.mjs --file scripts/errores-app-matrix.sql --allow-destructive
-- Un anónimo registra errores: el mismo error con otros números es una sola
-- huella; la ruta pierde query y hash; vacío no deja fila; el anónimo no lee
-- la tabla; un usuario común no ve el resumen; el admin sí. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_ea (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_ea TO anon, authenticated;
DO $d$
DECLARE v_admin uuid; v_comun uuid; v_n int; v_txt text;
BEGIN
  SELECT id INTO v_admin FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT u.id INTO v_comun FROM auth.users u WHERE u.id <> v_admin AND NOT public.is_platform_admin(u.id) ORDER BY created_at LIMIT 1;
  INSERT INTO public.platform_admins (user_id) VALUES (v_admin) ON CONFLICT DO NOTHING;
  DELETE FROM public.app_errores WHERE dia = current_date;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  PERFORM public.registrar_error_app('tienda', 'ZZ no se pudo leer el pedido 1234', '/tienda/zz/orden/1234?token=abc#x');
  PERFORM public.registrar_error_app('tienda', 'ZZ no se pudo leer el pedido 98765', '/tienda/zz/orden/98765');
  PERFORM public.registrar_error_app('panel', 'ZZ otro', '/productos');
  PERFORM public.registrar_error_app('cualquiera', '   ', '/x');
  BEGIN
    SELECT count(*) INTO v_n FROM public.app_errores;
    INSERT INTO zz_ea VALUES ('el anónimo lee la tabla', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_ea VALUES ('el anónimo lee la tabla', 'rechazado'); END;
  RESET ROLE;

  SELECT count(*) INTO v_n FROM public.app_errores WHERE dia = current_date;
  INSERT INTO zz_ea VALUES ('huellas (2: mismo error con otros números es uno)', v_n::text);
  SELECT veces || ' ' || ruta INTO v_txt FROM public.app_errores WHERE dia = current_date AND origen = 'tienda';
  INSERT INTO zz_ea VALUES ('veces y ruta sin query (2 /tienda/zz/orden/1234)', v_txt);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.platform_errores_app(7);
    INSERT INTO zz_ea VALUES ('usuario común ve el resumen', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_ea VALUES ('usuario común ve el resumen', 'rechazado'); END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.platform_errores_app(7) WHERE mensaje LIKE 'ZZ%';
  INSERT INTO zz_ea VALUES ('el admin ve el resumen (2)', v_n::text);
  RESET ROLE;
END $d$;
SELECT * FROM zz_ea;
ROLLBACK;
