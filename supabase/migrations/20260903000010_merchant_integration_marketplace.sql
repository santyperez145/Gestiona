-- Mercado de integraciones del comercio (patrón Tiendanube Apps, traducido).
--
-- El registro staff sigue staff-only. El comercio necesita un catálogo sin
-- secretos para descubrir envíos/cobros/canales con lifecycle honesto:
-- needs_contract ≠ "etiqueta API live", production = operable hoy.
--
-- También se siembran OCA y el tarifario propio (precios por provincia +
-- etiqueta imprimible), que ya existen en producto y no pedían fila.

CREATE OR REPLACE VIEW public.merchant_integration_catalog
WITH (security_invoker = false)
AS
SELECT
  r.integration_key,
  r.display_name,
  r.category,
  r.connection_mode,
  r.lifecycle,
  r.description,
  r.capabilities,
  r.requires_contract,
  r.sort_order
FROM public.platform_integration_registry r
WHERE r.is_active
  AND r.scope IN ('merchant', 'both');

COMMENT ON VIEW public.merchant_integration_catalog IS
  'Catálogo merchant-safe: qué integraciones existen y en qué estado de producto. Sin tokens ni salud de runtime.';

REVOKE ALL ON public.merchant_integration_catalog FROM PUBLIC, anon;
GRANT SELECT ON public.merchant_integration_catalog TO authenticated;

-- Tarifario + etiqueta propios: operable sin contrato de correo.
INSERT INTO public.platform_integration_registry (
  integration_key, display_name, category, connection_mode, lifecycle, scope,
  description, capabilities, requires_contract, sort_order, is_active
)
VALUES
  (
    'gestiona_envios',
    'Envíos Gestiona',
    'shipping',
    'manual',
    'production',
    'merchant',
    'Precios por provincia, retiro en tienda, etiqueta imprimible y seguimiento del pedido. Operable hoy sin contrato con un correo.',
    ARRAY['tarifario_provincia', 'retiro', 'etiqueta_imprimible', 'seguimiento'],
    false,
    65,
    true
  ),
  (
    'oca',
    'OCA',
    'shipping',
    'server_config',
    'needs_contract',
    'merchant',
    'Cotización y etiqueta por API cuando exista un contrato OCA ePak verificado. Mientras tanto se cotiza con tarifario propio.',
    ARRAY['cotizacion', 'etiquetas', 'tracking'],
    true,
    85,
    true
  )
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

-- Copy más claro: API live ≠ promesa comercial.
UPDATE public.platform_integration_registry
   SET description = 'Cotización y etiqueta por API cuando el comercio tenga contrato Mi Correo / Paq.ar verificado. Sin contrato: tarifario propio (Envíos Gestiona).',
       updated_at = now()
 WHERE integration_key = 'correo_argentino';

UPDATE public.platform_integration_registry
   SET description = 'Cotización y etiqueta por API cuando el comercio tenga contrato Andreani verificado. Sin contrato: tarifario propio (Envíos Gestiona).',
       updated_at = now()
 WHERE integration_key = 'andreani';

DO $$
DECLARE
  v_rows integer;
  v_anon boolean;
BEGIN
  SELECT count(*) INTO v_rows FROM public.merchant_integration_catalog;
  IF v_rows < 8 THEN
    RAISE EXCEPTION 'merchant_integration_catalog incompleto: % filas', v_rows;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.merchant_integration_catalog
     WHERE integration_key = 'gestiona_envios' AND lifecycle = 'production'
  ) THEN
    RAISE EXCEPTION 'falta gestiona_envios en production';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.merchant_integration_catalog
     WHERE integration_key = 'oca' AND requires_contract
  ) THEN
    RAISE EXCEPTION 'falta oca needs_contract';
  END IF;

  SELECT has_table_privilege('anon', 'public.merchant_integration_catalog', 'SELECT')
    INTO v_anon;
  IF v_anon THEN
    RAISE EXCEPTION 'merchant_integration_catalog visible para anon';
  END IF;
END $$;
