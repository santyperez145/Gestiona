-- Simulacro de 20261013000800 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Vista nueva sin opción → queda security_invoker=true.
--   2. Vista nueva con security_invoker=false explícito → se respeta.
--   3. CREATE OR REPLACE sin WITH de una vista definer → queda invoker (lado seguro).
--   4. Una vista nueva sobre una tabla con RLS no deja leer a anon filas ajenas.
CREATE VIEW public.zz_sin_opcion AS SELECT id, org_id FROM public.products;
CREATE VIEW public.zz_explicita WITH (security_invoker = false) AS SELECT 1 AS x;
CREATE VIEW public.zz_reemplazo WITH (security_invoker = false) AS SELECT 1 AS x;
CREATE OR REPLACE VIEW public.zz_reemplazo AS SELECT 1 AS x;
GRANT SELECT ON public.zz_sin_opcion TO anon;

DO $$
DECLARE v_opt text; v_n int;
BEGIN
  SELECT array_to_string(reloptions, ',') INTO v_opt FROM pg_class WHERE oid = 'public.zz_sin_opcion'::regclass;
  IF coalesce(v_opt, '') NOT LIKE '%security_invoker=true%' THEN RAISE EXCEPTION 'FALLA 1: %', v_opt; END IF;
  SELECT array_to_string(reloptions, ',') INTO v_opt FROM pg_class WHERE oid = 'public.zz_explicita'::regclass;
  IF coalesce(v_opt, '') NOT LIKE '%security_invoker=false%' THEN RAISE EXCEPTION 'FALLA 2: %', v_opt; END IF;
  SELECT array_to_string(reloptions, ',') INTO v_opt FROM pg_class WHERE oid = 'public.zz_reemplazo'::regclass;
  IF coalesce(v_opt, '') NOT LIKE '%security_invoker=true%' THEN RAISE EXCEPTION 'FALLA 3: %', v_opt; END IF;

  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.zz_sin_opcion;
  RESET ROLE;
  IF v_n > 0 THEN RAISE EXCEPTION 'FALLA 4: anon lee % productos por una vista nueva', v_n; END IF;
  RAISE EXCEPTION 'OK 1-4';
END $$;

ROLLBACK;
