-- Simulacro de 20261013000200 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Hoy, con los respaldos al día, ningún comercio sale con «respaldo».
--   2. Si se borran los respaldos completos de Famatina (dentro de la
--      transacción), sale en rojo con «Sin ningún respaldo válido».
DO $$
DECLARE v_admin uuid; v_org uuid; v_r jsonb; v_n int;
BEGIN
  SELECT user_id INTO v_admin FROM public.platform_admins WHERE role = 'superadmin' LIMIT 1;
  SELECT id INTO v_org FROM public.organizations WHERE name ILIKE '%famatina%' LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  v_r := public.platform_salud_comercios();
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_r->'comercios') c, jsonb_array_elements(c->'motivos') m
   WHERE m->>'id' = 'respaldo';
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALLA 1: % comercio(s) con motivo respaldo estando al día', v_n; END IF;

  DELETE FROM public.organization_backup_snapshots WHERE org_id = v_org AND status = 'completed';
  v_r := public.platform_salud_comercios();
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_r->'comercios') c, jsonb_array_elements(c->'motivos') m
   WHERE c->>'org_id' = v_org::text AND m->>'id' = 'respaldo' AND m->>'nivel' = 'rojo'
     AND m->>'texto' = 'Sin ningún respaldo válido';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALLA 2: Famatina sin respaldos no salió en rojo'; END IF;
  RAISE EXCEPTION 'OK 1 y 2';
END $$;

ROLLBACK;
