-- Matriz reversible de 20261010002600 (entrevistas E2).
--   node scripts/db.mjs --file scripts/entrevistas-e2-matrix.sql
-- Un administrador de plataforma carga y lee; un usuario común no ve ni
-- escribe; una puerta inventada se rechaza. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_e2 (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_e2 TO authenticated;

DO $d$
DECLARE v_admin uuid; v_comun uuid; v_n int;
BEGIN
  SELECT id INTO v_admin FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT u.id INTO v_comun FROM auth.users u WHERE u.id <> v_admin AND NOT public.is_platform_admin(u.id) ORDER BY created_at LIMIT 1;
  INSERT INTO public.platform_admins (user_id) VALUES (v_admin) ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.entrevistas_e2 (puerta, comercio, herramientas, margen_sin_respuesta)
    VALUES ('catalogo_grande', 'ZZ Ferretería', ARRAY['Excel', 'Tango', 'Tiendanube'], true);
  SELECT count(*) INTO v_n FROM public.entrevistas_e2 WHERE comercio = 'ZZ Ferretería';
  INSERT INTO zz_e2 VALUES ('admin carga y lee (1)', v_n::text);
  INSERT INTO zz_e2 SELECT 'guarda quién la cargó (sí)', CASE WHEN created_by = v_admin THEN 'sí' ELSE 'no' END FROM public.entrevistas_e2 WHERE comercio = 'ZZ Ferretería';
  BEGIN
    INSERT INTO public.entrevistas_e2 (puerta, comercio) VALUES ('perfumeria', 'ZZ');
    INSERT INTO zz_e2 VALUES ('puerta inventada', 'PASÓ (mal)');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO zz_e2 VALUES ('puerta inventada', 'rechazada');
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.entrevistas_e2;
  INSERT INTO zz_e2 VALUES ('usuario común no ve (0)', v_n::text);
  BEGIN
    INSERT INTO public.entrevistas_e2 (puerta, comercio) VALUES ('muchos_gastos', 'ZZ intruso');
    INSERT INTO zz_e2 VALUES ('usuario común escribe', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_e2 VALUES ('usuario común escribe', 'rechazado');
  END;
  RESET ROLE;
END $d$;

SELECT * FROM zz_e2;
ROLLBACK;
