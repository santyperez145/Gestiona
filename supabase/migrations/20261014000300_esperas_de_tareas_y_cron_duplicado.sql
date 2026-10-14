-- Cero fallas de tiempo en las tareas programadas (2026-10-14).
--
-- Medido en edge_invocation_log (7 días al 2026-10-14): las únicas fallas de
-- funciones fueron tiempos agotados de la espera, no de la función. El
-- respaldo del 13/10 «falló» a los 60 s y siguió corriendo hasta terminar, y
-- el dispatcher del chat a los 30 s. pg_net deja de esperar la respuesta pero
-- la función sigue: el registro mostraba una falla que no era. Una función de
-- servidor puede durar hasta 150 s, así que la espera pasa a 150 s:
--   · invoke_edge_function: 30 s → 150 s.
--   · invoke_edge_function_with_secret_timeout: tope 60 s → 150 s, y el
--     respaldo diario la usa con 150 s (hoy tarda 36 s para 5 negocios y va a
--     crecer con el catálogo completo de Famatina).
-- Además se borra un cron duplicado: customer-reactivation-alerts corría a
-- las 9 (customer-reactivation-alerts) y a las 10 (customer-reactivation-daily).
-- La función ya no repite avisos sin leer, pero una corrida de más es un
-- mensaje doble esperando a pasar.
-- Las funciones se recrean desde su definición en vivo con un solo cambio.
BEGIN;

CREATE OR REPLACE FUNCTION public.invoke_edge_function(p_name text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'extensions'
AS $function$
DECLARE
  v_url    text;
  v_key    text;
  v_secret text;
  v_id     bigint;
BEGIN
  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_key    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'BACKUP_CRON_SECRET';

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE EXCEPTION 'invoke_edge_function(%): faltan SUPABASE_URL o SUPABASE_ANON_KEY en el vault', p_name;
  END IF;

  -- ⚠️ Sin el secreto NO se manda el pedido. La alternativa —mandarlo igual—
  -- deja la tarea corriendo sin identificarse, que es exactamente el agujero
  -- que esta migración cierra.
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'invoke_edge_function(%): falta BACKUP_CRON_SECRET en el vault; '
                    'la tarea no se dispara sin identificarse', p_name;
  END IF;

  v_id := net.http_post(
    url     := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key,
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb,
    -- El default de pg_net son 5 s y no alcanzan para un lote de emails. No
    -- cancela la funcion: define cuanto esperamos su respuesta.
    timeout_milliseconds := 150000
  );

  PERFORM public.registrar_invocacion(v_id, p_name);
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.invoke_edge_function_with_secret_timeout(p_name text, p_vault_secret_name text, p_header_name text, p_timeout_milliseconds integer DEFAULT 60000)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'extensions'
AS $function$
DECLARE
  v_url text; v_key text; v_secret text; v_id bigint;
  v_timeout integer := greatest(1000, least(coalesce(p_timeout_milliseconds, 60000), 150000));
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = p_vault_secret_name;

  IF v_url IS NULL OR v_key IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'invoke_edge_function_with_secret_timeout(%): faltan SUPABASE_URL, SUPABASE_ANON_KEY o % en el vault',
      p_name, p_vault_secret_name;
  END IF;

  v_id := net.http_post(
    url     := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key,
      p_header_name, v_secret
    ),
    body    := jsonb_build_object('action', 'cron-sync'),
    timeout_milliseconds := v_timeout
  );

  PERFORM public.registrar_invocacion(v_id, p_name);
  RETURN v_id;
END;
$function$;

DO $$
BEGIN
  PERFORM cron.unschedule('daily-org-backups')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-org-backups');
  PERFORM cron.schedule('daily-org-backups', '30 3 * * *',
    $cmd$SELECT public.invoke_edge_function_with_secret_timeout('weekly-backup', 'BACKUP_CRON_SECRET', 'x-backup-cron-secret', 150000);$cmd$);

  PERFORM cron.unschedule('customer-reactivation-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'customer-reactivation-daily');
END $$;

COMMIT;
