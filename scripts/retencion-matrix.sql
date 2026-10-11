-- Matriz reversible de 20261011001500 (retención de datos operativos).
--   node scripts/db.mjs --file scripts/retencion-matrix.sql --allow-destructive
-- Sin migrar: cuenta qué borraría y qué no. Una importación cancelada hace
-- 8 días pierde sus filas; una cancelada ayer y una en curso las conservan;
-- productos y ventas no cambian. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE zz_rt (caso text, valor text) ON COMMIT DROP;
DO $d$
DECLARE v_prod int; v_sales int; v_r jsonb; v_viejas int; v_canceladas int; v_curso int;
BEGIN
  SELECT count(*) INTO v_prod FROM public.products;
  SELECT count(*) INTO v_sales FROM public.sales;
  SELECT count(*) INTO v_viejas FROM cron.job_run_details WHERE end_time < now() - interval '14 days';
  SELECT count(*) INTO v_curso FROM public.product_import_rows r JOIN public.catalog_import_chunks c ON c.batch_id = r.batch_id
    JOIN public.catalog_import_sessions s ON s.id = c.session_id WHERE s.status <> 'cancelled';
  -- Una cancelada «hace 8 días» (sólo dentro de la transacción).
  UPDATE public.catalog_import_sessions SET updated_at = now() - interval '8 days'
  WHERE id = (SELECT id FROM public.catalog_import_sessions WHERE status = 'cancelled' ORDER BY updated_at LIMIT 1);
  SELECT count(*) INTO v_canceladas FROM public.product_import_rows r JOIN public.catalog_import_chunks c ON c.batch_id = r.batch_id
    JOIN public.catalog_import_sessions s ON s.id = c.session_id WHERE s.status = 'cancelled' AND s.updated_at < now() - interval '7 days';
  v_r := public.podar_datos_operativos();
  INSERT INTO zz_rt VALUES ('corridas de cron borradas = las de +14 días', (v_r->>'corridas_de_cron') || ' = ' || v_viejas);
  INSERT INTO zz_rt VALUES ('filas de la cancelada vieja borradas', (v_r->>'filas_de_importaciones_canceladas') || ' = ' || v_canceladas);
  INSERT INTO zz_rt SELECT 'filas de importaciones sin cancelar intactas', count(*) || ' = ' || v_curso FROM public.product_import_rows r
    JOIN public.catalog_import_chunks c ON c.batch_id = r.batch_id JOIN public.catalog_import_sessions s ON s.id = c.session_id WHERE s.status <> 'cancelled';
  INSERT INTO zz_rt SELECT 'productos y ventas intactos', (SELECT count(*) FROM public.products) || '/' || (SELECT count(*) FROM public.sales) || ' = ' || v_prod || '/' || v_sales;
  INSERT INTO zz_rt SELECT 'cron programado', count(*)::text FROM cron.job WHERE jobname = 'podar-datos-operativos';
END $d$;
SELECT * FROM zz_rt;
ROLLBACK;
