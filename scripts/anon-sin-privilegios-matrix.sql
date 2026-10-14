-- Simulacro de 20261013000900 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Tabla nueva: anon sin ningún privilegio; authenticated conserva SELECT.
--   2. Vista nueva: anon sin SELECT.
--   3. Secuencia nueva: anon sin USAGE.
--   4. Un GRANT explícito a anon sigue funcionando.
--   5. Lo existente no cambia: anon sigue con SELECT en planes_contratables.
CREATE TABLE public.zz_nueva (id int);
CREATE VIEW public.zz_vista AS SELECT 1 AS x;
CREATE SEQUENCE public.zz_seq;
CREATE VIEW public.zz_publica AS SELECT 1 AS x;
GRANT SELECT ON public.zz_publica TO anon;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.zz_nueva', 'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'FALLA 1: anon tiene privilegios en la tabla nueva'; END IF;
  IF NOT has_table_privilege('authenticated', 'public.zz_nueva', 'SELECT') THEN RAISE EXCEPTION 'FALLA 1: authenticated perdió SELECT'; END IF;
  IF has_table_privilege('anon', 'public.zz_vista', 'SELECT') THEN RAISE EXCEPTION 'FALLA 2: anon lee la vista nueva'; END IF;
  IF has_sequence_privilege('anon', 'public.zz_seq', 'USAGE') THEN RAISE EXCEPTION 'FALLA 3: anon usa la secuencia nueva'; END IF;
  IF NOT has_table_privilege('anon', 'public.zz_publica', 'SELECT') THEN RAISE EXCEPTION 'FALLA 4: el GRANT explícito no anduvo'; END IF;
  IF NOT has_table_privilege('anon', 'public.planes_contratables', 'SELECT') THEN RAISE EXCEPTION 'FALLA 5: cambió lo existente'; END IF;
  RAISE EXCEPTION 'OK 1-5';
END $$;

ROLLBACK;
