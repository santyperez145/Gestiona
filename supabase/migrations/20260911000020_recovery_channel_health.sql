-- Salud operativa del canal de recuperación para el comercio.
--
-- El panel de Recuperación ya sabía si podía enviar (recovery_email_channel_ready),
-- pero no veía si la corrida automática realmente estaba sana. Esto traduce el
-- patrón de colas de operación (Shopify/Tiendanube muestran estado, no sólo acción)
-- sin exponer payloads, destinatarios ni detalles técnicos al navegador.
--
-- Datos agregados, acotados al tenant y al rol miembro.

CREATE OR REPLACE FUNCTION public.recovery_channel_health(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last record;
  v_failures_7d int := 0;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'org requerida';
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'sin permiso';
  END IF;

  SELECT
    l.invoked_at,
    l.responded_at,
    l.status_code,
    l.timed_out,
    l.error_msg
  INTO v_last
  FROM public.edge_invocation_log l
  WHERE l.function_name = 'recover-abandoned-carts'
  ORDER BY l.invoked_at DESC
  LIMIT 1;

  SELECT count(*) INTO v_failures_7d
  FROM public.edge_invocation_log l
  WHERE l.function_name = 'recover-abandoned-carts'
    AND l.invoked_at >= now() - interval '7 days'
    AND (
      l.timed_out
      OR l.status_code IS NULL
      OR l.status_code >= 400
    );

  RETURN jsonb_build_object(
    'last_invoked_at', v_last.invoked_at,
    'last_responded_at', v_last.responded_at,
    'last_status_code', v_last.status_code,
    'last_timed_out', COALESCE(v_last.timed_out, false),
    'failures_7d', COALESCE(v_failures_7d, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recovery_channel_health(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recovery_channel_health(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.recovery_channel_health(uuid) IS
  'Estado agregado del cron recover-abandoned-carts para el comercio (sin payloads ni PII).';

DO $$
BEGIN
  ASSERT to_regprocedure('public.recovery_channel_health(uuid)') IS NOT NULL,
    'falta recovery_channel_health';
  ASSERT has_function_privilege('authenticated', 'public.recovery_channel_health(uuid)', 'EXECUTE'),
    'authenticated debe ejecutar recovery_channel_health';
  ASSERT NOT has_function_privilege('anon', 'public.recovery_channel_health(uuid)', 'EXECUTE'),
    'anon no debe ejecutar recovery_channel_health';
END $$;
