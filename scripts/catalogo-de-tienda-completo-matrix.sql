-- Simulacro de 20261014002000 + 002100 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Como anónimo, devuelve el catálogo entero de Famatina (más de 1.000) y
--      la misma cantidad que la función de filas.
--   2. Mismo orden que la función de filas.
--   3. Una tienda inexistente da una lista vacía.
DO $$
DECLARE v_json jsonb; v_filas int; v_primeros text; v_json_primeros text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  v_json := public.get_store_catalog_completo('ferreteriafamatina')::jsonb;
  SELECT count(*) INTO v_filas FROM public.get_store_catalog_products('ferreteriafamatina');
  SELECT string_agg(id::text, ',') INTO v_primeros FROM (SELECT id FROM public.get_store_catalog_products('ferreteriafamatina') LIMIT 50) x;
  SELECT string_agg(e->>'id', ',') INTO v_json_primeros FROM (SELECT e FROM jsonb_array_elements(v_json) WITH ORDINALITY AS a(e, n) ORDER BY n LIMIT 50) y;
  IF jsonb_array_length(v_json) <= 1000 OR jsonb_array_length(v_json) <> v_filas THEN
    RAISE EXCEPTION 'FALLA 1: json % filas %', jsonb_array_length(v_json), v_filas; END IF;
  IF v_primeros IS DISTINCT FROM v_json_primeros THEN RAISE EXCEPTION 'FALLA 2: otro orden'; END IF;
  IF public.get_store_catalog_completo('zz-no-existe-' || md5(random()::text))::jsonb <> '[]'::jsonb THEN RAISE EXCEPTION 'FALLA 3'; END IF;
  RESET ROLE;
  RAISE EXCEPTION 'OK 1-3 (% productos)', jsonb_array_length(v_json);
END $$;

ROLLBACK;
