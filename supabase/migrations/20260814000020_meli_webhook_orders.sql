-- C7 / MercadoLibre: las notificaciones aceleran el ingreso de órdenes sin
-- convertir su body en una fuente de verdad. El callback sólo encola el aviso
-- y la Edge Function vuelve a leer GET /orders/{id} con el OAuth del vendedor.
-- Así una llamada pública falsa no puede cambiar una venta, stock ni precio.
--
-- Una cuenta vendedora pertenece a una única organización. Sin esa invariante
-- un mismo webhook podría atribuir la misma orden a dos Business Cores.

CREATE UNIQUE INDEX IF NOT EXISTS meli_connections_unique_seller_idx
  ON public.meli_connections (meli_user_id)
  WHERE meli_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.meli_webhook_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meli_user_id        bigint NOT NULL,
  notification_id     text NOT NULL CHECK (char_length(notification_id) BETWEEN 1 AND 200),
  topic               text NOT NULL CHECK (char_length(topic) BETWEEN 1 AND 100),
  resource            text NOT NULL CHECK (char_length(resource) BETWEEN 1 AND 300),
  notification_sent_at timestamptz,
  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'processing', 'processed', 'failed')),
  attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error          text,
  processing_started_at timestamptz,
  processed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, notification_id)
);

CREATE INDEX IF NOT EXISTS meli_webhook_events_pending_idx
  ON public.meli_webhook_events (org_id, status, created_at DESC);

ALTER TABLE public.meli_webhook_events ENABLE ROW LEVEL SECURITY;

-- El registro conserva sólo metadatos técnicos, no el body crudo que puede
-- incluir datos de comprador. Tampoco se expone al navegador: lo usa la Edge
-- Function con service_role para deduplicar y diagnosticar el procesamiento.
REVOKE ALL ON TABLE public.meli_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meli_webhook_events TO service_role;

-- Inserta una notificación nueva o reintenta sólo una que falló (o quedó
-- procesando durante una caída). Un duplicado sano devuelve NULL: no vuelve a
-- consumir la API de MercadoLibre ni reabre una orden ya descargada.
CREATE OR REPLACE FUNCTION public.enqueue_meli_webhook_event(
  p_org_id uuid,
  p_meli_user_id bigint,
  p_notification_id text,
  p_topic text,
  p_resource text,
  p_notification_sent_at timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO public.meli_webhook_events (
    org_id, meli_user_id, notification_id, topic, resource, notification_sent_at
  ) VALUES (
    p_org_id, p_meli_user_id, p_notification_id, p_topic, p_resource, p_notification_sent_at
  )
  ON CONFLICT (org_id, notification_id) DO UPDATE
    SET status = 'queued',
        attempts = public.meli_webhook_events.attempts + 1,
        last_error = NULL,
        processing_started_at = NULL,
        processed_at = NULL,
        updated_at = now()
    WHERE public.meli_webhook_events.status = 'failed'
       OR (
         public.meli_webhook_events.status = 'processing'
         AND public.meli_webhook_events.processing_started_at < now() - interval '10 minutes'
       )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_meli_webhook_event(uuid, bigint, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_meli_webhook_event(uuid, bigint, text, text, text, timestamptz)
  TO service_role;

DO $$
BEGIN
  IF to_regclass('public.meli_webhook_events') IS NULL THEN
    RAISE EXCEPTION 'No se creó meli_webhook_events';
  END IF;
  IF has_table_privilege('anon', 'public.meli_webhook_events', 'SELECT')
     OR has_table_privilege('anon', 'public.meli_webhook_events', 'INSERT')
     OR has_table_privilege('authenticated', 'public.meli_webhook_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.meli_webhook_events', 'INSERT') THEN
    RAISE EXCEPTION 'La bandeja de MercadoLibre no puede quedar expuesta al navegador';
  END IF;
  IF has_function_privilege('anon', 'public.enqueue_meli_webhook_event(uuid, bigint, text, text, text, timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.enqueue_meli_webhook_event(uuid, bigint, text, text, text, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'El enqueue del webhook no puede quedar ejecutable desde el navegador';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.meli_connections
    WHERE meli_user_id IS NOT NULL
    GROUP BY meli_user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Un vendedor de MercadoLibre quedó conectado a más de una organización';
  END IF;
END;
$$;
