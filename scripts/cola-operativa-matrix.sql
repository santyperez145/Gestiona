-- Matriz reversible de 20261010003000 (cola operativa con importaciones).
--   node scripts/db.mjs --file scripts/cola-operativa-matrix.sql
-- Un administrador de plataforma ve las importaciones trabadas en la cola (las
-- mismas que `platform_importaciones_catalogo`), con el comercio; las demás
-- fuentes siguen; un usuario común no ve nada. Sólo lectura; se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_co (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_co TO authenticated;

DO $d$
DECLARE v_admin uuid; v_comun uuid; v_n int; v_m int;
BEGIN
  SELECT id INTO v_admin FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT u.id INTO v_comun FROM auth.users u WHERE u.id <> v_admin AND NOT public.is_platform_admin(u.id) ORDER BY created_at LIMIT 1;
  INSERT INTO public.platform_admins (user_id) VALUES (v_admin) ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.platform_operations_queue WHERE source = 'catalog_import';
  SELECT count(*) INTO v_m FROM public.platform_importaciones_catalogo WHERE trabada;
  INSERT INTO zz_co VALUES ('importaciones en la cola = trabadas (iguales)', v_n || ' = ' || v_m);
  INSERT INTO zz_co SELECT 'con comercio y acción (Ferreteria Famatina/review_merchant)', org_name || '/' || recommended_action
    FROM public.platform_operations_queue WHERE source = 'catalog_import' LIMIT 1;
  SELECT count(DISTINCT source) INTO v_n FROM public.platform_operations_queue;
  INSERT INTO zz_co VALUES ('fuentes visibles hoy (≥1)', v_n::text);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.platform_operations_queue;
  INSERT INTO zz_co VALUES ('usuario común no ve (0)', v_n::text);
  RESET ROLE;
END $d$;

SELECT * FROM zz_co;
ROLLBACK;
