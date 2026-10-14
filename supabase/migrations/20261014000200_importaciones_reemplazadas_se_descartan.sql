-- La retención diaria descarta los intentos de importación que reemplazó uno
-- más nuevo del mismo negocio, y guarda menos historia del cron.
--
-- Medido 2026-10-14: la base pesaba 407 MB (el plan gratuito corta en 500) y
-- `product_import_rows` ocupaba 211 MB. Famatina tenía 8 importaciones sin
-- terminar: la más nueva (la que tiene que retomar) y 7 intentos anteriores
-- del 8 al 10/10 que ya no se pueden retomar desde la app, con ~90 MB de
-- filas en espera. Liberarlos dependía de que el dueño tocara «Descartar las
-- anteriores». `cron.job_run_details` guardaba 14 días (79.055 corridas, 50 MB).
--
-- Regla nueva, mismo criterio que `anterioresSinTerminar` del front: una
-- sesión sin terminar con otra más nueva del mismo negocio que no esté
-- cancelada, y sin tocar hace 7 días, se cancela como lo haría el botón
-- (lotes en espera → cancelled). Sus filas se borran 7 días después por la
-- regla que ya existía. La más nueva nunca se toca, ni el catálogo: sólo las
-- filas en espera de intentos abandonados.
-- El historial del cron baja a 7 días.
-- Misma firma: CREATE OR REPLACE conserva permisos y el cron de las 4:53.
BEGIN;

CREATE OR REPLACE FUNCTION public.podar_datos_operativos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cron integer := 0;
  v_reemplazadas integer := 0;
  v_filas integer := 0;
  v_errores integer := 0;
BEGIN
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';
  GET DIAGNOSTICS v_cron = ROW_COUNT;

  WITH reemplazadas AS (
    SELECT s.id
      FROM public.catalog_import_sessions s
     WHERE s.status NOT IN ('completed', 'cancelled')
       AND s.updated_at < now() - interval '7 days'
       AND EXISTS (
         SELECT 1 FROM public.catalog_import_sessions n
          WHERE n.org_id = s.org_id AND n.created_at > s.created_at AND n.status <> 'cancelled')
  ), lotes AS (
    UPDATE public.product_import_batches b SET status = 'cancelled'
      FROM public.catalog_import_chunks c, reemplazadas r
     WHERE c.session_id = r.id AND b.id = c.batch_id AND b.status = 'staged'
  )
  UPDATE public.catalog_import_sessions s SET status = 'cancelled', updated_at = now()
    FROM reemplazadas r WHERE s.id = r.id;
  GET DIAGNOSTICS v_reemplazadas = ROW_COUNT;

  DELETE FROM public.product_import_rows r
  USING public.catalog_import_chunks c, public.catalog_import_sessions s
  WHERE r.batch_id = c.batch_id AND c.session_id = s.id
    AND s.status = 'cancelled' AND s.updated_at < now() - interval '7 days';
  GET DIAGNOSTICS v_filas = ROW_COUNT;

  DELETE FROM public.app_errores WHERE dia < current_date - 30;
  GET DIAGNOSTICS v_errores = ROW_COUNT;

  RETURN jsonb_build_object(
    'corridas_de_cron', v_cron,
    'importaciones_reemplazadas', v_reemplazadas,
    'filas_de_importaciones_canceladas', v_filas,
    'errores_de_la_app', v_errores);
END;
$function$;

COMMIT;
