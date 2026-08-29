-- El SMTP propio del comercio deja de guardar su clave en settings.
--
-- `settings` tiene SELECT para los miembros de la organización. RLS decide
-- filas, no columnas: cualquier empleado que pudiera leer Ajustes recibía
-- también `smtp_pass`. La pantalla agravaba el problema diciendo que la clave
-- nunca llegaba al servidor, aunque la escribía literalmente en esa tabla.
--
-- La conexión completa pasa a una tabla con RLS y CERO policies. Sólo las Edge
-- Functions con service_role pueden leerla; el navegador consume una vista de
-- estado saneada que no incluye la contraseña.

CREATE TABLE IF NOT EXISTS public.merchant_smtp_connections (
  org_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  host        text NOT NULL CHECK (host = btrim(host) AND host <> '' AND host !~ '[[:space:]]'),
  port        integer NOT NULL CHECK (port BETWEEN 1 AND 65535),
  username    text NOT NULL CHECK (username = btrim(username) AND username <> ''),
  password    text NOT NULL CHECK (length(password) BETWEEN 8 AND 2048),
  secure      boolean NOT NULL DEFAULT false,
  from_name   text,
  from_email  text NOT NULL CHECK (from_email = btrim(from_email) AND from_email LIKE '%@%'),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.merchant_smtp_connections IS
  'SMTP privado por organización. RLS sin policies: sólo Edge Functions con service_role; la contraseña nunca vuelve al navegador.';

ALTER TABLE public.merchant_smtp_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_smtp_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.merchant_smtp_connections TO service_role;

CREATE OR REPLACE FUNCTION public.touch_merchant_smtp_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_merchant_smtp_updated_at ON public.merchant_smtp_connections;
CREATE TRIGGER trg_merchant_smtp_updated_at
  BEFORE UPDATE ON public.merchant_smtp_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_merchant_smtp_updated_at();

-- Migración defensiva. En producción había 0 contraseñas al 2026-08-29, pero
-- una reconstrucción o una instalación ajena puede tener una configuración.
INSERT INTO public.merchant_smtp_connections (
  org_id, host, port, username, password, secure, from_name, from_email
)
SELECT
  s.org_id,
  btrim(s.smtp_host),
  COALESCE(s.smtp_port, 587),
  btrim(s.smtp_user),
  s.smtp_pass,
  COALESCE(s.smtp_secure, false),
  NULLIF(btrim(s.smtp_from_name), ''),
  COALESCE(NULLIF(btrim(s.smtp_from_email), ''), btrim(s.smtp_user))
FROM public.settings s
WHERE NULLIF(btrim(s.smtp_host), '') IS NOT NULL
  AND NULLIF(btrim(s.smtp_user), '') IS NOT NULL
  AND NULLIF(s.smtp_pass, '') IS NOT NULL
ON CONFLICT (org_id) DO NOTHING;

UPDATE public.settings SET
  smtp_host = NULL,
  smtp_port = 587,
  smtp_user = NULL,
  smtp_pass = NULL,
  smtp_secure = true,
  smtp_from_name = NULL,
  smtp_from_email = NULL
WHERE smtp_host IS NOT NULL
   OR smtp_user IS NOT NULL
   OR smtp_pass IS NOT NULL
   OR smtp_port IS DISTINCT FROM 587
   OR smtp_secure IS DISTINCT FROM true
   OR smtp_from_name IS NOT NULL
   OR smtp_from_email IS NOT NULL;

-- Una pestaña vieja no puede volver a exponer la clave durante el rollout.
CREATE OR REPLACE FUNCTION public.reject_legacy_smtp_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.smtp_host IS NOT NULL
     OR NEW.smtp_port IS DISTINCT FROM 587
     OR NEW.smtp_user IS NOT NULL
     OR NEW.smtp_pass IS NOT NULL
     OR NEW.smtp_secure IS DISTINCT FROM true
     OR NEW.smtp_from_name IS NOT NULL
     OR NEW.smtp_from_email IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'El SMTP se administra únicamente por el servicio seguro de correo';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reject_legacy_smtp_settings ON public.settings;
CREATE TRIGGER trg_reject_legacy_smtp_settings
  BEFORE INSERT OR UPDATE OF smtp_host, smtp_port, smtp_user, smtp_pass,
    smtp_secure, smtp_from_name, smtp_from_email ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.reject_legacy_smtp_settings();

-- No usa security_invoker: la tabla de abajo no tiene policies de navegador.
-- El tenant se acota en el WHERE y la contraseña no forma parte de la vista.
CREATE OR REPLACE VIEW public.merchant_smtp_connection_status AS
SELECT
  c.org_id,
  true AS configured,
  c.host,
  c.port,
  c.username,
  c.secure,
  c.from_name,
  c.from_email,
  c.updated_at
FROM public.merchant_smtp_connections c
WHERE public.is_org_member(c.org_id, auth.uid());

ALTER VIEW public.merchant_smtp_connection_status SET (security_invoker = false);
COMMENT ON VIEW public.merchant_smtp_connection_status IS
  'Estado SMTP saneado para miembros del tenant. Nunca incluye la contraseña.';
REVOKE ALL ON public.merchant_smtp_connection_status FROM PUBLIC, anon;
GRANT SELECT ON public.merchant_smtp_connection_status TO authenticated;

DO $verification$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'merchant_smtp_connections'
  ) THEN
    RAISE EXCEPTION 'merchant_smtp_connections debe tener cero policies';
  END IF;
  IF has_table_privilege('anon', 'public.merchant_smtp_connections', 'SELECT')
     OR has_table_privilege('authenticated', 'public.merchant_smtp_connections', 'SELECT') THEN
    RAISE EXCEPTION 'Una credencial SMTP quedó legible desde el navegador';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.settings
    WHERE smtp_host IS NOT NULL OR smtp_user IS NOT NULL OR smtp_pass IS NOT NULL
       OR smtp_port IS DISTINCT FROM 587 OR smtp_secure IS DISTINCT FROM true
       OR smtp_from_name IS NOT NULL OR smtp_from_email IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Quedó configuración SMTP en settings';
  END IF;
END;
$verification$;

INSERT INTO supabase_migrations.schema_migrations(version, name)
VALUES ('20260828000190', 'el_smtp_del_comercio_es_privado')
ON CONFLICT DO NOTHING;
