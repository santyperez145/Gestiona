-- Simulacro de 20261105000800 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Staff con segundo factor (aal2): es staff.
--   2. Staff con contraseña sola (aal1): no es staff, en las dos funciones.
--   3. Sin marca aal (matrices) y sin sesión (servidor): sigue siendo staff.
--   4. Una sesión aal1 que pregunta por OTRO usuario recibe la respuesta real.
--   5. Los contratos quedaron con el hash nuevo.
DO $$
DECLARE
  v_staff uuid;
  v_otro uuid;
  v_ok text := '';
BEGIN
  SELECT id INTO v_staff FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_otro FROM auth.users WHERE id <> v_staff ORDER BY created_at LIMIT 1;
  INSERT INTO public.platform_admins (user_id, role) VALUES (v_staff, 'superadmin')
    ON CONFLICT (user_id) DO UPDATE SET role = 'superadmin';

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  IF NOT public.is_platform_admin(v_staff) OR NOT public.has_platform_role(ARRAY['soporte']) THEN
    RAISE EXCEPTION 'FALLA 1: el staff con segundo factor dejó de ser staff';
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  IF public.is_platform_admin(v_staff) OR public.has_platform_role(ARRAY['soporte']) THEN
    RAISE EXCEPTION 'FALLA 2: con contraseña sola sigue siendo staff';
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  IF NOT public.is_platform_admin(v_staff) THEN
    RAISE EXCEPTION 'FALLA 3: sin marca aal dejó de ser staff';
  END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  IF NOT public.is_platform_admin(v_staff) OR NOT public.has_platform_role(ARRAY['soporte'], v_staff) THEN
    RAISE EXCEPTION 'FALLA 3b: sin sesión (servidor) dejó de ser staff';
  END IF;
  v_ok := v_ok || '3 ';

  -- 4
  IF v_otro IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    IF NOT public.is_platform_admin(v_staff) THEN
      RAISE EXCEPTION 'FALLA 4: preguntar por otro usuario desde una sesión aal1 cambió la respuesta';
    END IF;
  END IF;
  v_ok := v_ok || '4 ';

  -- 5
  IF EXISTS (
    SELECT 1 FROM public.security_function_contracts sfc
      JOIN pg_proc p ON p.proname = sfc.function_name
       AND pg_get_function_identity_arguments(p.oid) = sfc.identity_arguments
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
     WHERE sfc.function_name IN ('is_platform_admin', 'has_platform_role')
       AND sfc.definition_hash IS DISTINCT FROM md5(pg_get_functiondef(p.oid))
  ) THEN
    RAISE EXCEPTION 'FALLA 5: contrato con otro hash';
  END IF;
  v_ok := v_ok || '5';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
