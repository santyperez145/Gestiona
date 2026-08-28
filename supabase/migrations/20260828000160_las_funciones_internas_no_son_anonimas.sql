-- P1-04 / auditoría integral — una función «sólo backend» también lo es en ACL.
--
-- Medido en producción el 2026-08-28: seis funciones internas conservaban un
-- grant EXPLÍCITO a `anon` aunque su migración decía `REVOKE ... FROM PUBLIC`.
-- Revocar el pseudo-rol PUBLIC no borra un grant directo a anon/authenticated.
-- La consecuencia no era teórica:
--
--   * cambios_de_precio_a_aplicar exponía ids de organización, suscripción y
--     preapproval de MercadoPago;
--   * registrar_cambio_de_precio podía alterar el precio acordado;
--   * ia_registrar_consumo podía falsificar cupos/costos de otra organización;
--   * registrar/reconciliar/podar_invocaciones permitían contaminar o borrar
--     la telemetría con la que Plataforma detecta fallas.
--
-- Cada puerta queda con dos barreras: ACL explícita y guarda dentro del cuerpo.
-- La excepción sin JWT existe sólo para pg_cron/verificaciones conectadas como
-- dueño de la base. PostgREST entra como `authenticator`, así que no la cumple.

CREATE OR REPLACE FUNCTION public.registrar_invocacion(
  p_request_id bigint,
  p_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (
       auth.role() IS NULL
       AND session_user IN ('postgres', 'supabase_admin')
     ) THEN
    RAISE EXCEPTION 'Sólo el backend puede registrar invocaciones'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- La instrumentación no rompe el trabajo que mide, pero la guarda queda
  -- afuera de este sub-bloque para que no pueda ser tragada por WHEN OTHERS.
  BEGIN
    INSERT INTO public.edge_invocation_log (request_id, function_name)
    VALUES (p_request_id, p_name);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'registrar_invocacion(%): %', p_name, SQLERRM;
  END;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reconciliar_invocaciones()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $fn$
DECLARE
  v_n integer;
  v_huerfanas integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (
       auth.role() IS NULL
       AND session_user IN ('postgres', 'supabase_admin')
     ) THEN
    RAISE EXCEPTION 'Sólo el backend puede reconciliar invocaciones'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

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

  UPDATE public.edge_invocation_log
     SET reconciled_at = now(),
         error_msg = COALESCE(
           error_msg,
           'sin respuesta registrada antes de la poda de pg_net'
         )
   WHERE reconciled_at IS NULL
     AND invoked_at < now() - interval '6 hours';
  GET DIAGNOSTICS v_huerfanas = ROW_COUNT;

  IF v_huerfanas > 0 THEN
    RAISE WARNING 'reconciliar_invocaciones: % invocaciones sin respuesta',
      v_huerfanas;
  END IF;
  RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.podar_invocaciones(
  p_dias integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (
       auth.role() IS NULL
       AND session_user IN ('postgres', 'supabase_admin')
     ) THEN
    RAISE EXCEPTION 'Sólo el backend puede podar invocaciones'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.edge_invocation_log
   WHERE invoked_at < now() - make_interval(days => greatest(7, p_dias));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cambios_de_precio_a_aplicar()
RETURNS TABLE (
  target_id uuid,
  cambio_id uuid,
  subscription_id uuid,
  org_id uuid,
  mp_preapproval_id text,
  precio_anterior numeric,
  precio_nuevo numeric,
  ciclo text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (
       auth.role() IS NULL
       AND session_user IN ('postgres', 'supabase_admin')
     ) THEN
    RAISE EXCEPTION 'Sólo el backend puede leer cambios de precio pendientes'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT t.id, c.id, s.id, t.org_id, s.mp_preapproval_id,
         t.precio_anterior, t.precio_nuevo, c.ciclo
    FROM public.plan_price_change_targets t
    JOIN public.plan_price_changes c ON c.id = t.cambio_id
    JOIN public.subscriptions s ON s.id = t.subscription_id
   WHERE c.estado <> 'cancelado'
     AND t.estado IN ('pendiente', 'notificado')
     AND c.vigente_desde <= CURRENT_DATE
     AND s.mp_preapproval_id IS NOT NULL
     AND s.status IN ('active', 'past_due');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.registrar_cambio_de_precio(
  p_target_id uuid,
  p_estado text,
  p_error text DEFAULT NULL,
  p_respuesta jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_target public.plan_price_change_targets;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (
       auth.role() IS NULL
       AND session_user IN ('postgres', 'supabase_admin')
     ) THEN
    RAISE EXCEPTION 'Sólo el backend puede registrar cambios de precio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_estado NOT IN ('aplicado', 'requiere_reautorizacion', 'error', 'notificado') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_estado
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.plan_price_change_targets
     SET estado = p_estado,
         error = p_error,
         mp_respuesta = COALESCE(p_respuesta, mp_respuesta),
         aplicado_at = CASE
           WHEN p_estado = 'aplicado' THEN now()
           ELSE aplicado_at
         END,
         notificado_at = CASE
           WHEN p_estado = 'notificado' THEN now()
           ELSE notificado_at
         END
   WHERE id = p_target_id
  RETURNING * INTO v_target;

  IF p_estado = 'aplicado' THEN
    UPDATE public.subscriptions
       SET precio_ars = v_target.precio_nuevo,
           precio_ars_desde = now()
     WHERE id = v_target.subscription_id;
  END IF;

  UPDATE public.plan_price_changes c
     SET estado = 'aplicado', aplicado_at = now()
   WHERE c.id = v_target.cambio_id
     AND c.estado <> 'cancelado'
     AND NOT EXISTS (
       SELECT 1
       FROM public.plan_price_change_targets t
       WHERE t.cambio_id = c.id
         AND t.estado IN ('pendiente', 'notificado')
     );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ia_registrar_consumo(
  p_org uuid,
  p_user uuid,
  p_model text,
  p_input int DEFAULT 0,
  p_output int DEFAULT 0,
  p_costo numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (
       auth.role() IS NULL
       AND session_user IN ('postgres', 'supabase_admin')
     ) THEN
    RAISE EXCEPTION 'Sólo el backend puede registrar consumo de IA'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.ai_usage_stats AS u (
    org_id, user_id, date, model, input_tokens, output_tokens,
    request_count, estimated_cost_usd
  ) VALUES (
    p_org, p_user, current_date, COALESCE(p_model, 'desconocido'),
    GREATEST(p_input, 0), GREATEST(p_output, 0), 1, p_costo
  )
  ON CONFLICT (org_id, date, model, user_id) DO UPDATE
     SET input_tokens = u.input_tokens + EXCLUDED.input_tokens,
         output_tokens = u.output_tokens + EXCLUDED.output_tokens,
         request_count = u.request_count + 1,
         estimated_cost_usd = COALESCE(u.estimated_cost_usd, 0)
                            + COALESCE(EXCLUDED.estimated_cost_usd, 0);
END;
$fn$;

-- Revocar PUBLIC no basta cuando la base conserva grants directos. Se nombran
-- los dos roles del navegador en cada firma y luego se devuelve sólo al backend.
REVOKE ALL ON FUNCTION public.registrar_invocacion(bigint, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconciliar_invocaciones()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.podar_invocaciones(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cambios_de_precio_a_aplicar()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_cambio_de_precio(uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ia_registrar_consumo(uuid, uuid, text, int, int, numeric)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.registrar_invocacion(bigint, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reconciliar_invocaciones()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.podar_invocaciones(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cambios_de_precio_a_aplicar()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.registrar_cambio_de_precio(uuid, text, text, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.ia_registrar_consumo(uuid, uuid, text, int, int, numeric)
  TO service_role;

-- Tres helpers heredados exponían el rol de cualquier UUID conocido a anon.
-- Las policies sólo los llaman como el usuario autenticado; service_role sigue
-- disponible para procesos administrativos.
REVOKE ALL ON FUNCTION public.platform_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated, service_role;

-- `precio_sugerido` sólo calcula sobre números que entrega quien llama; no lee
-- costo almacenado. Aun así no pertenece al storefront y hacía que la guarda de
-- costo público quedara roja. Se conserva para miembros y procesos internos.
REVOKE ALL ON FUNCTION public.precio_sugerido(numeric, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.precio_sugerido(numeric, numeric, text)
  TO authenticated, service_role;

DO $verification$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.registrar_invocacion(bigint,text)',
    'public.reconciliar_invocaciones()',
    'public.podar_invocaciones(integer)',
    'public.cambios_de_precio_a_aplicar()',
    'public.registrar_cambio_de_precio(uuid,text,text,jsonb)',
    'public.ia_registrar_consumo(uuid,uuid,text,integer,integer,numeric)'
  ] LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR has_function_privilege('authenticated', v_signature, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '% no quedó exclusiva de service_role', v_signature;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.platform_role(uuid)',
    'public.has_role(uuid,public.app_role)',
    'public.get_user_role(uuid)',
    'public.precio_sugerido(numeric,numeric,text)'
  ] LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '% conserva una ACL incorrecta', v_signature;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.audit_costo_expuesto) THEN
    RAISE EXCEPTION 'audit_costo_expuesto no quedó vacía';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.audit_funciones_expuestas
    WHERE funcion = ANY(ARRAY[
      'registrar_invocacion',
      'reconciliar_invocaciones',
      'podar_invocaciones',
      'cambios_de_precio_a_aplicar',
      'registrar_cambio_de_precio',
      'ia_registrar_consumo'
    ])
  ) THEN
    RAISE EXCEPTION 'Una función interna todavía aparece expuesta';
  END IF;
END;
$verification$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000160', 'las_funciones_internas_no_son_anonimas')
ON CONFLICT DO NOTHING;
