-- D7 — estado público de servicio sin convertir el panel operativo en una API.
--
-- El comercio necesita saber dónde mirar ante una incidencia, pero cron.job,
-- los logs y las organizaciones no pueden salir de la plataforma. Esta función
-- sólo entrega tres componentes agregados; no revela nombres de trabajos,
-- comandos, proveedores, clientes, conteos ni mensajes de error.

CREATE OR REPLACE FUNCTION public.get_public_service_status()
RETURNS TABLE(
  component text,
  status text,
  checked_at timestamptz,
  detail text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, cron
AS $$
DECLARE
  v_active_jobs integer := 0;
  v_jobs_with_history integer := 0;
  v_last_run_failed boolean := false;
  v_backup_orgs integer := 0;
  v_verified_backup_orgs integer := 0;
BEGIN
  SELECT
    count(*) FILTER (WHERE j.active)::integer,
    count(*) FILTER (WHERE lr.jobid IS NOT NULL)::integer,
    coalesce(bool_or(lr.status = 'failed') FILTER (WHERE j.active), false)
  INTO v_active_jobs, v_jobs_with_history, v_last_run_failed
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT d.jobid, d.status
    FROM cron.job_run_details d
    WHERE d.jobid = j.jobid
    ORDER BY d.start_time DESC NULLS LAST, d.runid DESC
    LIMIT 1
  ) lr ON true;

  SELECT count(*)::integer INTO v_backup_orgs
  FROM public.organizations o
  JOIN public.plans p ON p.id = o.plan_id
  WHERE p.backups_enabled;

  SELECT count(*)::integer INTO v_verified_backup_orgs
  FROM public.organizations o
  JOIN public.plans p ON p.id = o.plan_id
  WHERE p.backups_enabled
    AND EXISTS (
      SELECT 1
      FROM public.organization_backup_snapshots b
      WHERE b.org_id = o.id
        AND b.status = 'completed'
        AND b.last_verification_status = 'passed'
        AND b.created_at >= now() - interval '8 days'
    );

  -- Llegar a esta función ya prueba que la API y la base pudieron responder;
  -- no se infiere un porcentaje de uptime a partir de una sola observación.
  RETURN QUERY VALUES
    ('Aplicación', 'operational', now(), 'La consulta de estado responde correctamente'),
    (
      'Tareas programadas',
      CASE
        WHEN v_active_jobs = 0 OR v_jobs_with_history = 0 THEN 'unknown'
        WHEN v_last_run_failed THEN 'degraded'
        ELSE 'operational'
      END,
      now(),
      CASE
        WHEN v_active_jobs = 0 THEN 'Todavía no hay tareas programadas activas'
        WHEN v_jobs_with_history = 0 THEN 'Las tareas activas todavía no tienen historial suficiente'
        WHEN v_last_run_failed THEN 'Detectamos una tarea reciente con error y la estamos revisando'
        ELSE 'Las últimas ejecuciones registradas finalizaron correctamente'
      END
    ),
    (
      'Respaldos',
      CASE
        WHEN v_backup_orgs = 0 THEN 'not_applicable'
        WHEN v_verified_backup_orgs = v_backup_orgs THEN 'operational'
        ELSE 'degraded'
      END,
      now(),
      CASE
        WHEN v_backup_orgs = 0 THEN 'No hay organizaciones con respaldo gestionado habilitado'
        WHEN v_verified_backup_orgs = v_backup_orgs THEN 'Los snapshots semanales aplicables pasaron la verificación de integridad'
        ELSE 'Hay snapshots pendientes de verificación o de una nueva corrida'
      END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_service_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_service_status() TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_service_status() IS
  'D7: estado público agregado de aplicación, cron y backups. Sin exponer jobs, comandos, proveedores, organizaciones, logs ni errores internos.';

CREATE TEMP TABLE IF NOT EXISTS zz_public_service_status_verification (
  check_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL
);
TRUNCATE zz_public_service_status_verification;

DO $verify$
DECLARE
  v_statuses text[];
  v_components text[];
  v_anon_can_execute boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE anon';
  SELECT array_agg(status ORDER BY component), array_agg(component ORDER BY component)
  INTO v_statuses, v_components
  FROM public.get_public_service_status();
  EXECUTE 'RESET ROLE';

  SELECT has_function_privilege('anon', 'public.get_public_service_status()', 'EXECUTE')
  INTO v_anon_can_execute;

  IF NOT v_anon_can_execute
     OR v_components <> ARRAY['Aplicación', 'Respaldos', 'Tareas programadas']
     OR EXISTS (SELECT 1 FROM unnest(v_statuses) s WHERE s NOT IN ('operational', 'degraded', 'unknown', 'not_applicable')) THEN
    RAISE EXCEPTION 'Estado público inválido: execute %, components %, statuses %',
      v_anon_can_execute, v_components, v_statuses;
  END IF;

  INSERT INTO zz_public_service_status_verification VALUES
    ('superficie', true, 'tres componentes agregados con estados permitidos'),
    ('acl', true, 'anon ejecuta sólo el resumen SECURITY DEFINER de tres componentes');
END
$verify$;

SELECT check_name, passed, detail
FROM zz_public_service_status_verification
ORDER BY check_name;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260815000010', 'public_service_status') ON CONFLICT DO NOTHING;
