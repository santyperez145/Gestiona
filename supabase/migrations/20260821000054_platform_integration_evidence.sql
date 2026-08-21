-- Evidencia de runtime por integración en Merchant 360.
--
-- Una credencial vigente sólo prueba que existe una configuración. No prueba
-- que el proveedor esté respondiendo ahora. La vista anterior mezclaba esas
-- dos afirmaciones: mostraba la fecha del último evento, pero el operador
-- debía inferir a ojo si ese dato era reciente, viejo o inexistente.
--
-- `evidence_status` no inventa un health check: clasifica la última evidencia
-- que ya registraron los caminos reales. El chequeo activo contra cada
-- proveedor sigue siendo trabajo posterior y sólo debe agregarse con rate
-- limit, contrato de secretos y una acción de recuperación definida.

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
),
evidence AS (
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
    latest.created_at AS last_runtime_at
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
)
SELECT
  e.*,
  CASE
    WHEN e.has_connection
      AND (
        NOT e.credential_current
        OR e.connection_error
        OR e.last_runtime_status = 'error'
      ) THEN 'attention'
    WHEN e.has_connection THEN 'connected'
    WHEN e.lifecycle = 'needs_contract' THEN 'contract_required'
    WHEN e.lifecycle = 'needs_setup' THEN 'setup_required'
    ELSE 'not_connected'
  END AS operational_status,
  CASE
    WHEN NOT e.has_connection THEN 'not_connected'
    WHEN e.last_runtime_status = 'error' THEN 'runtime_error'
    WHEN e.last_runtime_status = 'warning' THEN 'runtime_warning'
    WHEN e.last_runtime_at >= now() - interval '24 hours' THEN 'recent_runtime'
    WHEN e.last_runtime_at IS NOT NULL THEN 'stale_runtime'
    ELSE 'configured_only'
  END AS evidence_status
FROM evidence e
WHERE public.is_platform_admin(auth.uid());

ALTER VIEW public.platform_org_integration_health SET (security_invoker = false);
REVOKE ALL ON public.platform_org_integration_health FROM PUBLIC, anon;
GRANT SELECT ON public.platform_org_integration_health TO authenticated;

COMMENT ON COLUMN public.platform_org_integration_health.evidence_status IS
  'Calidad de la última evidencia registrada: runtime reciente, advertencia, error, evidencia vencida o sólo configuración. No es un ping activo al proveedor.';

DO $verify$
DECLARE
  v_evidence_column integer;
  v_sensitive_columns integer;
BEGIN
  SELECT count(*) INTO v_evidence_column
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'platform_org_integration_health'
    AND column_name = 'evidence_status';
  IF v_evidence_column <> 1 THEN
    RAISE EXCEPTION 'La salud de integraciones no expone evidence_status';
  END IF;

  SELECT count(*) INTO v_sensitive_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'platform_org_integration_health'
    AND column_name IN ('access_token', 'refresh_token', 'api_key', 'api_url', 'private_key', 'certificate', 'cuit', 'email', 'message', 'last_error');
  IF v_sensitive_columns <> 0 THEN
    RAISE EXCEPTION 'La evidencia de integraciones expone % columnas sensibles', v_sensitive_columns;
  END IF;

  IF has_table_privilege('anon', 'public.platform_org_integration_health', 'SELECT') THEN
    RAISE EXCEPTION 'La evidencia de integraciones quedó visible para anon';
  END IF;
END;
$verify$;
