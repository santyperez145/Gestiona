-- Registro operativo de integraciones de Gestiona.
--
-- Este catálogo no reemplaza los estados de conexión de cada comercio ni
-- expone credenciales. Describe qué integraciones existen, cómo se conectan,
-- qué parte del producto las opera y qué falta para venderlas con confianza.
-- La salud de runtime vive en las vistas operativas correspondientes.

CREATE TABLE IF NOT EXISTS public.platform_integration_registry (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_key  text NOT NULL UNIQUE,
  display_name     text NOT NULL,
  category         text NOT NULL,
  connection_mode  text NOT NULL,
  lifecycle        text NOT NULL,
  scope            text NOT NULL,
  description      text NOT NULL,
  capabilities     text[] NOT NULL DEFAULT '{}'::text[],
  requires_contract boolean NOT NULL DEFAULT false,
  sort_order       integer NOT NULL DEFAULT 100,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_integration_registry_key_check
    CHECK (integration_key = lower(integration_key) AND integration_key ~ '^[a-z0-9_:-]+$'),
  CONSTRAINT platform_integration_registry_category_check
    CHECK (category IN ('payments', 'tax', 'commerce', 'messaging', 'shipping', 'platform', 'automation')),
  CONSTRAINT platform_integration_registry_connection_check
    CHECK (connection_mode IN ('oauth', 'delegation', 'server_config', 'webhook', 'manual', 'none')),
  CONSTRAINT platform_integration_registry_lifecycle_check
    CHECK (lifecycle IN ('production', 'beta', 'needs_setup', 'needs_contract', 'planned')),
  CONSTRAINT platform_integration_registry_scope_check
    CHECK (scope IN ('platform', 'merchant', 'both')),
  CONSTRAINT platform_integration_registry_sort_check
    CHECK (sort_order >= 0)
);

CREATE INDEX IF NOT EXISTS platform_integration_registry_active_idx
  ON public.platform_integration_registry (is_active, sort_order, display_name);

ALTER TABLE public.platform_integration_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_integration_registry_staff_read
  ON public.platform_integration_registry;
CREATE POLICY platform_integration_registry_staff_read
  ON public.platform_integration_registry
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

REVOKE ALL ON public.platform_integration_registry FROM PUBLIC, anon;
GRANT SELECT ON public.platform_integration_registry TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_platform_integration_registry_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_integration_registry_updated
  ON public.platform_integration_registry;
CREATE TRIGGER trg_platform_integration_registry_updated
  BEFORE UPDATE ON public.platform_integration_registry
  FOR EACH ROW EXECUTE FUNCTION public.touch_platform_integration_registry_updated_at();

-- Estado del producto, no estado de credenciales. Los valores se mantienen
-- explícitos para que el panel no convierta una integración declarada en una
-- promesa comercial.
INSERT INTO public.platform_integration_registry (
  integration_key, display_name, category, connection_mode, lifecycle, scope,
  description, capabilities, requires_contract, sort_order
)
VALUES
  ('mercadopago', 'Mercado Pago', 'payments', 'oauth', 'production', 'merchant',
   'Cobros online, checkout embebido, reintegros y comisión de marketplace.',
   ARRAY['checkout', 'cobros', 'reintegros', 'marketplace_fee'], false, 10),
  ('mercadolibre', 'Mercado Libre', 'commerce', 'oauth', 'beta', 'merchant',
   'Conexión de cuenta, sincronización de publicaciones y recepción de eventos.',
   ARRAY['catalogo', 'ordenes', 'webhooks'], false, 20),
  ('arca', 'ARCA', 'tax', 'delegation', 'needs_setup', 'merchant',
   'Facturación electrónica server-side; cada comercio debe completar la delegación y homologación.',
   ARRAY['facturacion', 'cae', 'puntos_de_venta'], false, 30),
  ('evolution_api', 'Evolution API', 'messaging', 'server_config', 'beta', 'merchant',
   'Mensajería de WhatsApp para avisos, digest y campañas operativas.',
   ARRAY['whatsapp', 'avisos', 'campanas'], false, 40),
  ('resend', 'Resend', 'messaging', 'server_config', 'needs_setup', 'platform',
   'Entrega de correo transaccional y campañas desde funciones server-side.',
   ARRAY['email', 'rebotes', 'desuscripciones'], false, 50),
  ('anthropic', 'Anthropic', 'automation', 'server_config', 'needs_setup', 'platform',
   'Business Copilot para recomendaciones, clasificación y extracción asistida.',
   ARRAY['copilot', 'ocr', 'insights'], false, 60),
  ('correo_argentino', 'Correo Argentino', 'shipping', 'server_config', 'needs_contract', 'merchant',
   'Cotización y etiqueta por API cuando exista un contrato operativo verificado.',
   ARRAY['cotizacion', 'etiquetas', 'tracking'], true, 70),
  ('andreani', 'Andreani', 'shipping', 'server_config', 'needs_contract', 'merchant',
   'Cotización y etiqueta por API cuando exista un contrato operativo verificado.',
   ARRAY['cotizacion', 'etiquetas', 'tracking'], true, 80),
  ('webhooks', 'Webhooks de plataforma', 'platform', 'webhook', 'production', 'both',
   'Entrada y salida de eventos con idempotencia, trazabilidad y reintentos.',
   ARRAY['eventos', 'reintentos', 'auditoria'], false, 90),
  ('stripe_billing', 'Stripe Billing', 'payments', 'server_config', 'planned', 'platform',
   'Facturación recurrente de planes cuando se habilite el billing externo.',
   ARRAY['suscripciones', 'facturacion_recurrente'], false, 100)
ON CONFLICT (integration_key) DO UPDATE SET
  display_name      = EXCLUDED.display_name,
  category          = EXCLUDED.category,
  connection_mode   = EXCLUDED.connection_mode,
  lifecycle         = EXCLUDED.lifecycle,
  scope             = EXCLUDED.scope,
  description       = EXCLUDED.description,
  capabilities      = EXCLUDED.capabilities,
  requires_contract = EXCLUDED.requires_contract,
  sort_order        = EXCLUDED.sort_order,
  is_active         = EXCLUDED.is_active,
  updated_at        = now();

COMMENT ON TABLE public.platform_integration_registry IS
  'Catálogo staff-only de integraciones: contrato de producto y estado de implementación, nunca credenciales ni salud por organización.';

DO $$
DECLARE
  v_policy_count integer;
  v_rows integer;
BEGIN
  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'platform_integration_registry';

  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION 'El registro de integraciones necesita exactamente una policy staff de lectura, hay %', v_policy_count;
  END IF;

  SELECT count(*) INTO v_rows FROM public.platform_integration_registry;
  IF v_rows < 8 THEN
    RAISE EXCEPTION 'El registro de integraciones quedó incompleto: % filas', v_rows;
  END IF;

  IF has_table_privilege('anon', 'public.platform_integration_registry', 'SELECT') THEN
    RAISE EXCEPTION 'El registro de integraciones quedó visible para anon';
  END IF;
END;
$$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260821000049', 'platform_integration_registry') ON CONFLICT DO NOTHING;
