-- Cada comercio factura con su propio certificado de ARCA.
--
-- ── La decisión ───────────────────────────────────────────────────────────
--
-- Decisión del dueño, 2026-10-22: «usaremos los certificados propios». Revierte
-- 20260827000050 («ningún comercio guarda su certificado»). Con la delegación,
-- cada comercio quedaba atado ante ARCA al CUIT personal del dueño, y el
-- instructivo oficial de ARCA (ADMINREL.DelegarWS) exige que el tercero acepte
-- la designación y asocie su computador fiscal **por cada cliente**: dos
-- trámites manuales del dueño por comercio, para siempre. Un certificado
-- rechazado dejaba sin facturar a todos (pasó hasta el 15/10). Es el modelo del
-- Facturador de Mercado Libre: la herramienta genera el pedido, el comercio lo
-- sube a ARCA con su clave fiscal y asocia el certificado a Facturación
-- Electrónica en su propio CUIT. Nadie más interviene.
--
-- ── Qué cambia ────────────────────────────────────────────────────────────
--
--   1. Se quita la constraint que impedía guardar el certificado del comercio.
--   2. El pedido (CSR) y su clave se generan en la Edge `afip-credentials`; la
--      clave queda cifrada y no sale nunca (`pedido_clave`). El comercio sólo
--      descarga el CSR y sube el .crt que le devuelve ARCA.
--   3. Se guarda la vigencia, la huella, el emisor y la última prueba real del
--      certificado contra ARCA (`certificado_verificado_*`).
--   4. La base cifra certificado, clave y pedido aunque alguien los escriba en
--      claro (misma defensa que el certificado de la plataforma).
--   5. `propio` es el modo por defecto. Los comercios en delegado que nunca
--      verificaron la delegación pasan a `propio`; un delegado ya verificado no
--      se toca (el modo sigue existiendo y `afip-authorize` lo soporta).
--   6. `afip_connection_status` distingue, para `propio`: falta el certificado,
--      vencido, rechazado por ARCA, falta verificar la conexión, listo.
--
-- El certificado de la plataforma se conserva: lo usa el padrón de ARCA y
-- sigue sirviendo a un delegado verificado.
-- Idempotente.
BEGIN;

-- 1 ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.afip_credentials
  DROP CONSTRAINT IF EXISTS afip_credentials_sin_certificado_propio;

-- 2 y 3 ────────────────────────────────────────────────────────────────────
ALTER TABLE public.afip_credentials
  ADD COLUMN IF NOT EXISTS pedido_clave text,
  ADD COLUMN IF NOT EXISTS pedido_csr text,
  ADD COLUMN IF NOT EXISTS pedido_ambiente text CHECK (pedido_ambiente IN ('homologacion', 'produccion')),
  ADD COLUMN IF NOT EXISTS pedido_creado_at timestamptz,
  ADD COLUMN IF NOT EXISTS certificado_emisor text,
  ADD COLUMN IF NOT EXISTS certificate_not_before timestamptz,
  ADD COLUMN IF NOT EXISTS certificate_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS certificate_fingerprint_sha256 text,
  ADD COLUMN IF NOT EXISTS certificado_verificado_at timestamptz,
  ADD COLUMN IF NOT EXISTS certificado_verificado_ok boolean,
  ADD COLUMN IF NOT EXISTS certificado_verificado_motivo text;

COMMENT ON COLUMN public.afip_credentials.pedido_clave IS
  'Clave privada del pedido de certificado pendiente, cifrada (nerqia:v1). Se genera en la Edge y no sale del servidor.';
COMMENT ON COLUMN public.afip_credentials.pedido_csr IS
  'Pedido de certificado (CSR) para subir a ARCA con la clave fiscal del comercio. Es público: no contiene la clave.';
COMMENT ON COLUMN public.afip_credentials.certificado_verificado_ok IS
  'Última prueba real del certificado del comercio contra WSAA: true aceptado, false rechazado, null sin probar.';

