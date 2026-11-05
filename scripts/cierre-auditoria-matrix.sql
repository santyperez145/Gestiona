-- Simulacro de 20261105000300 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. anon no lee alert_summary y la vista respeta RLS (invoker).
--   2. Ninguna función SECURITY DEFINER ejecutable desde el navegador queda
--      sin search_path fijo.
DO $$
DECLARE
  v_n int;
  v_lista text;
BEGIN
  -- 1
  IF has_table_privilege('anon', 'public.alert_summary', 'SELECT') THEN
    RAISE EXCEPTION 'FALLA 1: anon lee alert_summary';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.alert_summary'::regclass
                  AND 'security_invoker=true' = ANY (coalesce(reloptions, '{}'))) THEN
    RAISE EXCEPTION 'FALLA 1b: alert_summary sigue con los permisos del dueño';
  END IF;

  -- 2
  SELECT count(*), string_agg(p.proname, ', ') INTO v_n, v_lista
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
   WHERE p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg WHERE cfg LIKE 'search_path=%')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'FALLA 2: % funciones definer sin search_path: %', v_n, v_lista;
  END IF;

  RAISE EXCEPTION 'OK 1 2';
END $$;
ROLLBACK;
