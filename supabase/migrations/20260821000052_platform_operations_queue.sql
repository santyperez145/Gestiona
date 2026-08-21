-- Cola operativa de plataforma.
--
-- Reúne incidentes que ya existen en los caminos reales: entrega de eventos,
-- webhook de MercadoLibre, intento técnico de cobro y cron. No convierte la
-- plataforma en una consola de base: expone sólo el tipo, estado, antigüedad y
-- comercio afectado. Direcciones de webhook, payloads, IDs externos, montos y
-- mensajes de proveedor quedan deliberadamente afuera.

CREATE OR REPLACE VIEW public.platform_operations_queue AS
WITH incidents AS (
  SELECT
    o.id::text AS ticket_id,
    'outbox'::text AS source,
    'Entrega de evento'::text AS operation_label,
    CASE WHEN o.estado = 'descartado' THEN 'critical' ELSE 'warning' END AS severity,
    CASE WHEN o.estado = 'en_curso' THEN 'stalled' ELSE o.estado END AS status,
    CASE WHEN o.estado = 'descartado' THEN 1 ELSE 2 END AS priority,
    o.org_id,
    o.intentos AS attempts,
    o.created_at AS first_detected_at,
    COALESCE(o.tomado_at, o.proximo_intento, o.created_at) AS last_activity_at,
    CASE WHEN o.estado = 'descartado' THEN 'retry_outbox' ELSE 'await_worker' END AS recommended_action,
    (o.estado = 'descartado') AS can_retry
  FROM public.outbox_events o
  WHERE o.estado IN ('fallado', 'descartado')
     OR (o.estado = 'en_curso' AND o.tomado_at < now() - interval '5 minutes')

  UNION ALL

  SELECT
    m.id::text AS ticket_id,
    'meli_webhook'::text AS source,
    'Webhook de órdenes MercadoLibre'::text AS operation_label,
    CASE WHEN m.status = 'failed' THEN 'critical' ELSE 'warning' END AS severity,
    CASE WHEN m.status = 'processing' THEN 'stalled' ELSE m.status END AS status,
    CASE WHEN m.status = 'failed' THEN 1 ELSE 2 END AS priority,
    m.org_id,
    m.attempts,
    m.created_at AS first_detected_at,
    COALESCE(m.processing_started_at, m.updated_at, m.created_at) AS last_activity_at,
    'review_merchant'::text AS recommended_action,
    false AS can_retry
  FROM public.meli_webhook_events m
  WHERE m.status = 'failed'
     OR (m.status = 'processing' AND m.processing_started_at < now() - interval '10 minutes')

  UNION ALL

  SELECT
    a.id::text AS ticket_id,
    'payment_attempt'::text AS source,
    'Intento técnico de cobro'::text AS operation_label,
    'critical'::text AS severity,
    a.estado AS status,
    1 AS priority,
    a.org_id,
    a.nro AS attempts,
    a.created_at AS first_detected_at,
    COALESCE(a.resuelto_at, a.created_at) AS last_activity_at,
    'review_merchant'::text AS recommended_action,
    false AS can_retry
  FROM public.payment_attempts a
  WHERE a.estado = 'error'

  UNION ALL

  SELECT
    concat('cron:', c.jobid)::text AS ticket_id,
    'cron'::text AS source,
    'Trabajo programado'::text AS operation_label,
    'critical'::text AS severity,
    c.estado AS status,
    1 AS priority,
    NULL::uuid AS org_id,
    c.failed_runs_7d AS attempts,
    c.last_run_at AS first_detected_at,
    c.last_run_at AS last_activity_at,
    'open_system'::text AS recommended_action,
    false AS can_retry
  FROM public.platform_cron_health c
  WHERE c.estado = 'fallando'
)
SELECT
  i.ticket_id,
  i.source,
  i.operation_label,
  i.severity,
  i.status,
  i.priority,
  i.org_id,
  org.name AS org_name,
  i.attempts,
  i.first_detected_at,
  i.last_activity_at,
  i.recommended_action,
  i.can_retry
FROM incidents i
LEFT JOIN public.organizations org ON org.id = i.org_id
WHERE public.is_platform_admin(auth.uid());

ALTER VIEW public.platform_operations_queue SET (security_invoker = false);
REVOKE ALL ON public.platform_operations_queue FROM PUBLIC, anon;
GRANT SELECT ON public.platform_operations_queue TO authenticated;

COMMENT ON VIEW public.platform_operations_queue IS
  'Bandeja staff-only de incidentes operativos sanitizados. Nunca expone payloads, destinos, IDs externos, montos, errores crudos ni secretos.';

-- El cliente no usa `outbox_reintentar` directo. La Edge Function valida que
-- quien actúa sea superadmin y llama a este RPC sólo con service_role; así la
-- transición y el audit log viven en la misma transacción. Reintentar un
-- cobro no está permitido acá: un resultado ambiguo puede terminar en doble
-- cargo y requiere el flujo específico de pagos.
CREATE OR REPLACE FUNCTION public.platform_retry_outbox_delivery(
  p_ticket_id uuid,
  p_admin_user_id uuid,
  p_admin_email text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket public.outbox_events;
BEGIN
  SELECT * INTO v_ticket
  FROM public.outbox_events
  WHERE id = p_ticket_id
  FOR UPDATE;

  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'El incidente de entrega no existe';
  END IF;
  IF v_ticket.estado <> 'descartado' THEN
    RAISE EXCEPTION 'Sólo se puede reintentar una entrega descartada';
  END IF;

  UPDATE public.outbox_events
  SET estado = 'pendiente',
      intentos = 0,
      proximo_intento = now(),
      ultimo_error = NULL,
      tomado_por = NULL,
      tomado_at = NULL
  WHERE id = v_ticket.id;

  INSERT INTO public.admin_audit_logs (
    admin_user_id, admin_email, action, target_org_id, details
  ) VALUES (
    p_admin_user_id,
    p_admin_email,
    'retryOutboxDelivery',
    v_ticket.org_id,
    jsonb_build_object('source', 'outbox', 'ticket_id', v_ticket.id)
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_retry_outbox_delivery(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_retry_outbox_delivery(uuid, uuid, text)
  TO service_role;

DO $$
DECLARE
  v_sensitive_columns integer;
BEGIN
  SELECT count(*) INTO v_sensitive_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'platform_operations_queue'
    AND column_name IN (
      'objetivo', 'payload', 'ultimo_error', 'resource', 'last_error',
      'external_id', 'motivo', 'raw', 'message', 'monto'
    );

  IF v_sensitive_columns <> 0 THEN
    RAISE EXCEPTION 'La cola operativa expone % columnas sensibles', v_sensitive_columns;
  END IF;

  IF has_table_privilege('anon', 'public.platform_operations_queue', 'SELECT') THEN
    RAISE EXCEPTION 'La cola operativa quedó visible para anon';
  END IF;

  IF has_function_privilege('anon', 'public.platform_retry_outbox_delivery(uuid, uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.platform_retry_outbox_delivery(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'El reintento de plataforma quedó ejecutable desde el navegador';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260821000052', 'platform_operations_queue') ON CONFLICT DO NOTHING;
