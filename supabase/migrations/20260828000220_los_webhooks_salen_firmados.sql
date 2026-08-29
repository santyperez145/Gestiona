-- Los webhooks salientes tenían dos configuraciones paralelas y ambas
-- exponían el secreto: settings.webhook_secret era legible por cualquier
-- miembro y webhook_configs.secret_value volvía al navegador con select('*').
--
-- A partir de acá hay una sola configuración. El endpoint se administra con
-- RPCs acotados a owner/admin, cada destino tiene un secreto aleatorio propio
-- que se muestra una sola vez, y las entregas sólo las escribe service_role.

CREATE TABLE IF NOT EXISTS public.webhook_signing_secrets (
  webhook_id uuid PRIMARY KEY REFERENCES public.webhook_configs(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  secret text NOT NULL CHECK (length(secret) >= 50),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now(),
  rotated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.webhook_signing_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.webhook_signing_secrets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.webhook_signing_secrets TO service_role;

-- Preserva configuraciones preexistentes. En producción eran 0 al aplicar esta
-- migración, pero la reconstrucción sigue siendo segura si aparece alguna.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'webhook_configs' AND column_name = 'secret_value'
  ) THEN
    EXECUTE $backfill$
      INSERT INTO public.webhook_signing_secrets (webhook_id, org_id, secret)
      SELECT
        w.id,
        w.org_id,
        CASE
          WHEN length(nullif(btrim(w.secret_value), '')) >= 50 THEN btrim(w.secret_value)
          ELSE 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex')
        END
      FROM public.webhook_configs w
      ON CONFLICT (webhook_id) DO NOTHING
    $backfill$;
  ELSE
    INSERT INTO public.webhook_signing_secrets (webhook_id, org_id, secret)
    SELECT w.id, w.org_id, 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex')
    FROM public.webhook_configs w
    ON CONFLICT (webhook_id) DO NOTHING;
  END IF;
END;
$$;

ALTER TABLE public.webhook_configs
  DROP COLUMN IF EXISTS secret_header,
  DROP COLUMN IF EXISTS secret_value;

-- Una entrega nueva se correlaciona por id, no por URL. La columna queda
-- nullable sólo para no inventar pertenencia en un historial legado que haya
-- quedado sin config; las escrituras nuevas siempre la completan.
ALTER TABLE public.webhook_deliveries
  ADD COLUMN IF NOT EXISTS webhook_id uuid REFERENCES public.webhook_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0);

CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_created_idx
  ON public.webhook_deliveries(webhook_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.actualizar_salud_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.webhook_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.webhook_configs
  SET last_fired_at = NEW.created_at,
      success_count = success_count + CASE WHEN NEW.delivered THEN 1 ELSE 0 END,
      failure_count = failure_count + CASE WHEN NEW.delivered THEN 0 ELSE 1 END,
      updated_at = now()
  WHERE id = NEW.webhook_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS webhook_delivery_actualiza_salud ON public.webhook_deliveries;
CREATE TRIGGER webhook_delivery_actualiza_salud
AFTER INSERT ON public.webhook_deliveries
FOR EACH ROW EXECUTE FUNCTION public.actualizar_salud_webhook();

REVOKE ALL ON FUNCTION public.actualizar_salud_webhook() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actualizar_salud_webhook() TO service_role;

-- Sólo se ofrecen eventos que hoy tienen un emisor real. Agregar una etiqueta
-- a la UI sin un productor vuelve a prometer una integración que nunca sale.
CREATE OR REPLACE FUNCTION public.webhook_config_guardar(
  p_org_id uuid,
  p_webhook_id uuid,
  p_name text,
  p_url text,
  p_event_types text[],
  p_active boolean DEFAULT true,
  p_retry_on_fail boolean DEFAULT true,
  p_max_retries integer DEFAULT 2,
  p_timeout_seconds integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_secret text;
  v_url text := btrim(coalesce(p_url, ''));
  v_host text;
  v_supported constant text[] := ARRAY['sale.created', 'automation.triggered'];
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo dueños o administradores pueden gestionar webhooks' USING ERRCODE = '42501';
  END IF;

  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'El nombre debe tener entre 1 y 120 caracteres' USING ERRCODE = '22023';
  END IF;
  IF length(v_url) > 2048 OR v_url !~* '^https://[^[:space:]/?#]+(?:[/?][^[:space:]#]*)?$' OR v_url ~ '#' THEN
    RAISE EXCEPTION 'El endpoint debe ser una URL HTTPS pública válida' USING ERRCODE = '22023';
  END IF;
  IF v_url ~* '^https://[^/]*@' THEN
    RAISE EXCEPTION 'El endpoint no puede incluir credenciales' USING ERRCODE = '22023';
  END IF;

  v_host := lower((regexp_match(v_url, '^https://([^/:?#]+)'))[1]);
  IF v_host IS NULL
     OR v_host IN ('localhost', 'metadata.google.internal', 'metadata.amazonaws.com')
     OR v_host ~ '\.(local|internal|localhost)$'
     OR v_host ~ '^127\.'
     OR v_host ~ '^10\.'
     OR v_host ~ '^0\.'
     OR v_host ~ '^169\.254\.'
     OR v_host ~ '^192\.168\.'
     OR v_host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.'
     OR v_host ~ '^\[' THEN
    RAISE EXCEPTION 'El endpoint debe resolver a un host público' USING ERRCODE = '22023';
  END IF;

  IF coalesce(array_length(p_event_types, 1), 0) = 0
     OR EXISTS (
       SELECT 1 FROM unnest(p_event_types) AS event_name
       WHERE NOT (event_name = ANY(v_supported))
     ) THEN
    RAISE EXCEPTION 'Seleccioná al menos un evento soportado' USING ERRCODE = '22023';
  END IF;
  IF p_max_retries NOT BETWEEN 0 AND 3 OR p_timeout_seconds NOT BETWEEN 3 AND 15 THEN
    RAISE EXCEPTION 'Reintentos o timeout fuera del rango permitido' USING ERRCODE = '22023';
  END IF;

  IF p_webhook_id IS NULL THEN
    INSERT INTO public.webhook_configs (
      org_id, name, url, event_types, active, retry_on_fail, max_retries, timeout_seconds
    ) VALUES (
      p_org_id, btrim(p_name), v_url, p_event_types, coalesce(p_active, true),
      coalesce(p_retry_on_fail, true), p_max_retries, p_timeout_seconds
    ) RETURNING id INTO v_id;

    v_secret := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');
    INSERT INTO public.webhook_signing_secrets (webhook_id, org_id, secret, rotated_by)
    VALUES (v_id, p_org_id, v_secret, auth.uid());
  ELSE
    UPDATE public.webhook_configs
    SET name = btrim(p_name),
        url = v_url,
        event_types = p_event_types,
        active = coalesce(p_active, true),
        retry_on_fail = coalesce(p_retry_on_fail, true),
        max_retries = p_max_retries,
        timeout_seconds = p_timeout_seconds,
        updated_at = now()
    WHERE id = p_webhook_id AND org_id = p_org_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Webhook inexistente o fuera de la organización' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'signing_secret', v_secret);
END;
$$;

CREATE OR REPLACE FUNCTION public.webhook_secret_rotar(p_org_id uuid, p_webhook_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_secret text := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo dueños o administradores pueden rotar secretos' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.webhook_configs WHERE id = p_webhook_id AND org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'Webhook inexistente o fuera de la organización' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.webhook_signing_secrets (webhook_id, org_id, secret, rotated_by)
  VALUES (p_webhook_id, p_org_id, v_secret, auth.uid())
  ON CONFLICT (webhook_id) DO UPDATE
    SET secret = EXCLUDED.secret,
        org_id = EXCLUDED.org_id,
        rotated_at = now(),
        rotated_by = auth.uid();

  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public.webhook_config_eliminar(p_org_id uuid, p_webhook_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo dueños o administradores pueden eliminar webhooks' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.webhook_configs WHERE id = p_webhook_id AND org_id = p_org_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.webhook_config_guardar(uuid, uuid, text, text, text[], boolean, boolean, integer, integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.webhook_secret_rotar(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.webhook_config_eliminar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webhook_config_guardar(uuid, uuid, text, text, text[], boolean, boolean, integer, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.webhook_secret_rotar(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.webhook_config_eliminar(uuid, uuid) TO authenticated, service_role;

-- Config: los miembros ven los datos no secretos; sólo los RPC administran.
REVOKE ALL ON TABLE public.webhook_configs FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.webhook_configs FROM authenticated;
GRANT SELECT ON TABLE public.webhook_configs TO authenticated, service_role;

-- Historial: los miembros lo consultan, sólo el backend lo escribe.
DROP POLICY IF EXISTS webhook_deliveries_org ON public.webhook_deliveries;
REVOKE ALL ON TABLE public.webhook_deliveries FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.webhook_deliveries FROM authenticated;
GRANT SELECT ON TABLE public.webhook_deliveries TO authenticated, service_role;

-- Se retira la configuración simple: eran 0 endpoints y 0 secrets en
-- producción al 2026-08-29. Mantenerla duplicaba UI y autoridad.
ALTER TABLE public.settings
  DROP COLUMN IF EXISTS webhook_url,
  DROP COLUMN IF EXISTS webhook_enabled,
  DROP COLUMN IF EXISTS webhook_events,
  DROP COLUMN IF EXISTS webhook_secret;

-- Había dos crons activos sobre la misma tabla automation_flows: uno a las
-- 05:00 AR y otro a las 08:00 AR. Una regla podía actuar (y emitir webhook)
-- dos veces por día. `execute-automations` es el motor que usa también el botón
-- "Ejecutar ahora"; queda como única autoridad, a las 08:00 Argentina.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-automation-flows-daily') THEN
    PERFORM cron.unschedule('run-automation-flows-daily');
  END IF;
  PERFORM cron.schedule(
    'execute-automations-daily',
    '0 11 * * *',
    'SELECT public.invoke_edge_function(''execute-automations'');'
  );
END;
$$;

DO $$
DECLARE
  v_open_policies integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'webhook_configs'
      AND column_name IN ('secret_header', 'secret_value')
  ) THEN
    RAISE EXCEPTION 'webhook_configs todavía expone secretos';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'settings'
      AND column_name IN ('webhook_url', 'webhook_enabled', 'webhook_events', 'webhook_secret')
  ) THEN
    RAISE EXCEPTION 'settings todavía conserva el webhook legado';
  END IF;
  IF has_table_privilege('anon', 'public.webhook_signing_secrets', 'SELECT')
     OR has_table_privilege('authenticated', 'public.webhook_signing_secrets', 'SELECT')
     OR has_table_privilege('authenticated', 'public.webhook_deliveries', 'INSERT')
     OR has_table_privilege('authenticated', 'public.webhook_configs', 'UPDATE') THEN
    RAISE EXCEPTION 'Un rol cliente conserva acceso de escritura o al secret';
  END IF;
  SELECT count(*) INTO v_open_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'webhook_signing_secrets';
  IF v_open_policies <> 0 THEN
    RAISE EXCEPTION 'webhook_signing_secrets debe tener RLS sin policies';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('execute-automations-daily', 'run-automation-flows-daily')) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM cron.job
       WHERE jobname = 'execute-automations-daily' AND active AND schedule = '0 11 * * *'
     ) THEN
    RAISE EXCEPTION 'Las automatizaciones conservan más de un cron o un horario incorrecto';
  END IF;
END;
$$;

COMMENT ON TABLE public.webhook_signing_secrets IS
  'Secretos HMAC de webhooks salientes. RLS sin policies: sólo service_role.';
COMMENT ON FUNCTION public.webhook_config_guardar(uuid, uuid, text, text, text[], boolean, boolean, integer, integer) IS
  'Crea/edita un endpoint; al crearlo devuelve el secret una única vez.';
COMMENT ON FUNCTION public.webhook_secret_rotar(uuid, uuid) IS
  'Rota el secret HMAC y devuelve el nuevo valor una única vez.';
