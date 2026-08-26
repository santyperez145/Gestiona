-- ============================================================================
-- Un timeout también es una falla, y 5 s no alcanzan para escucharla
-- ============================================================================
--
-- La instrumentación de 20260826000170 encontró dos cosas en su primera media
-- hora, y las dos son de este archivo.
--
-- ── 1. La vista no contaba los timeouts ─────────────────────────────────────
--
-- `errores_24h` contaba `status_code >= 400`. Un timeout de pg_net deja
-- `status_code` en NULL y `timed_out` en true, así que **no lo contaba**: la
-- vista que existe para hacer visible el error rate tenía el mismo agujero que
-- vino a tapar. Medido: `recover-abandoned-carts` con `Timeout of 5000 ms
-- reached` y la vista mostrándolo como no-error.
--
-- Una invocación reconciliada sin `status_code` no respondió. Eso es una falla,
-- no un silencio neutro.
--
-- ── 2. El despacho cortaba a los 5 s ────────────────────────────────────────
--
-- `invoke_edge_function` no pasaba `timeout_milliseconds`, así que usaba el
-- default de pg_net: **5 segundos**. Una función que manda un lote de emails
-- tarda más que eso.
--
-- ⚠️ Y acá hay que ser preciso, porque la lectura fácil es la equivocada:
-- pg_net **no cancela** la Edge Function. El request sigue del lado del
-- servidor y el trabajo probablemente se hace. Lo que el timeout rompe es la
-- **observabilidad**: no llega el status, no llega el cuerpo, y no hay forma de
-- saber si salió bien. No es "los carritos abandonados no se recuperan", es
-- "no tenemos manera de saberlo". Subir el timeout no arregla una función
-- lenta: arregla que su resultado se pueda escuchar.
--
-- 30 s, no 60: es holgado para un cron y sigue acotando cuánto tiempo pg_net
-- mantiene el request abierto. La variante con secreto ya permitía hasta 60 s.
--
-- Medido en la ventana de retención de pg_net (2026-08-26, 08:30 a 14:15):
-- 42 respuestas, 37 OK, 4 con error HTTP y 1 timeout — ~10% de fallas, ninguna
-- visible en ninguna pantalla.
-- ============================================================================

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
    RAISE EXCEPTION 'invoke_edge_function(%): faltan SUPABASE_URL o SUPABASE_ANON_KEY en el vault', p_name;
  END IF;

  v_id := net.http_post(
    url     := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key
    ),
    body    := '{}'::jsonb,
    -- El default de pg_net son 5 s y no alcanzan para un lote de emails. No
    -- cancela la funcion: define cuanto esperamos su respuesta.
    timeout_milliseconds := 30000
  );

  PERFORM public.registrar_invocacion(v_id, p_name);
  RETURN v_id;
END;
$$;

-- ── La vista, con el error bien definido ────────────────────────────────────
-- `fallida` = reconciliada y sin respuesta exitosa. Un timeout cuenta; un
-- status NULL cuenta; un 5xx cuenta. Lo que todavia no se reconcilio no cuenta
-- ni como exito ni como falla, porque no se sabe.
DROP VIEW IF EXISTS public.platform_edge_invocation_health;

CREATE VIEW public.platform_edge_invocation_health AS
WITH clasificada AS (
  SELECT l.*,
         (l.reconciled_at IS NOT NULL
          AND (l.timed_out IS TRUE OR l.status_code IS NULL OR l.status_code >= 400)) AS fallida
    FROM public.edge_invocation_log l
)
SELECT
  c.function_name,
  count(*) FILTER (WHERE c.invoked_at >= now() - interval '24 hours')::integer      AS invocaciones_24h,
  count(*) FILTER (WHERE c.invoked_at >= now() - interval '24 hours'
                     AND c.fallida)::integer                                        AS errores_24h,
  count(*) FILTER (WHERE c.invoked_at >= now() - interval '24 hours'
                     AND c.timed_out IS TRUE)::integer                              AS timeouts_24h,
  count(*) FILTER (WHERE c.invoked_at >= now() - interval '24 hours'
                     AND c.request_id IS NULL)::integer                             AS sin_despachar_24h,
  count(*) FILTER (WHERE c.invoked_at >= now() - interval '7 days')::integer        AS invocaciones_7d,
  count(*) FILTER (WHERE c.invoked_at >= now() - interval '7 days'
                     AND c.fallida)::integer                                        AS errores_7d,
  round(percentile_cont(0.95) WITHIN GROUP (
    ORDER BY extract(epoch FROM c.responded_at - c.invoked_at)
  ) FILTER (WHERE c.invoked_at >= now() - interval '24 hours'
              AND c.responded_at IS NOT NULL)::numeric, 3)                          AS p95_seg_24h,
  max(c.invoked_at)                                                                 AS ultima_invocacion,
  (array_agg(c.status_code ORDER BY c.invoked_at DESC)
     FILTER (WHERE c.status_code IS NOT NULL))[1]                                   AS ultimo_status,
  (array_agg(left(c.error_msg, 300) ORDER BY c.invoked_at DESC)
     FILTER (WHERE c.error_msg IS NOT NULL))[1]                                     AS ultimo_error
