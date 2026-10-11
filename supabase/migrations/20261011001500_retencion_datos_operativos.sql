-- ═══════════════════════════════════════════════════════════════════════════
-- Retención de datos operativos (historial de crons e importaciones descartadas)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido 2026-10-11: la base pesa 405 MB. Dos cosas crecen sin límite y no
-- son datos de ningún comercio:
--   · `cron.job_run_details`: 258.979 corridas desde el 07/05 (50 MB); nada
--     las poda y 185.166 tienen más de 14 días.
--   · `product_import_rows` de importaciones **canceladas** por el comercio:
--     la preparación de un archivo que se descartó (hoy 17.807 filas). Ninguna
--     pantalla las usa: «Retomar» sólo ofrece las no canceladas.
--
-- `podar_datos_operativos()` borra corridas de cron de más de 14 días y las
-- filas preparadas de importaciones canceladas hace más de 7 días (la sesión
-- y sus lotes quedan, como historial). Corre todos los días a las 4:53.
-- No toca productos, ventas, clientes ni importaciones sin cancelar.
--
-- Idempotente. Reversible: cron.unschedule + DROP FUNCTION (lo borrado no
-- vuelve; es historial operativo).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.podar_datos_operativos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cron integer := 0;
  v_filas integer := 0;
BEGIN
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '14 days';
  GET DIAGNOSTICS v_cron = ROW_COUNT;

  DELETE FROM public.product_import_rows r
  USING public.catalog_import_chunks c, public.catalog_import_sessions s
  WHERE r.batch_id = c.batch_id AND c.session_id = s.id
    AND s.status = 'cancelled' AND s.updated_at < now() - interval '7 days';
  GET DIAGNOSTICS v_filas = ROW_COUNT;

  RETURN jsonb_build_object('corridas_de_cron', v_cron, 'filas_de_importaciones_canceladas', v_filas);
END;
$$;

REVOKE ALL ON FUNCTION public.podar_datos_operativos() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.podar_datos_operativos() IS
  'Borra historial operativo: corridas de cron de más de 14 días y filas preparadas de importaciones canceladas hace más de 7 días. Corre por cron todos los días.';

DO $$
BEGIN
  PERFORM cron.unschedule('podar-datos-operativos')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podar-datos-operativos');
  PERFORM cron.schedule('podar-datos-operativos', '53 4 * * *', 'SELECT public.podar_datos_operativos()');
END $$;

-- Primera poda ahora.
SELECT public.podar_datos_operativos();

COMMIT;
