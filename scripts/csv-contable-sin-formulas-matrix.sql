-- Simulacro de 20261105000100 (concatenar sin BEGIN/COMMIT; termina en ROLLBACK).
--   1. Una fórmula queda como texto (con apóstrofo adelante).
--   2. Un monto negativo sigue siendo número.
--   3. Las comillas se duplican y el vacío es una celda vacía.
--   4. La exportación contable usa csv_celda en todas las celdas de texto.
--   5. anon no puede llamarla.
DO $$
DECLARE
  v_def text;
  v_ok text := '';
BEGIN
  -- 1
  IF public.csv_celda('=HYPERLINK("http://evil.example","clic")') IS DISTINCT FROM '"''=HYPERLINK(""http://evil.example"",""clic"")"' THEN
    RAISE EXCEPTION 'FALLA 1: %', public.csv_celda('=HYPERLINK("http://evil.example","clic")');
  END IF;
  IF public.csv_celda('+1+1') IS DISTINCT FROM '"''+1+1"' OR public.csv_celda('@SUM(A1)') IS DISTINCT FROM '"''@SUM(A1)"'
     OR public.csv_celda('-2+3') IS DISTINCT FROM '"''-2+3"' THEN
    RAISE EXCEPTION 'FALLA 1b: las otras fórmulas no se neutralizan';
  END IF;
  v_ok := v_ok || '1 ';

  -- 2
  IF public.csv_celda('-150,00') IS DISTINCT FROM '"-150,00"' OR public.csv_celda('-150.5') IS DISTINCT FROM '"-150.5"' THEN
    RAISE EXCEPTION 'FALLA 2: un monto negativo dejó de ser número (%)', public.csv_celda('-150,00');
  END IF;
  v_ok := v_ok || '2 ';

  -- 3
  IF public.csv_celda('a"b') IS DISTINCT FROM '"a""b"' OR public.csv_celda(NULL) IS DISTINCT FROM '""' THEN
    RAISE EXCEPTION 'FALLA 3: comillas o vacío';
  END IF;
  v_ok := v_ok || '3 ';

  -- 4
  v_def := pg_get_functiondef('public.finance_export_batch_csv(uuid)'::regprocedure);
  IF v_def NOT LIKE '%csv_celda(r.entry_descripcion)%' OR v_def NOT LIKE '%csv_celda(r.cuenta_nombre)%'
     OR v_def NOT LIKE '%csv_celda(r.centro_costo)%' OR v_def NOT LIKE '%csv_celda(r.cuenta_codigo)%' THEN
    RAISE EXCEPTION 'FALLA 4: la exportación contable no usa csv_celda';
  END IF;
  v_ok := v_ok || '4 ';

  -- 5
  IF has_function_privilege('anon', 'public.csv_celda(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALLA 5: anon puede llamar csv_celda';
  END IF;
  v_ok := v_ok || '5';

  RAISE EXCEPTION 'OK %', v_ok;
END $$;
ROLLBACK;
