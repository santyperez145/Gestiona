-- Dos invocaciones de la auditoría 2026-08-28 no demostraron recuperación:
--
--   * fetch-usd-rate devolvió 401 porque la puerta aceptaba al cron y el cuerpo
--     volvía a exigir un usuario. Además no existía ningún job diario.
--   * send-birthday-whatsapp devolvió 500 antes de encontrar candidatos:
--     customers.birthday es DATE y PostgREST intentaba aplicarle LIKE. Después
--     exigía una conexión Evolution que se retiró del producto, y armaba texto
--     libre para una notificación proactiva de Meta.
--
-- Este slice no dispara ninguna de las dos funciones. Deja autoridad y estado
-- para que la siguiente corrida natural sea observable y segura.

-- El comercio debe optar por la automatización; un DEFAULT true activaba
-- marketing para cada alta nueva. Las dos filas existentes conservan su valor.
ALTER TABLE public.settings
  ALTER COLUMN whatsapp_birthday_enabled SET DEFAULT false;

-- La plantilla es configuración de Plataforma y debe existir/aprobarse en
-- WhatsApp Manager. NULL significa deshabilitada, nunca texto libre de fallback.
ALTER TABLE public.platform_messaging_config
  ADD COLUMN IF NOT EXISTS whatsapp_birthday_template text,
  ADD COLUMN IF NOT EXISTS whatsapp_birthday_template_language text NOT NULL DEFAULT 'es_AR';

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.platform_messaging_config'::regclass
      AND conname = 'platform_messaging_birthday_template_name'
  ) THEN
    ALTER TABLE public.platform_messaging_config
      ADD CONSTRAINT platform_messaging_birthday_template_name
      CHECK (
        whatsapp_birthday_template IS NULL
        OR whatsapp_birthday_template ~ '^[a-z0-9_]{1,512}$'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.platform_messaging_config'::regclass
      AND conname = 'platform_messaging_birthday_template_language'
  ) THEN
    ALTER TABLE public.platform_messaging_config
      ADD CONSTRAINT platform_messaging_birthday_template_language
      CHECK (whatsapp_birthday_template_language ~ '^[a-z]{2,3}_[A-Z]{2}$');
  END IF;
END;
$constraints$;

COMMENT ON COLUMN public.platform_messaging_config.whatsapp_birthday_template IS
  'Plantilla MARKETING aprobada por Meta. Body: {{1}} cliente, {{2}} comercio, {{3}} URL de baja. NULL deshabilita el cron.';

-- Claim durable antes de hablar con Meta. Ante una caída ambigua queda
-- processing y el UNIQUE impide duplicar el saludo en un retry.
CREATE TABLE IF NOT EXISTS public.birthday_whatsapp_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  birthday_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'sent', 'failed')),
  provider_message_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, customer_id, birthday_date)
);

CREATE INDEX IF NOT EXISTS idx_birthday_whatsapp_deliveries_org_date
  ON public.birthday_whatsapp_deliveries(org_id, birthday_date DESC);

ALTER TABLE public.birthday_whatsapp_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.birthday_whatsapp_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.birthday_whatsapp_deliveries TO service_role;

COMMENT ON TABLE public.birthday_whatsapp_deliveries IS
  'Idempotencia y resultado técnico de saludos de cumpleaños. Sólo service_role; no expone teléfonos ni texto del mensaje.';

-- DATE se compara como DATE. La Edge no descarga todos los cumpleaños ni
-- aplica operadores textuales inválidos. Sólo salen opt-in vigente + org opt-in.
CREATE OR REPLACE FUNCTION public.birthday_whatsapp_candidates(
  p_run_date date DEFAULT current_date
)
RETURNS TABLE (
  customer_id uuid,
  customer_name text,
  phone text,
  org_id uuid,
  business_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT
    c.id,
    c.name,
    c.phone,
    c.org_id,
    COALESCE(NULLIF(btrim(s.business_name), ''), NULLIF(btrim(o.name), ''), 'tu comercio')
  FROM public.customers c
  JOIN public.settings s
    ON s.org_id = c.org_id
   AND s.whatsapp_birthday_enabled IS TRUE
  JOIN public.organizations o ON o.id = c.org_id
  WHERE p_run_date IS NOT NULL
    AND c.birthday IS NOT NULL
    AND c.phone IS NOT NULL
    AND btrim(c.phone) <> ''
    AND c.marketing_consent_at IS NOT NULL
    AND c.marketing_opt_out_at IS NULL
    AND extract(month FROM c.birthday) = extract(month FROM p_run_date)
    AND extract(day FROM c.birthday) = extract(day FROM p_run_date)
  ORDER BY c.org_id, c.id
$function$;

REVOKE ALL ON FUNCTION public.birthday_whatsapp_candidates(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.birthday_whatsapp_candidates(date)
  TO service_role;

COMMENT ON FUNCTION public.birthday_whatsapp_candidates(date) IS
  'Destinatarios del saludo para una fecha argentina. Exige opt-in de cliente y organización; sólo service_role.';

-- La cotización de referencia se obtiene una vez por día a las 08:15 de
-- Argentina. public.invoke_edge_function agrega secreto cron y telemetría.
DO $schedule$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'fetch-usd-rate-daily';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'fetch-usd-rate-daily',
    '15 11 * * *',
    $command$SELECT public.invoke_edge_function('fetch-usd-rate');$command$
  );
END;
$schedule$;

DO $verification$
BEGIN
  IF (SELECT column_default <> 'true' FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'settings'
        AND column_name = 'whatsapp_birthday_enabled') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Cumpleaños sigue activándose por default';
  END IF;
  IF has_function_privilege('authenticated', 'public.birthday_whatsapp_candidates(date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated puede enumerar candidatos de cumpleaños';
  END IF;
  IF (SELECT count(*) FROM cron.job
      WHERE jobname = 'fetch-usd-rate-daily' AND active) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Falta el cron diario de cotización';
  END IF;
END;
$verification$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000180', 'las_tareas_programadas_terminan')
ON CONFLICT DO NOTHING;