FROM clasificada c
WHERE public.is_platform_admin(auth.uid())
GROUP BY c.function_name;

COMMENT ON VIEW public.platform_edge_invocation_health IS
  'Resultado real de las Edge Functions invocadas por cron. Una invocacion es '
  'fallida si se reconcilio y no trajo respuesta exitosa: 5xx, status NULL o '
  'timeout. p95_seg_24h mide encolado -> respuesta registrada por pg_net, '
  'incluye la cola y NO es el tiempo de ejecucion de la funcion.';

GRANT SELECT ON public.platform_edge_invocation_health TO authenticated;

-- ── Verificación ────────────────────────────────────────────────────────────
DO $verif$
DECLARE
  v_id bigint; v_n integer; v_fallidas integer;
BEGIN
  -- 1. Un timeout cuenta como error. Se arma la fila a mano porque provocar un
  --    timeout real tardaria 30 s y dependeria de la red.
  INSERT INTO public.edge_invocation_log
    (request_id, function_name, invoked_at, status_code, timed_out, error_msg,
     responded_at, reconciled_at)
  VALUES (-101, 'ZZ-timeout', now(), NULL, true, 'Timeout of 5000 ms reached',
          now(), now());

  -- 2. Un 500 tambien.
  INSERT INTO public.edge_invocation_log
    (request_id, function_name, invoked_at, status_code, timed_out,
     responded_at, reconciled_at)
  VALUES (-102, 'ZZ-quinientos', now(), 500, false, now(), now());

  -- 3. Un 200 no.
  INSERT INTO public.edge_invocation_log
    (request_id, function_name, invoked_at, status_code, timed_out,
     responded_at, reconciled_at)
  VALUES (-103, 'ZZ-ok', now(), 200, false, now(), now());

  -- 4. Una invocacion todavia sin reconciliar no es ni exito ni falla.
  INSERT INTO public.edge_invocation_log (request_id, function_name, invoked_at)
  VALUES (-104, 'ZZ-pendiente', now());

  SELECT count(*) INTO v_fallidas
    FROM public.edge_invocation_log l
   WHERE l.function_name IN ('ZZ-timeout','ZZ-quinientos','ZZ-ok','ZZ-pendiente')
     AND l.reconciled_at IS NOT NULL
     AND (l.timed_out IS TRUE OR l.status_code IS NULL OR l.status_code >= 400);
  ASSERT v_fallidas = 2,
    'la clasificacion de falla no da: esperaba 2 (timeout y 500), dio ' || v_fallidas;

  -- 5. El timeout del despacho quedo declarado y no es el default de 5 s.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'invoke_edge_function'
     AND p.prosrc LIKE '%timeout_milliseconds := 30000%';
  ASSERT v_n = 1, 'invoke_edge_function sigue sin timeout declarado';

  -- 6. La vista sigue siendo staff-only.
  SELECT count(*) INTO v_n FROM public.platform_edge_invocation_health;
  ASSERT v_n = 0, 'la vista devolvio filas sin ser platform admin: ' || v_n;

  DELETE FROM public.edge_invocation_log WHERE function_name LIKE 'ZZ-%';
  SELECT count(*) INTO v_n FROM public.edge_invocation_log WHERE function_name LIKE 'ZZ%';
  ASSERT v_n = 0, 'restos: ' || v_n;

  RAISE NOTICE 'ZZ_OK timeout cuenta como falla y el despacho espera 30 s';
END
$verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260826000180', 'un_timeout_tambien_es_una_falla') ON CONFLICT DO NOTHING;
