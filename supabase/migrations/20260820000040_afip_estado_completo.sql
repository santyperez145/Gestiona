-- ═══════════════════════════════════════════════════════════════════════════
-- AFIP: la UI miraba el lugar equivocado
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ Con el certificado cargado y funcionando —CAE obtenido contra ARCA— el
-- panel de Facturas seguía diciendo **"AFIP no configurado"** y no ofrecía el
-- botón de autorizar.
--
-- La causa: `InvoicesPage` decidía leyendo `settings.afip_cuit`, y
-- `save_afip_config` escribe en **`afip_credentials`**. Dos lugares para el
-- mismo dato, y nadie llena el primero.
--
-- Es la **cuarta vez** que aparece este patrón en el repo: las listas de
-- precios con `discount_pct` contra `discount_type`, el vocabulario de métodos
-- de pago, `subscription_invoices` contra las suscripciones del SaaS, y ahora
-- esto. La forma siempre es la misma — una generación nueva de columnas al lado
-- de la vieja, y la mitad del código leyendo cada una.
--
-- `CONTRIBUTING.md` ya decía cuál es la fuente correcta: *"la UI lee
-- `afip_connection_status`"*. La vista existía y estaba bien; la pantalla no la
-- usaba.
--
-- Acá se le agrega `domicilio`, que el PDF del comprobante necesita y la vista
-- no exponía — era la única razón por la que quedaba algo que sólo estaba en
-- `settings`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ⚠️ DROP y CREATE, no CREATE OR REPLACE: Postgres no deja insertar una columna
-- en el medio de una vista existente («cannot change name of view column»).
-- Agregar al final funcionaría, pero deja el orden ilegible; se prefiere
-- recrearla y que quede agrupada con los otros datos fiscales.
DROP VIEW IF EXISTS public.afip_connection_status;

CREATE VIEW public.afip_connection_status AS
SELECT
  org_id,
  cuit,
  punto_venta,
  environment,
  tipo_emisor,
  razon_social,
  domicilio,
  certificate IS NOT NULL AND private_key IS NOT NULL AS configured,
  ta_expires_at,
  ta_expires_at IS NOT NULL AND ta_expires_at > now() AS ticket_vigente,
  updated_at
FROM public.afip_credentials c
WHERE public.is_org_member(org_id, auth.uid());

COMMENT ON VIEW public.afip_connection_status IS
  'Estado de la conexion con ARCA. Es la UNICA fuente que debe leer la UI: nunca settings.afip_*, que es la generacion vieja y nadie la llena.';

GRANT SELECT ON public.afip_connection_status TO authenticated;
