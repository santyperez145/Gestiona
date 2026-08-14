-- Operación / observabilidad de cron para staff de plataforma.
--
-- pg_cron guarda el comando completo y el mensaje de retorno de cada ejecución:
-- ambos pueden revelar estructura interna o respuestas de proveedores. Esta vista
-- expone exclusivamente metadatos operativos (nombre, horario, estado y conteos)
-- y sólo a `platform_admins`; no es un log de payloads ni una API para tenants.

CREATE OR REPLACE VIEW public.platform_cron_health AS
WITH run_summary AS (
  SELECT
    d.jobid,
    MAX(d.end_time) FILTER (WHERE d.status = 'succeeded') AS last_success_at,
    COUNT(*) FILTER (WHERE d.start_time >= now() - interval '7 days')::integer AS runs_7d,
    COUNT(*) FILTER (
      WHERE d.start_time >= now() - interval '7 days'
        AND d.status = 'failed'
    )::integer AS failed_runs_7d
  FROM cron.job_run_details d
  GROUP BY d.jobid
), latest_run AS (
  SELECT DISTINCT ON (d.jobid)
    d.jobid,
    d.status,
    d.start_time,
    d.end_time
  FROM cron.job_run_details d
  ORDER BY d.jobid, d.start_time DESC NULLS LAST, d.runid DESC
)
SELECT
  j.jobid,
  j.jobname,
  j.schedule,
  j.active,
  lr.status AS last_status,
  lr.start_time AS last_run_at,
  lr.end_time AS last_finished_at,
  rs.last_success_at,
  COALESCE(rs.runs_7d, 0)::integer AS runs_7d,
  COALESCE(rs.failed_runs_7d, 0)::integer AS failed_runs_7d,
  CASE
    WHEN NOT j.active THEN 'pausado'
    WHEN lr.status = 'failed' THEN 'fallando'
    WHEN lr.status = 'running' THEN 'ejecutando'
    WHEN lr.jobid IS NULL THEN 'sin_ejecuciones'
    ELSE 'saludable'
  END AS estado
FROM cron.job j
LEFT JOIN run_summary rs ON rs.jobid = j.jobid
LEFT JOIN latest_run lr ON lr.jobid = j.jobid
WHERE public.is_platform_admin(auth.uid());

REVOKE ALL ON public.platform_cron_health FROM PUBLIC;
REVOKE ALL ON public.platform_cron_health FROM anon;
REVOKE ALL ON public.platform_cron_health FROM authenticated;
GRANT SELECT ON public.platform_cron_health TO authenticated;

COMMENT ON VIEW public.platform_cron_health IS
  'Salud agregada de pg_cron para staff de plataforma. No expone comandos, return_message ni respuestas HTTP; una corrida ausente se informa sin inferir atraso desde la expresión cron.';

-- Verificación de ACL y de consistencia sin crear ni alterar trabajos reales.
-- Se cambia al rol que usa la API sólo dentro del bloque: un usuario ajeno no
-- recibe filas y un staff real recibe exactamente los jobs configurados.
DO $verificar$
DECLARE
  v_platform_user uuid;
  v_jobs integer;
  v_visible integer;
BEGIN
  SELECT user_id INTO v_platform_user
  FROM public.platform_admins
  ORDER BY granted_at
  LIMIT 1;

  IF v_platform_user IS NULL THEN
    RAISE EXCEPTION 'No hay platform_admin para verificar platform_cron_health';
  END IF;

  SELECT count(*) INTO v_jobs FROM cron.job;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_visible FROM public.platform_cron_health;
  EXECUTE 'RESET ROLE';

  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'platform_cron_health expuso jobs a un usuario no staff';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_platform_user::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_visible FROM public.platform_cron_health;
  EXECUTE 'RESET ROLE';

  IF v_visible <> v_jobs THEN
    RAISE EXCEPTION 'platform_cron_health devolvió % jobs para staff, se esperaban %', v_visible, v_jobs;
  END IF;
END;
$verificar$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260814000009', 'platform_cron_health') ON CONFLICT DO NOTHING;