-- 4 ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.afip_encrypt_credentials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.certificate IS NOT NULL AND NEW.certificate NOT LIKE 'nerqia:v1:%' THEN
    NEW.certificate := public.secret_encrypt(NEW.certificate);
  END IF;
  IF NEW.private_key IS NOT NULL AND NEW.private_key NOT LIKE 'nerqia:v1:%' THEN
    NEW.private_key := public.secret_encrypt(NEW.private_key);
  END IF;
  IF NEW.pedido_clave IS NOT NULL AND NEW.pedido_clave NOT LIKE 'nerqia:v1:%' THEN
    NEW.pedido_clave := public.secret_encrypt(NEW.pedido_clave);
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.afip_encrypt_credentials() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_afip_encrypt_credentials ON public.afip_credentials;
CREATE TRIGGER trg_afip_encrypt_credentials
BEFORE INSERT OR UPDATE OF certificate, private_key, pedido_clave
ON public.afip_credentials
FOR EACH ROW EXECUTE FUNCTION public.afip_encrypt_credentials();

-- 5 ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.afip_credentials ALTER COLUMN modo SET DEFAULT 'propio';

COMMENT ON COLUMN public.afip_credentials.modo IS
  '`propio` (por defecto desde 2026-10-22): el comercio factura con su certificado. '
  '`delegado`: con el de la plataforma, sólo si la delegación ya se verificó.';

UPDATE public.afip_credentials
   SET modo = 'propio', updated_at = now()
 WHERE modo IS DISTINCT FROM 'propio'
   AND delegacion_verificada IS NOT TRUE;

