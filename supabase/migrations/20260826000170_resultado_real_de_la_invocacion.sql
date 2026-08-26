-- ============================================================================
-- P0-07 — el resultado REAL de cada invocación, no el del despacho
-- ============================================================================
--
-- `platform_cron_health` dice "saludable" y hoy los 20 jobs están en verde con
-- 0 fallas en 7 días. Eso no significa lo que parece.
--
-- Los 15 jobs que llaman Edge Functions lo hacen por `invoke_edge_function`,
-- que termina en `net.http_post` — **pg_net es asíncrono**: devuelve un id
-- apenas encola el request y vuelve. El job termina en 0,2 s con `succeeded`
-- sin haber esperado la respuesta. Lo que el cron mide es que el despacho
-- salió, no que la función corriera ni que devolviera 200.
--
-- Medido el 2026-08-26, y por eso este archivo existe: `net._http_response`
-- tenía 41 respuestas y **3 con status 500** —dos `JWT issued at future` y una
-- `{"error":"[object Object]"}`— en la misma ventana en la que
-- `platform_cron_health` mostraba todo sano. Ninguna de las tres es visible en
-- ninguna pantalla.
--
-- Y no se pueden atribuir: `net._http_response` guarda id, status y cuerpo,
-- **pero no el nombre de la función**, y `net.http_request_queue` —que sí tiene
-- la URL— se vacía al procesar. El id que devuelve `net.http_post` es el
-- puente, y `invoke_edge_function` lo descartaba. Encima pg_net poda sus
-- respuestas a las ~6 h: la ventana medida iba de 08:15 a 14:00 del mismo día.
--
-- Este archivo guarda ese id junto al nombre, reconcilia el resultado antes de
-- que pg_net lo pode, y lo expone con error rate y P95 reales.
--
-- ⚠️ Qué mide el P95, dicho con precisión: el tiempo entre que se encoló el
-- request y que pg_net registró la respuesta. Incluye la cola. **No** es el
-- tiempo de ejecución de la función — ese dato no existe de este lado y
-- presentarlo como si lo fuera sería inventar un número.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.edge_invocation_log (
  id            bigserial   PRIMARY KEY,
  request_id    bigint,     -- id de pg_net. NULL = ni se llegó a despachar.
  function_name text        NOT NULL,
  invoked_at    timestamptz NOT NULL DEFAULT now(),
  status_code   integer,
  error_msg     text,
  timed_out     boolean,
  responded_at  timestamptz,
  reconciled_at timestamptz
);

COMMENT ON TABLE public.edge_invocation_log IS
  'Puente entre el id que devuelve net.http_post y el nombre de la Edge Function. '
  'pg_net no guarda el nombre y poda sus respuestas a las ~6 h; sin esta tabla '
  'un 500 de un cron no se puede atribuir a ninguna funcion.';

