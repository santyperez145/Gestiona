-- Simulacro de 20261015000500 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. En las dos tiendas, los primeros productos son exactamente el comienzo
--      del catálogo completo tal como lo ordena la tienda (con stock primero).
--   2. El total coincide con el catálogo completo.
--   3. El límite se respeta (y no pasa de 200).
--   4. Tiempo en Famatina.
DO $$
DECLARE v_slug text; v_ini jsonb; v_todo jsonb; v_esperado jsonb; t0 timestamptz; ms int;
BEGIN
  FOR v_slug IN SELECT slug FROM public.ecommerce_stores WHERE is_active LOOP
    v_ini := public.get_store_catalog_inicio(v_slug, 48)::jsonb;
    v_todo := public.get_store_catalog_completo(v_slug)::jsonb;
    SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'stock')::numeric <= 0, i), '[]'::jsonb) INTO v_esperado
      FROM (SELECT e, i FROM jsonb_array_elements(v_todo) WITH ORDINALITY x(e, i)) s;
    SELECT COALESCE(jsonb_agg(e ORDER BY i), '[]'::jsonb) INTO v_esperado
      FROM jsonb_array_elements(v_esperado) WITH ORDINALITY x(e, i) WHERE i <= 48;
    IF v_ini->'productos' IS DISTINCT FROM v_esperado THEN
      RAISE EXCEPTION 'FALLA 1 %: % productos; primero distinto: %', v_slug, jsonb_array_length(v_ini->'productos'),
        (SELECT a->>'name' FROM jsonb_array_elements(v_ini->'productos') WITH ORDINALITY x(a, i) JOIN jsonb_array_elements(v_esperado) WITH ORDINALITY y(b, j) ON i = j WHERE a <> b LIMIT 1);
    END IF;
    IF (v_ini->>'total')::int <> jsonb_array_length(v_todo) THEN RAISE EXCEPTION 'FALLA 2 %: total % vs %', v_slug, v_ini->>'total', jsonb_array_length(v_todo); END IF;
  END LOOP;
  IF jsonb_array_length(public.get_store_catalog_inicio('ferreteriafamatina', 5000)::jsonb->'productos') <> 200 THEN RAISE EXCEPTION 'FALLA 3: el tope no es 200'; END IF;
  t0 := clock_timestamp();
  PERFORM public.get_store_catalog_inicio('ferreteriafamatina', 48);
  ms := extract(milliseconds FROM clock_timestamp() - t0)::int;
  RAISE EXCEPTION 'OK 1-3; Famatina primera página en % ms, % KB', ms, length(public.get_store_catalog_inicio('ferreteriafamatina', 48)::text) / 1024;
END $$;

ROLLBACK;