-- 6 ────────────────────────────────────────────────────────────────────────
-- Vista de definidor a propósito: lee la tabla de credenciales (sin políticas)
-- y filtra por membresía. Las columnas nuevas van al final: CREATE OR REPLACE
-- VIEW conserva el nombre y el orden de las existentes.
CREATE OR REPLACE VIEW public.afip_connection_status WITH (security_invoker = false) AS
SELECT a.org_id, a.cuit, a.punto_venta, a.environment, a.tipo_emisor,
  a.razon_social, a.domicilio, a.modo,
  a.cuit IS NOT NULL AND btrim(a.cuit) <> '' AND CASE a.modo
    WHEN 'propio' THEN a.certificate IS NOT NULL AND a.private_key IS NOT NULL
      AND a.certificado_verificado_ok IS DISTINCT FROM false
      AND (a.certificate_expires_at IS NULL OR a.certificate_expires_at > now())
    ELSE EXISTS (
      SELECT 1 FROM public.afip_platform_credentials p
      WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL
        AND p.environment = a.environment
        AND p.verificado_ok IS DISTINCT FROM false
    )
  END AS configured,
  EXISTS (
    SELECT 1 FROM public.afip_platform_credentials p
    WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL
      AND p.verificado_ok IS DISTINCT FROM false
  ) AS plataforma_lista,
  (SELECT p.cuit FROM public.afip_platform_credentials p
    WHERE p.certificate IS NOT NULL AND p.environment = a.environment LIMIT 1) AS plataforma_cuit,
  (SELECT p.razon_social FROM public.afip_platform_credentials p
    WHERE p.certificate IS NOT NULL AND p.environment = a.environment LIMIT 1) AS plataforma_razon_social,
  CASE a.modo WHEN 'propio' THEN a.ta_expires_at ELSE
    (SELECT p.ta_expires_at FROM public.afip_platform_credentials p
      WHERE p.environment = a.environment LIMIT 1) END AS ta_expires_at,
  CASE a.modo WHEN 'propio' THEN
    a.ta_expires_at IS NOT NULL AND a.ta_expires_at > now()
  ELSE COALESCE((SELECT p.ta_expires_at > now()
    FROM public.afip_platform_credentials p
    WHERE p.environment = a.environment LIMIT 1), false) END AS ticket_vigente,
  CASE
    WHEN a.cuit IS NULL OR btrim(a.cuit) = '' THEN 'falta_datos_fiscales'
    WHEN a.modo = 'propio' AND (a.certificate IS NULL OR a.private_key IS NULL)
      THEN 'falta_certificado_propio'
    WHEN a.modo = 'propio' AND a.certificate_expires_at IS NOT NULL AND a.certificate_expires_at <= now()
      THEN 'certificado_vencido'
    WHEN a.modo = 'propio' AND a.certificado_verificado_ok = false
      THEN 'certificado_rechazado'
    WHEN a.modo = 'propio' AND NOT a.delegacion_verificada
      THEN 'falta_verificar'
    WHEN a.modo <> 'propio' AND NOT EXISTS (
      SELECT 1 FROM public.afip_platform_credentials p
      WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL
    ) THEN 'falta_plataforma'
    WHEN a.modo <> 'propio' AND NOT EXISTS (
      SELECT 1 FROM public.afip_platform_credentials p
      WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL
        AND p.environment = a.environment
    ) THEN 'falta_ambiente'
    WHEN a.modo <> 'propio' AND EXISTS (
      SELECT 1 FROM public.afip_platform_credentials p
      WHERE p.environment = a.environment AND p.verificado_ok = false
    ) THEN 'plataforma_rechazada'
    WHEN a.modo <> 'propio' AND NOT a.delegacion_verificada
      AND regexp_replace(COALESCE(a.cuit, ''), '\D', '', 'g') =
        regexp_replace(COALESCE((SELECT p.cuit FROM public.afip_platform_credentials p
          WHERE p.environment = a.environment LIMIT 1), ''), '\D', '', 'g')
      THEN 'sin_delegacion_necesaria'
    WHEN a.modo <> 'propio' AND NOT a.delegacion_verificada
      AND a.delegacion_solicitada_at IS NOT NULL
      AND a.delegacion_revisada_at IS NULL THEN 'esperando_plataforma'
    WHEN a.modo <> 'propio' AND NOT a.delegacion_verificada
      AND a.delegacion_revisada_at IS NOT NULL THEN 'requiere_correccion'
    WHEN a.modo <> 'propio' AND NOT a.delegacion_verificada THEN 'falta_delegar'
    ELSE 'listo'
  END AS motivo,
  a.delegacion_verificada, a.delegacion_verificada_at, a.last_error,
  a.ingresos_brutos, a.inicio_actividades,
  (SELECT p.environment FROM public.afip_platform_credentials p LIMIT 1) AS plataforma_ambiente,
  a.conexion_version,
  a.delegacion_solicitada_at, a.delegacion_revisada_at,
  CASE a.modo WHEN 'propio' THEN NULL ELSE
    (SELECT p.verificado_ok FROM public.afip_platform_credentials p
      WHERE p.environment = a.environment LIMIT 1) END AS plataforma_verificada,
  -- Certificado propio: datos públicos del certificado y su última prueba.
  -- Nunca el PEM, la clave ni el ticket.
  a.certificate_expires_at AS certificado_vence,
  a.certificado_emisor,
  a.certificado_verificado_ok,
  a.certificado_verificado_at,
  a.certificado_verificado_motivo,
  (a.pedido_clave IS NOT NULL) AS pedido_pendiente,
  a.pedido_csr,
  a.pedido_ambiente,
  a.pedido_creado_at
FROM public.afip_credentials a
WHERE public.is_org_member(a.org_id, auth.uid());

COMMENT ON VIEW public.afip_connection_status IS
  'Estado fiscal del comercio para la UI: datos del emisor, su certificado propio (vigencia, emisor, última prueba, pedido pendiente) o la delegación. Nunca certificados, claves ni tickets. @revisada: definidor a propósito, filtra por membresía.';

-- 7 ────────────────────────────────────────────────────────────────────────
-- Prueba diaria de los certificados de los comercios: un vencimiento o una
-- revocación en ARCA aparece en su pantalla antes de que falle una factura.
DO $$
BEGIN
  PERFORM cron.unschedule('certificados-comercios-prueba-diaria')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'certificados-comercios-prueba-diaria');
  PERFORM cron.schedule('certificados-comercios-prueba-diaria', '27 6 * * *', 'SELECT public.invoke_edge_function(''afip-credentials'');');
END $$;

COMMIT;
