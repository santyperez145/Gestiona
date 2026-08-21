-- Credenciales por comercio de Evolution API.
--
-- La clave de Evolution permite enviar WhatsApp como el negocio. Antes vivía
-- en `settings`, una fila que pueden leer los miembros de la organización. No
-- alcanza con ocultarla en la UI: RLS filtra filas, no columnas. Esta tabla no
-- tiene policies de cliente; sólo Edge Functions con service_role la consultan.

CREATE TABLE IF NOT EXISTS public.evolution_connections (
  org_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_url     text NOT NULL,
  api_key     text NOT NULL,
  instance    text NOT NULL DEFAULT 'gestiona',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.evolution_connections IS
  'Credenciales privadas de Evolution API por organización. Sin policies: sólo Edge Functions con service_role.';

ALTER TABLE public.evolution_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.evolution_connections FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.touch_evolution_connection_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evolution_connection_updated_at ON public.evolution_connections;
CREATE TRIGGER trg_evolution_connection_updated_at
  BEFORE UPDATE ON public.evolution_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_evolution_connection_updated_at();

-- Migración única de conexiones ya configuradas. No se sobreescribe una fila
-- protegida si este archivo se vuelve a ejecutar: esa credencial podría haber
-- sido rotada después de la primera aplicación.
INSERT INTO public.evolution_connections (org_id, api_url, api_key, instance)
SELECT
  s.org_id,
  s.evolution_api_url,
  s.evolution_api_key,
  COALESCE(NULLIF(btrim(s.evolution_instance), ''), 'gestiona')
FROM public.settings s
WHERE NULLIF(btrim(s.evolution_api_url), '') IS NOT NULL
  AND NULLIF(btrim(s.evolution_api_key), '') IS NOT NULL
ON CONFLICT (org_id) DO NOTHING;

-- El valor histórico deja de existir en la fila que la UI puede consultar.
-- La columna tenía default `gestiona`; sin quitarlo, cualquier settings nuevo
-- activaría el trigger de protección aunque no intente configurar WhatsApp.
ALTER TABLE public.settings ALTER COLUMN evolution_instance DROP DEFAULT;

UPDATE public.settings
SET
  evolution_api_url = NULL,
  evolution_api_key = NULL,
  evolution_instance = NULL
WHERE evolution_api_url IS NOT NULL
   OR evolution_api_key IS NOT NULL
   OR evolution_instance IS NOT NULL;

-- Mientras las columnas históricas sigan en el esquema para compatibilidad de
-- tipos, impedir que una versión vieja del navegador vuelva a dejar un secreto
-- expuesto. Rechazar es deliberado: silenciar la escritura haría creer que la
-- conexión quedó guardada cuando no fue así.
CREATE OR REPLACE FUNCTION public.reject_legacy_evolution_settings_credentials()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.evolution_api_url IS NOT NULL
     OR NEW.evolution_api_key IS NOT NULL
     OR NEW.evolution_instance IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Las credenciales de Evolution API se guardan sólo por el servicio seguro de integraciones';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_legacy_evolution_settings_credentials ON public.settings;
CREATE TRIGGER trg_reject_legacy_evolution_settings_credentials
  BEFORE INSERT OR UPDATE OF evolution_api_url, evolution_api_key, evolution_instance ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.reject_legacy_evolution_settings_credentials();

-- Vista sanitizada para la UI. No usa security_invoker: la tabla subyacente no
-- tiene policies de cliente. La cláusula controla el tenant explícitamente y
-- nunca devuelve URL ni clave.
CREATE OR REPLACE VIEW public.evolution_connection_status AS
SELECT
  c.org_id,
  true AS configured,
  c.instance,
  c.updated_at
FROM public.evolution_connections c
WHERE public.is_org_member(c.org_id, auth.uid());

COMMENT ON VIEW public.evolution_connection_status IS
  'Estado sanitizado de Evolution API para miembros del comercio; nunca expone URL ni API key.';

REVOKE ALL ON TABLE public.evolution_connection_status FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.evolution_connection_status TO authenticated;

DO $$
DECLARE
  v_policies integer;
BEGIN
  SELECT count(*) INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'evolution_connections';

  IF v_policies <> 0 THEN
    RAISE EXCEPTION 'evolution_connections debe tener RLS sin policies de cliente, tiene %', v_policies;
  END IF;

  IF has_table_privilege('anon', 'public.evolution_connections', 'SELECT')
     OR has_table_privilege('authenticated', 'public.evolution_connections', 'SELECT') THEN
    RAISE EXCEPTION 'evolution_connections quedó legible para un rol de navegador';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.settings
    WHERE evolution_api_url IS NOT NULL
       OR evolution_api_key IS NOT NULL
       OR evolution_instance IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Quedaron credenciales Evolution en settings';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260821000050', 'evolution_credentials_hardening') ON CONFLICT DO NOTHING;
