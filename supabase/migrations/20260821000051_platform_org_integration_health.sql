-- Salud operativa de conexiones por comercio para Merchant 360.
--
-- El registro de integraciones describe el contrato del producto. Esta vista
-- agrega sólo la evidencia que la plataforma necesita para operar cada cuenta:
-- conexión, vigencia, última actividad y un estado accionable. No expone
-- tokens, URL privadas, e-mails de cuentas, CUITs ni mensajes de error, porque
-- esos campos pueden ser secretos o datos del comercio.

CREATE OR REPLACE VIEW public.platform_org_integration_health AS
WITH registry AS (
  SELECT
    integration_key,
    display_name,
    category,
    connection_mode,
    lifecycle,
    scope,
    requires_contract,
    CASE integration_key WHEN 'arca' THEN 'afip' ELSE integration_key END AS log_key
  FROM public.platform_integration_registry
  WHERE is_active
    AND integration_key IN ('mercadopago', 'mercadolibre', 'arca', 'evolution_api')
),
connections AS (
  SELECT
    c.org_id,
    'mercadopago'::text AS integration_key,
    (c.access_token IS NOT NULL) AS has_connection,
    (c.expires_at IS NULL OR c.expires_at > now()) AS credential_current,
    (c.last_error IS NOT NULL AND btrim(c.last_error) <> '') AS connection_error,
    c.connected_at,
    c.updated_at
  FROM public.payment_connections c
  WHERE c.provider = 'mercadopago'

  UNION ALL

  SELECT
    c.org_id,
    'mercadolibre'::text AS integration_key,
    (c.access_token IS NOT NULL) AS has_connection,
    (c.expires_at IS NOT NULL AND c.expires_at > now()) AS credential_current,
    (c.last_error IS NOT NULL AND btrim(c.last_error) <> '') AS connection_error,
    c.connected_at,
    c.updated_at
  FROM public.meli_connections c

  UNION ALL

  SELECT
    c.org_id,
    'arca'::text AS integration_key,
    (
      c.cuit IS NOT NULL
      AND btrim(c.cuit) <> ''
      AND CASE c.modo
        WHEN 'propio' THEN c.certificate IS NOT NULL AND c.private_key IS NOT NULL
        ELSE COALESCE(c.delegacion_verificada, false)
      END
    ) AS has_connection,
    CASE c.modo
      WHEN 'propio' THEN c.ta_expires_at IS NULL OR c.ta_expires_at > now()
      ELSE COALESCE(c.delegacion_verificada, false)
    END AS credential_current,
    false AS connection_error,
    c.delegacion_verificada_at AS connected_at,
    c.updated_at
  FROM public.afip_credentials c

  UNION ALL

  SELECT
    c.org_id,
    'evolution_api'::text AS integration_key,
    true AS has_connection,
    true AS credential_current,
    false AS connection_error,
    c.created_at AS connected_at,
    c.updated_at
  FROM public.evolution_connections c
)
SELECT
  o.id AS org_id,
  r.integration_key,
  r.display_name,
  r.category,
  r.connection_mode,
  r.lifecycle,
  r.scope,
  r.requires_contract,
  COALESCE(c.has_connection, false) AS has_connection,
  COALESCE(c.credential_current, false) AS credential_current,
  COALESCE(c.connection_error, false) AS connection_error,
  c.connected_at,
  c.updated_at AS connection_updated_at,
  latest.event AS last_event,
  latest.status AS last_runtime_status,
  latest.created_at AS last_runtime_at,
  CASE
    WHEN COALESCE(c.has_connection, false)
      AND (
        NOT COALESCE(c.credential_current, false)
        OR COALESCE(c.connection_error, false)
        OR latest.status = 'error'
      ) THEN 'attention'
    WHEN COALESCE(c.has_connection, false) THEN 'connected'
    WHEN r.lifecycle = 'needs_contract' THEN 'contract_required'
    WHEN r.lifecycle = 'needs_setup' THEN 'setup_required'
    ELSE 'not_connected'
  END AS operational_status
FROM public.organizations o
CROSS JOIN registry r
LEFT JOIN connections c
  ON c.org_id = o.id AND c.integration_key = r.integration_key
LEFT JOIN LATERAL (
  SELECT l.event, l.status, l.created_at
  FROM public.integration_logs l
  WHERE l.org_id = o.id AND l.integration = r.log_key
  ORDER BY l.created_at DESC, l.id DESC
  LIMIT 1
) latest ON true
WHERE public.is_platform_admin(auth.uid());

-- Las tablas de conexión de abajo tienen RLS sin policies. La vista ejecuta
-- como su dueño y vuelve a imponer el permiso de plataforma explícitamente.
ALTER VIEW public.platform_org_integration_health SET (security_invoker = false);
REVOKE ALL ON public.platform_org_integration_health FROM PUBLIC, anon;
GRANT SELECT ON public.platform_org_integration_health TO authenticated;

COMMENT ON VIEW public.platform_org_integration_health IS
  'Matriz staff-only de conexión y actividad por comercio para Mercado Pago, Mercado Libre, ARCA y Evolution API. No expone credenciales, identificadores de cuenta, URLs, CUIT ni mensajes de proveedores.';

DO $$
DECLARE
  v_registry_count integer;
  v_secret_columns integer;
BEGIN
  SELECT count(*) INTO v_registry_count
  FROM public.platform_integration_registry
  WHERE is_active
    AND integration_key IN ('mercadopago', 'mercadolibre', 'arca', 'evolution_api');

  IF v_registry_count <> 4 THEN
    RAISE EXCEPTION 'La matriz de salud requiere cuatro integraciones con conexión por comercio, encontró %', v_registry_count;
  END IF;

  SELECT count(*) INTO v_secret_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'platform_org_integration_health'
    AND column_name IN ('access_token', 'refresh_token', 'api_key', 'api_url', 'private_key', 'certificate', 'cuit', 'email', 'message', 'last_error');

  IF v_secret_columns <> 0 THEN
    RAISE EXCEPTION 'La vista operativa expone % columnas sensibles', v_secret_columns;
  END IF;

  IF has_table_privilege('anon', 'public.platform_org_integration_health', 'SELECT') THEN
    RAISE EXCEPTION 'La salud de integraciones quedó visible para anon';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260821000051', 'platform_org_integration_health') ON CONFLICT DO NOTHING;
