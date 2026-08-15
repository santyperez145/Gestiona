-- D8a — un snapshot de varias organizaciones puede tardar más que los 5 s por
-- defecto de pg_net. El trabajo seguía ejecutándose, pero cron registraba un
-- timeout falso. Este helper privado mantiene la protección por Vault y da al
-- backup una ventana explícita de hasta 60 s sin cambiar el cron de MercadoLibre.

CREATE OR REPLACE FUNCTION public.invoke_edge_function_with_secret_timeout(
  p_name text,
  p_vault_secret_name text,
  p_header_name text,
  p_timeout_milliseconds integer DEFAULT 60000
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_url text;
  v_key text;
  v_secret text;
  v_timeout integer := greatest(1000, least(coalesce(p_timeout_milliseconds, 60000), 60000));
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY';
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = p_vault_secret_name;

  IF v_url IS NULL OR v_key IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'invoke_edge_function_with_secret_timeout(%): faltan SUPABASE_URL, SUPABASE_ANON_KEY o % en Vault',
      p_name, p_vault_secret_name;
    RETURN NULL;
  END IF;

  RETURN net.http_post(
    url := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key,
      p_header_name, v_secret
    ),
    body := jsonb_build_object('action', 'cron-sync'),
    timeout_milliseconds := v_timeout
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_edge_function_with_secret_timeout(text, text, text, integer)
  FROM PUBLIC, anon, authenticated;

DO $cron$
DECLARE
  v_job record;
  v_secret_configured boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'BACKUP_CRON_SECRET'
  ) INTO v_secret_configured;

  FOR v_job IN SELECT jobid FROM cron.job WHERE jobname = 'weekly-org-backups' LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  IF NOT v_secret_configured THEN
    RAISE NOTICE 'weekly-org-backups no se programa: falta BACKUP_CRON_SECRET en Vault';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'weekly-org-backups',
    '30 3 * * 0',
    $$SELECT public.invoke_edge_function_with_secret_timeout('weekly-backup', 'BACKUP_CRON_SECRET', 'x-backup-cron-secret', 60000);$$
  );
END
$cron$;

DO $$
DECLARE
  v_job_count integer;
BEGIN
  IF to_regprocedure('public.invoke_edge_function_with_secret_timeout(text,text,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'No se creó el helper con timeout para backups';
  END IF;
  IF has_function_privilege('anon', 'public.invoke_edge_function_with_secret_timeout(text,text,text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.invoke_edge_function_with_secret_timeout(text,text,text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'El helper de backup no puede ser ejecutable desde el navegador';
  END IF;
  SELECT count(*) INTO v_job_count FROM cron.job WHERE jobname = 'weekly-org-backups';
  IF v_job_count <> 1 THEN
    RAISE EXCEPTION 'Se esperaba un cron weekly-org-backups y hay %', v_job_count;
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260815000009', 'managed_backup_cron_timeout') ON CONFLICT DO NOTHING;
