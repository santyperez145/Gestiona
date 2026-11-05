-- Funciones privilegiadas expuestas sin uso (2026-11-05).
--
-- El informe del simulacro lista 94 funciones SECURITY DEFINER que anon puede
-- llamar. Cruzadas con el panel, la tienda, las funciones edge, la API y el
-- SQL, cuatro no las usa nadie:
--   · get_org_role(org, usuario) y user_org_ids(usuario): sin sesión, decían
--     a qué negocios pertenece cualquier usuario y con qué rol. El id de un
--     dueño no es secreto (el catálogo público lo expone por producto): un
--     visitante podía saber de qué tiendas es dueño alguien.
--   · store_iva_config(slug): reemplazada; nadie la llama.
--   · match_transactions: ya exigía sesión y permiso; igual no tiene por qué
--     estar abierta a anon.
-- Las tres primeras se borran sin CASCADE; si en producción algo dependiera
-- de alguna, en vez de borrarla se le saca el permiso a anon y authenticated.
-- Idempotente.
BEGIN;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.get_org_role(uuid,uuid)', 'public.user_org_ids(uuid)', 'public.store_iva_config(text)'] LOOP
    CONTINUE WHEN to_regprocedure(f) IS NULL;
    BEGIN
      EXECUTE format('DROP FUNCTION %s', f);
    EXCEPTION WHEN dependent_objects_still_exist THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
      RAISE NOTICE 'funciones sin uso: % tiene dependencias; queda sin permiso para el navegador', f;
    END;
  END LOOP;

  IF to_regprocedure('public.match_transactions(uuid,date,date,numeric)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.match_transactions(uuid, date, date, numeric) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.match_transactions(uuid, date, date, numeric) TO authenticated;
  END IF;
END $$;

DELETE FROM public.security_function_contracts sfc
 WHERE sfc.function_name IN ('get_org_role', 'user_org_ids', 'store_iva_config')
   AND NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
      WHERE p.proname = sfc.function_name
   );

COMMIT;
