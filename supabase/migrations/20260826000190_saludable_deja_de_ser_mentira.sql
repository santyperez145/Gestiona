-- ============================================================================
-- "Saludable" deja de significar "el despacho salió"
-- ============================================================================
--
-- `platform_cron_health` derivaba `estado` de `cron.job_run_details`, y para
-- los 15 jobs que llaman Edge Functions eso mide el despacho, no el trabajo:
-- `net.http_post` es asíncrono y el job termina en 0,2 s sin esperar respuesta.
--
-- Resultado medido el 2026-08-26: los 20 jobs en verde, 0 fallas en 7 días, y
-- al mismo tiempo `recover-abandoned-carts` con `Timeout of 5000 ms reached` y
-- tres respuestas 500 en la ventana de retención de pg_net. Un panel que dice
-- "saludable" mientras el 10% de las invocaciones falla es peor que no tener
-- panel: entrena a no mirarlo.
--
-- Ahora la vista cruza cada job con el resultado real de su función. El puente
-- es el nombre entre comillas del comando —`SELECT public.invoke_edge_function
-- ('check-stock-alerts')`— porque el nombre del job y el de la función no
-- coinciden: `stock-alerts-daily` llama a `check-stock-alerts`.
--
-- ⚠️ Un job cuyo despacho salió pero cuya invocación todavía no se reconcilió
-- **no** se marca fallando. No se sabe todavía, y adivinar hacia el rojo
-- entrena a ignorar la alarma igual que adivinar hacia el verde.
-- ============================================================================

CREATE OR REPLACE VIEW public.platform_cron_health AS
WITH run_summary AS (
  SELECT d.jobid,
         max(d.end_time) FILTER (WHERE d.status = 'succeeded') AS last_success_at,
         count(*) FILTER (WHERE d.start_time >= now() - interval '7 days')::integer AS runs_7d,
         count(*) FILTER (WHERE d.start_time >= now() - interval '7 days'
                            AND d.status = 'failed')::integer AS failed_runs_7d
    FROM cron.job_run_details d
   GROUP BY d.jobid
), latest_run AS (
  SELECT DISTINCT ON (d.jobid) d.jobid, d.status, d.start_time, d.end_time
    FROM cron.job_run_details d
   ORDER BY d.jobid, d.start_time DESC NULLS LAST, d.runid DESC
), job_funcion AS (
  -- El nombre de la Edge Function que dispara cada job, si dispara alguna.
  SELECT j.jobid,
         substring(j.command from 'invoke_edge_function[a-z_]*\(\s*''([^'']+)''') AS function_name
    FROM cron.job j
), invocacion AS (
  SELECT l.function_name,
         count(*) FILTER (WHERE l.invoked_at >= now() - interval '7 days'
                            AND l.reconciled_at IS NOT NULL
                            AND (l.timed_out IS TRUE OR l.status_code IS NULL
                                 OR l.status_code >= 400))::integer AS fallidas_7d,
         (array_agg(l.status_code ORDER BY l.invoked_at DESC)
            FILTER (WHERE l.reconciled_at IS NOT NULL))[1]          AS ultimo_status,
         (array_agg(l.timed_out ORDER BY l.invoked_at DESC)
            FILTER (WHERE l.reconciled_at IS NOT NULL))[1]          AS ultimo_timeout,
         (array_agg(left(l.error_msg, 300) ORDER BY l.invoked_at DESC)
            FILTER (WHERE l.error_msg IS NOT NULL))[1]              AS ultimo_error
    FROM public.edge_invocation_log l
   GROUP BY l.function_name
)
SELECT
  j.jobid,
  j.jobname,
  j.schedule,
  j.active,
  lr.status                          AS last_status,
  lr.start_time                      AS last_run_at,
  lr.end_time                        AS last_finished_at,
  rs.last_success_at,
  COALESCE(rs.runs_7d, 0)            AS runs_7d,
  COALESCE(rs.failed_runs_7d, 0)     AS failed_runs_7d,
  CASE
    WHEN NOT j.active                THEN 'pausado'
    WHEN lr.status = 'failed'        THEN 'fallando'
    -- El despacho salió, pero la función contestó mal o no contestó. Antes
    -- esto caía en 'saludable'.
    WHEN i.ultimo_timeout IS TRUE    THEN 'sin_respuesta'
    WHEN i.ultimo_status >= 400      THEN 'fallando'
    WHEN lr.status = 'running'       THEN 'ejecutando'
    WHEN lr.jobid IS NULL            THEN 'sin_ejecuciones'
    ELSE 'saludable'
  END                                AS estado,
  -- Columnas nuevas al final: CREATE OR REPLACE VIEW sólo permite agregar ahí.
  jf.function_name                   AS edge_function,
  COALESCE(i.fallidas_7d, 0)         AS invocaciones_fallidas_7d,
  i.ultimo_status                    AS ultimo_status_invocacion,
  i.ultimo_error                     AS ultimo_error_invocacion
FROM cron.job j
LEFT JOIN run_summary rs ON rs.jobid = j.jobid
LEFT JOIN latest_run  lr ON lr.jobid = j.jobid
LEFT JOIN job_funcion jf ON jf.jobid = j.jobid
LEFT JOIN invocacion  i  ON i.function_name = jf.function_name
WHERE public.is_platform_admin(auth.uid());

COMMENT ON VIEW public.platform_cron_health IS
  'Salud de los cron jobs. Para los que llaman Edge Functions, `estado` cruza '
  'el resultado real de la invocacion: el exito del job solo prueba que pg_net '
  'encolo el request, no que la funcion respondiera.';

-- ── Verificación ────────────────────────────────────────────────────────────
DO $verif$
DECLARE
  v_n integer; v_estado text; v_fn text;
BEGIN
  -- 1. El puente job -> funcion se extrae bien de los dos formatos de comando.
  SELECT substring('SELECT public.invoke_edge_function(''check-stock-alerts'');'
                   from 'invoke_edge_function[a-z_]*\(\s*''([^'']+)''') INTO v_fn;
  ASSERT v_fn = 'check-stock-alerts', 'no extrajo el nombre simple: ' || COALESCE(v_fn,'(null)');

  SELECT substring('SELECT public.invoke_edge_function_with_secret_timeout(''weekly-backup'', ''X'', ''Y'', 60000);'
                   from 'invoke_edge_function[a-z_]*\(\s*''([^'']+)''') INTO v_fn;
  ASSERT v_fn = 'weekly-backup', 'no extrajo el nombre de la variante con secreto: ' || COALESCE(v_fn,'(null)');

  -- 2. Un job que no llama a ninguna Edge Function no rompe el join.
  SELECT substring('SELECT public.outbox_despachar(100)'
                   from 'invoke_edge_function[a-z_]*\(\s*''([^'']+)''') INTO v_fn;
  ASSERT v_fn IS NULL, 'invento una funcion para un job de SQL puro: ' || v_fn;

  -- 3. La vista sigue siendo staff-only.
  SELECT count(*) INTO v_n FROM public.platform_cron_health;
  ASSERT v_n = 0, 'la vista devolvio filas sin ser platform admin: ' || v_n;

  -- 4. Las columnas que consume la UI siguen existiendo con el mismo nombre.
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'platform_cron_health'
     AND column_name IN ('jobname','estado','failed_runs_7d');
  ASSERT v_n = 3, 'se rompio el contrato con PlatformAdminPage: ' || v_n;

  RAISE NOTICE 'ZZ_OK saludable ya no significa solo "se despacho"';
END
$verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260826000190', 'saludable_deja_de_ser_mentira') ON CONFLICT DO NOTHING;
