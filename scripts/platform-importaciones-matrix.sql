-- Matriz reversible de 20261010002700 (importaciones en Platform).
--   node scripts/db.mjs --file scripts/platform-importaciones-matrix.sql
-- Un administrador de plataforma ve las sesiones con duración y trabadas; un
-- usuario común no ve filas. Sólo lectura; se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_pi (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_pi TO authenticated;

DO $d$
DECLARE v_admin uuid; v_comun uuid; v_n int; v_total int;
BEGIN
  SELECT id INTO v_admin FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT u.id INTO v_comun FROM auth.users u WHERE u.id <> v_admin AND NOT public.is_platform_admin(u.id) ORDER BY created_at LIMIT 1;
  INSERT INTO public.platform_admins (user_id) VALUES (v_admin) ON CONFLICT DO NOTHING;
  SELECT count(*) INTO v_total FROM public.catalog_import_sessions;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.platform_importaciones_catalogo;
  INSERT INTO zz_pi VALUES ('admin ve todas las sesiones (iguales)', v_n || ' de ' || v_total);
  SELECT count(*) INTO v_n FROM public.platform_importaciones_catalogo WHERE trabada;
  INSERT INTO zz_pi VALUES ('trabadas hoy (8: 6 aplicando + 2 validando)', v_n::text);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.platform_importaciones_catalogo;
  INSERT INTO zz_pi VALUES ('usuario común no ve (0)', v_n::text);
  RESET ROLE;
END $d$;

SELECT * FROM zz_pi;
ROLLBACK;