CREATE UNIQUE INDEX IF NOT EXISTS edge_invocation_log_request_idx
  ON public.edge_invocation_log(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS edge_invocation_log_reciente_idx
  ON public.edge_invocation_log(function_name, invoked_at DESC);
-- Índice parcial: el reconciliador sólo mira las pendientes, y son pocas.
CREATE INDEX IF NOT EXISTS edge_invocation_log_pendientes_idx
  ON public.edge_invocation_log(invoked_at) WHERE reconciled_at IS NULL;

-- Es infraestructura de plataforma, no dato de un comercio: RLS habilitada y
-- cero policies, como las tablas de credenciales. Se lee por la vista de abajo.
ALTER TABLE public.edge_invocation_log ENABLE ROW LEVEL SECURITY;

-- ── Registrar la invocación ─────────────────────────────────────────────────
-- Separado en su propia función para que las tres variantes de invoke la
-- compartan y no haya tres copias que se desincronicen.
CREATE OR REPLACE FUNCTION public.registrar_invocacion(p_request_id bigint, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.edge_invocation_log (request_id, function_name)
  VALUES (p_request_id, p_name);
EXCEPTION WHEN OTHERS THEN
  -- La instrumentación NUNCA puede romper el trabajo que mide. Si el registro
  -- falla, el cron ya despachó y tiene que seguir contando como despachado.
  RAISE WARNING 'registrar_invocacion(%): %', p_name, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_invocacion(bigint, text) FROM PUBLIC;

-- ── invoke_edge_function ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.invoke_edge_function(p_name text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'extensions'
AS $$
DECLARE
  v_url text;
  v_key text;
  v_id  bigint;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY';

  IF v_url IS NULL OR v_key IS NULL THEN
    -- Antes esto era RAISE WARNING + RETURN NULL, y el cron terminaba
    -- `succeeded` sin haber despachado nada. Un job que informa exito sin
    -- hacer el trabajo es peor que uno que falla: nadie lo mira. Ahora explota
    -- y queda en cron.job_run_details, que es donde se busca.
    RAISE EXCEPTION 'invoke_edge_function(%): faltan SUPABASE_URL o SUPABASE_ANON_KEY en el vault', p_name;
  END IF;

  v_id := net.http_post(
    url     := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key
    ),
    body    := '{}'::jsonb
  );

  PERFORM public.registrar_invocacion(v_id, p_name);
  RETURN v_id;
END;
$$;

-- ── invoke_edge_function_with_secret_timeout ────────────────────────────────
CREATE OR REPLACE FUNCTION public.invoke_edge_function_with_secret_timeout(
  p_name text, p_vault_secret_name text, p_header_name text,
  p_timeout_milliseconds integer DEFAULT 60000
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'extensions'
AS $$
DECLARE
  v_url text; v_key text; v_secret text; v_id bigint;
  v_timeout integer := greatest(1000, least(coalesce(p_timeout_milliseconds, 60000), 60000));
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
$$;

-- ── Reconciliar: traer el resultado antes de que pg_net lo pode ─────────────
CREATE OR REPLACE FUNCTION public.reconciliar_invocaciones()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $$
DECLARE
  v_n integer;
  v_huerfanas integer;
BEGIN
  UPDATE public.edge_invocation_log l
     SET status_code   = r.status_code,
         error_msg     = r.error_msg,
         timed_out     = r.timed_out,
         responded_at  = r.created,
         reconciled_at = now()
    FROM net._http_response r
   WHERE r.id = l.request_id
     AND l.reconciled_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- pg_net poda a las ~6 h. Una invocación vieja sin respuesta no es un exito:
  -- es una respuesta que se perdió, y se marca como tal en vez de quedar
  -- pendiente para siempre ensuciando el índice de pendientes.
  UPDATE public.edge_invocation_log
     SET reconciled_at = now(),
         error_msg = COALESCE(error_msg, 'sin respuesta registrada antes de la poda de pg_net')
   WHERE reconciled_at IS NULL
     AND invoked_at < now() - interval '6 hours';
  GET DIAGNOSTICS v_huerfanas = ROW_COUNT;

  IF v_huerfanas > 0 THEN
    RAISE WARNING 'reconciliar_invocaciones: % invocaciones sin respuesta', v_huerfanas;
  END IF;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.reconciliar_invocaciones() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.podar_invocaciones(p_dias integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.edge_invocation_log
   WHERE invoked_at < now() - make_interval(days => greatest(7, p_dias));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.podar_invocaciones(integer) FROM PUBLIC;

-- ── La vista: error rate y P95 reales, con ventana ──────────────────────────
-- Con ventana a propósito. Un promedio sobre toda la historia deja una
-- incidencia resuelta como alarma permanente: hoy hay 5.544 corridas fallidas
-- de cron, **todas del 2026-07-28 o antes**, y un "16% de error" sacado de ahí
-- describiría un problema que ya no existe.
CREATE OR REPLACE VIEW public.platform_edge_invocation_health AS
SELECT
  l.function_name,
  count(*) FILTER (WHERE l.invoked_at >= now() - interval '24 hours')::integer AS invocaciones_24h,
  count(*) FILTER (WHERE l.invoked_at >= now() - interval '24 hours'
                     AND l.status_code >= 400)::integer                        AS errores_24h,
  count(*) FILTER (WHERE l.invoked_at >= now() - interval '24 hours'
                     AND l.request_id IS NULL)::integer                        AS sin_despachar_24h,
  count(*) FILTER (WHERE l.invoked_at >= now() - interval '7 days')::integer   AS invocaciones_7d,
  count(*) FILTER (WHERE l.invoked_at >= now() - interval '7 days'
                     AND l.status_code >= 400)::integer                        AS errores_7d,
  round(percentile_cont(0.95) WITHIN GROUP (
    ORDER BY extract(epoch FROM l.responded_at - l.invoked_at)
  ) FILTER (WHERE l.invoked_at >= now() - interval '24 hours'
              AND l.responded_at IS NOT NULL)::numeric, 3)                     AS p95_seg_24h,
  max(l.invoked_at)                                                            AS ultima_invocacion,
  (array_agg(l.status_code ORDER BY l.invoked_at DESC)
     FILTER (WHERE l.status_code IS NOT NULL))[1]                              AS ultimo_status,
  (array_agg(left(l.error_msg, 300) ORDER BY l.invoked_at DESC)
     FILTER (WHERE l.error_msg IS NOT NULL))[1]                                AS ultimo_error
FROM public.edge_invocation_log l
WHERE public.is_platform_admin(auth.uid())
GROUP BY l.function_name;

COMMENT ON VIEW public.platform_edge_invocation_health IS
  'Resultado real de las Edge Functions invocadas por cron. p95_seg_24h mide '
  'encolado -> respuesta registrada por pg_net, incluye la cola y NO es el '
  'tiempo de ejecucion de la funcion.';

GRANT SELECT ON public.platform_edge_invocation_health TO authenticated;

-- ── Crons ───────────────────────────────────────────────────────────────────
-- Cada 5 minutos: pg_net retiene ~6 h, así que sobra margen.
SELECT cron.unschedule('reconciliar-invocaciones')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconciliar-invocaciones');
SELECT cron.schedule('reconciliar-invocaciones', '*/5 * * * *',
  'SELECT public.reconciliar_invocaciones()');

SELECT cron.unschedule('podar-invocaciones')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podar-invocaciones');
SELECT cron.schedule('podar-invocaciones', '23 4 * * *',
  'SELECT public.podar_invocaciones(30)');

-- ── Verificación ────────────────────────────────────────────────────────────
DO $verif$
DECLARE
  v_id bigint;
  v_fila public.edge_invocation_log%ROWTYPE;
  v_n integer;
  v_admin boolean;
BEGIN
  -- 1. Registrar no rompe aunque el id sea absurdo.
  PERFORM public.registrar_invocacion(-999, 'ZZ-funcion-de-prueba');
  SELECT * INTO v_fila FROM public.edge_invocation_log
   WHERE function_name = 'ZZ-funcion-de-prueba';
  ASSERT v_fila.id IS NOT NULL, 'no se registro la invocacion';
  ASSERT v_fila.reconciled_at IS NULL, 'nacio reconciliada';

  -- 2. Un id sin respuesta en pg_net no se marca como exito.
  SELECT public.reconciliar_invocaciones() INTO v_n;
  SELECT * INTO v_fila FROM public.edge_invocation_log
   WHERE function_name = 'ZZ-funcion-de-prueba';
  ASSERT v_fila.status_code IS NULL,
    'invento un status para una invocacion sin respuesta: ' || v_fila.status_code;

  -- 3. La instrumentacion no puede tumbar al cron: con la tabla rota, el
  --    registro avisa y sigue.
  BEGIN
    PERFORM public.registrar_invocacion(NULL, NULL);  -- function_name NOT NULL
    -- Si llegamos acá, la excepción fue tragada por el handler: es lo correcto.
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'registrar_invocacion dejo escapar un error: %', SQLERRM;
  END;

  -- 4. La vista no le muestra infraestructura a quien no es staff.
  SELECT public.is_platform_admin(auth.uid()) INTO v_admin;
  ASSERT v_admin IS NOT TRUE, 'el bloque DO corre como superusuario, no como admin';
  SELECT count(*) INTO v_n FROM public.platform_edge_invocation_health;
  ASSERT v_n = 0, 'la vista devolvio filas sin ser platform admin: ' || v_n;

  -- 5. Los dos crons quedaron programados.
  SELECT count(*) INTO v_n FROM cron.job
   WHERE jobname IN ('reconciliar-invocaciones', 'podar-invocaciones');
  ASSERT v_n = 2, 'faltan crons: ' || v_n;

  -- Limpieza: sin restos.
  DELETE FROM public.edge_invocation_log WHERE function_name = 'ZZ-funcion-de-prueba';
  SELECT count(*) INTO v_n FROM public.edge_invocation_log
   WHERE function_name LIKE 'ZZ%';
  ASSERT v_n = 0, 'quedaron restos: ' || v_n;

  RAISE NOTICE 'ZZ_OK instrumentacion de invocaciones lista';
END
$verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260826000170', 'resultado_real_de_la_invocacion') ON CONFLICT DO NOTHING;
