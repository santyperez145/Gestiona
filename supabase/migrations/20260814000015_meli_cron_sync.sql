-- C7 / MercadoLibre: sincronización multi-organización sin exponer una acción
-- de cron a cualquiera que conozca la anon key pública.
--
-- El job lee MELI_CRON_SECRET de Vault y lo manda como header a meli-sync.
-- La Edge Function compara el mismo secreto desde su entorno antes de renovar
-- OAuth, llamar la API de MercadoLibre o escribir órdenes/publicaciones.
-- No se crea el job hasta que existe el secreto en Vault: un cron que sólo
-- fallaría cada 15 minutos no es una integración lista.
--
-- Requiere además configurar el mismo valor en Edge Functions:
--   npx supabase secrets set MELI_CRON_SECRET=<valor-aleatorio-largo>
-- y una vez en Vault:
--   SELECT vault.create_secret('<mismo-valor>', 'MELI_CRON_SECRET');
-- Re-ejecutar esta migración luego de cargarlo programa el job.

CREATE OR REPLACE FUNCTION public.invoke_edge_function_with_secret(
  p_name text,
  p_vault_secret_name text,
  p_header_name text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_url text;
  v_key text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY';
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = p_vault_secret_name;

  IF v_url IS NULL OR v_key IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'invoke_edge_function_with_secret(%): faltan SUPABASE_URL, SUPABASE_ANON_KEY o % en Vault',
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
    body := jsonb_build_object('action', 'cron-sync')
  );
END;
$$;

-- El proyecto tiene grants históricos explícitos a anon/authenticated; revocar
-- sólo PUBLIC no los elimina. Esta función puede leer un secreto de Vault, así
-- que ninguno de los dos roles de navegador puede ejecutarla.
REVOKE ALL ON FUNCTION public.invoke_edge_function_with_secret(text, text, text)
  FROM PUBLIC, anon, authenticated;

DO $cron$
DECLARE
  v_job record;
  v_secret_configured boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'MELI_CRON_SECRET'
  ) INTO v_secret_configured;

  -- Si se revocó el secreto desde la última ejecución, el job no puede quedar
  -- haciendo llamadas fallidas. Se borra antes de decidir si corresponde crear
  -- el nuevo, dejando a lo sumo una programación.
  FOR v_job IN SELECT jobid FROM cron.job WHERE jobname = 'meli-sync-orgs' LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  IF NOT v_secret_configured THEN
    RAISE NOTICE 'meli-sync-orgs no se programa: falta MELI_CRON_SECRET en Vault';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'meli-sync-orgs',
    '*/15 * * * *',
    $$SELECT public.invoke_edge_function_with_secret('meli-sync', 'MELI_CRON_SECRET', 'x-meli-cron-secret');$$
  );
END
$cron$;

DO $$
DECLARE
  v_secret_configured boolean;
  v_job_count integer;
BEGIN
  IF to_regprocedure('public.invoke_edge_function_with_secret(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'No se creó invoke_edge_function_with_secret';
  END IF;
  IF has_function_privilege('anon', 'public.invoke_edge_function_with_secret(text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.invoke_edge_function_with_secret(text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'El helper de cron no puede quedar ejecutable desde el navegador';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'MELI_CRON_SECRET'
  ) INTO v_secret_configured;
  SELECT count(*) INTO v_job_count FROM cron.job WHERE jobname = 'meli-sync-orgs';

  IF v_secret_configured AND v_job_count <> 1 THEN
    RAISE EXCEPTION 'Se esperaba un cron meli-sync-orgs y hay %', v_job_count;
  END IF;
  IF NOT v_secret_configured AND v_job_count <> 0 THEN
    RAISE EXCEPTION 'No debe programarse meli-sync-orgs sin MELI_CRON_SECRET';
  END IF;
END;
$$;
