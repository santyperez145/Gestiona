-- Simulacro de 20261105000700 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Las tres funciones sin uso ya no están (o anon no puede llamarlas).
--   2. anon no puede llamar match_transactions; authenticated sí.
--   3. No quedan contratos de funciones que ya no existen.
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.get_org_role(uuid,uuid)', 'public.user_org_ids(uuid)', 'public.store_iva_config(text)'] LOOP
    IF to_regprocedure(f) IS NOT NULL AND has_function_privilege('anon', to_regprocedure(f), 'EXECUTE') THEN
      RAISE EXCEPTION 'FALLA 1: anon sigue pudiendo llamar %', f;
    END IF;
  END LOOP;

  IF has_function_privilege('anon', 'public.match_transactions(uuid,date,date,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLA 2: anon puede llamar match_transactions';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.match_transactions(uuid,date,date,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLA 2b: authenticated perdió match_transactions';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.security_function_contracts sfc
     WHERE sfc.function_name IN ('get_org_role', 'user_org_ids', 'store_iva_config')
       AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
                        WHERE p.proname = sfc.function_name)
  ) THEN
    RAISE EXCEPTION 'FALLA 3: quedaron contratos huérfanos';
  END IF;

  RAISE EXCEPTION 'OK 1 2 3';
END $$;
ROLLBACK;
