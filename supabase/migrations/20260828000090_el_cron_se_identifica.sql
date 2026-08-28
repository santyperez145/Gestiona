-- El cron se identifica: cualquiera podía disparar las tareas programadas
--
-- ── El agujero ────────────────────────────────────────────────────────────
--
-- ⚠️ Medido el 2026-08-28 mandando un `OPTIONS` **sin una sola credencial** a
-- `weekly-performance-digest`: contestó `{"sent":0}`. Se ejecutó.
--
-- 19 funciones de cron se deployan con `--no-verify-jwt` —el cron de Postgres
-- no tiene sesión de usuario— y `invoke_edge_function` les mandaba **sólo la
-- anon key**, que va en el bundle del navegador y es pública. No había nada
-- que distinguiera al cron de cualquiera con la URL.
--
-- Lo que permitía, con un `curl` desde afuera:
--
--   - `send-drip-emails`, `send-scheduled-campaigns`, `send-birthday-whatsapp`
--     cuantas veces se quisiera: spam a los clientes de **todos** los
--     comercios, con la cuenta a la plataforma.
--   - `auto-recurring-expenses`, que **crea gastos** en contabilidad ajena.
--   - `execute-automations` y `run-automation-flows`, que corren lo que cada
--     comercio haya configurado.
--
-- 📌 No es una fuga de datos: es la capacidad de **hacer que el sistema actúe**
-- en nombre de todos los comercios, gratis y desde afuera.
--
-- ── La corrección ─────────────────────────────────────────────────────────
--
-- `invoke_edge_function` pasa a mandar el secreto del vault en `x-cron-secret`,
-- y las funciones lo exigen (`_shared/cronAuth.ts`). Es **el mismo mecanismo
-- que `weekly-backup` ya usaba** desde el 2026-08-15 vía
-- `invoke_edge_function_with_secret_timeout`: no se inventa nada, se
-- generaliza lo que ya funcionaba.
--
-- 📌 **Cambiar `invoke_edge_function` alcanza para las 19.** Los 20 cron jobs
-- la llaman a ella, así que ninguno hay que tocar — y un cron nuevo queda
-- cubierto por nacer.
--
-- 📌 El secreto es `BACKUP_CRON_SECRET` y el nombre queda: ya existía en el
-- vault **y** en el entorno de las funciones, con el mismo valor. Crear uno
-- nuevo habría obligado a mover un valor secreto sin ganar nada — dos secretos
-- compartidos de cron tienen el mismo radio de daño que uno.
--
-- ⚠️ **Falla ruidoso, no callado.** Si el secreto no está en el vault, la
-- función lanza en vez de mandar el pedido sin él: un cron que corre sin
-- identificarse volvería a dejar la puerta abierta, y hacerlo en silencio es
-- cómo estos agujeros duran meses.

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
    timeout_milliseconds := 30000
  );

  PERFORM public.registrar_invocacion(v_id, p_name);
  RETURN v_id;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación
-- ═══════════════════════════════════════════════════════════════════════════

DO $verif$
DECLARE
  v_def  text;
  v_jobs int;
BEGIN
  -- ── a. La función manda el header ───────────────────────────────────────
  v_def := pg_get_functiondef('public.invoke_edge_function(text)'::regprocedure);
  ASSERT v_def LIKE '%x-cron-secret%',
    'invoke_edge_function no manda el secreto de cron';

  -- ── b. ⚠️ Y se niega a disparar sin él ──────────────────────────────────
  -- Sin esta mitad, «manda el header» pasaría igual con un header vacío.
  ASSERT v_def LIKE '%falta BACKUP_CRON_SECRET en el vault%',
    'invoke_edge_function dispararía la tarea sin identificarse';

  -- ── c. El secreto está en el vault ──────────────────────────────────────
  ASSERT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'BACKUP_CRON_SECRET'),
    'no está BACKUP_CRON_SECRET en el vault: los 20 crons dejarían de correr';

  -- ── d. Los cron jobs siguen apuntando a esta función ────────────────────
  -- Es lo que hace que cambiarla alcance para las 19.
  SELECT count(*) INTO v_jobs FROM cron.job
   WHERE command LIKE '%invoke_edge_function%';
  ASSERT v_jobs > 10,
    'sólo ' || v_jobs || ' cron job(s) pasan por invoke_edge_function: el resto '
    'quedaría sin identificarse';

  RAISE NOTICE 'OK: % cron job(s) pasan a identificarse con x-cron-secret', v_jobs;
END $verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000090', 'el_cron_se_identifica')
ON CONFLICT DO NOTHING;
