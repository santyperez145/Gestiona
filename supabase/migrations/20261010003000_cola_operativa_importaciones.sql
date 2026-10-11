-- ═══════════════════════════════════════════════════════════════════════════
-- Cola operativa de Platform: suma las importaciones de catálogo trabadas
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `platform_operations_queue` junta lo que el equipo tiene que mirar (outbox,
-- avisos de MercadoLibre, intentos de cobro, trabajos programados). Medido
-- 2026-10-10: las 12 sesiones de importación de Ferretería Famatina, 8
-- trabadas, no aparecían en ninguna cola: sólo se vieron revisando la base.
--
-- Cambio: una quinta fuente, `catalog_import`, con cada sesión sin terminar ni
-- cancelar y sin avance hace más de 30 minutos (la misma regla que
-- `platform_importaciones_catalogo`). `attempts` lleva las filas aplicadas;
-- la acción es revisar el comercio. Mismas columnas y mismo filtro de
-- plataforma; se parte de la definición vigente.
--
-- Idempotente (CREATE OR REPLACE VIEW). Reversible: la definición anterior.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE VIEW public.platform_operations_queue AS
 WITH incidents AS (
         SELECT o.id::text AS ticket_id,
            'outbox'::text AS source,
            'Entrega de evento'::text AS operation_label,
                CASE
                    WHEN o.estado = 'descartado'::text THEN 'critical'::text
                    ELSE 'warning'::text
                END AS severity,
                CASE
                    WHEN o.estado = 'en_curso'::text THEN 'stalled'::text
                    ELSE o.estado
                END AS status,
                CASE
                    WHEN o.estado = 'descartado'::text THEN 1
                    ELSE 2
                END AS priority,
            o.org_id,
            o.intentos AS attempts,
            o.created_at AS first_detected_at,
            COALESCE(o.tomado_at, o.proximo_intento, o.created_at) AS last_activity_at,
                CASE
                    WHEN o.estado = 'descartado'::text THEN 'retry_outbox'::text
                    ELSE 'await_worker'::text
                END AS recommended_action,
            o.estado = 'descartado'::text AS can_retry
           FROM outbox_events o
          WHERE (o.estado = ANY (ARRAY['fallado'::text, 'descartado'::text])) OR o.estado = 'en_curso'::text AND o.tomado_at < (now() - '00:05:00'::interval)
        UNION ALL
         SELECT m.id::text AS ticket_id,
            'meli_webhook'::text AS source,
            'Webhook de órdenes MercadoLibre'::text AS operation_label,
                CASE
                    WHEN m.status = 'failed'::text THEN 'critical'::text
                    ELSE 'warning'::text
                END AS severity,
                CASE
                    WHEN m.status = 'processing'::text THEN 'stalled'::text
                    ELSE m.status
                END AS status,
                CASE
                    WHEN m.status = 'failed'::text THEN 1
                    ELSE 2
                END AS priority,
            m.org_id,
            m.attempts,
            m.created_at AS first_detected_at,
            COALESCE(m.processing_started_at, m.updated_at, m.created_at) AS last_activity_at,
            'review_merchant'::text AS recommended_action,
            false AS can_retry
           FROM meli_webhook_events m
          WHERE m.status = 'failed'::text OR m.status = 'processing'::text AND m.processing_started_at < (now() - '00:10:00'::interval)
        UNION ALL
         SELECT a.id::text AS ticket_id,
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
           FROM payment_attempts a
          WHERE a.estado = 'error'::text
        UNION ALL
         SELECT concat('cron:', c.jobid) AS ticket_id,
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
           FROM platform_cron_health c
          WHERE c.estado = 'fallando'::text
        UNION ALL
         SELECT concat('catalog_import:', s.id) AS ticket_id,
            'catalog_import'::text AS source,
            'Importación de catálogo trabada'::text AS operation_label,
            'warning'::text AS severity,
            'trabada'::text AS status,
            2 AS priority,
            s.org_id,
            s.applied AS attempts,
            s.created_at AS first_detected_at,
            s.updated_at AS last_activity_at,
            'review_merchant'::text AS recommended_action,
            false AS can_retry
           FROM catalog_import_sessions s
          WHERE s.status = ANY (ARRAY['preparing'::text, 'ready'::text, 'applying'::text])
            AND s.updated_at < (now() - '00:30:00'::interval)
        )
 SELECT i.ticket_id,
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
     LEFT JOIN organizations org ON org.id = i.org_id
  WHERE is_platform_admin(auth.uid());

ALTER VIEW public.platform_operations_queue SET (security_invoker = false);
REVOKE ALL ON public.platform_operations_queue FROM PUBLIC, anon;
GRANT SELECT ON public.platform_operations_queue TO authenticated;

COMMIT;
