-- Certificado de ARCA de la plataforma: pedido generado en el servidor y
-- prueba real contra ARCA antes de activarlo.
--
-- Medido el 2026-10-15: el certificado guardado como «producción» lo emitió
-- «CN=Computadores Test, O=AFIP» (homologación). WSAA producción lo rechazaba
-- con `cms.cert.untrusted`, así que ningún comercio podía facturar con
-- validez fiscal, aunque delegara. La pantalla igual decía «Nerqia puede pedir
-- autorización a ARCA» porque sólo miraba que hubiera algo cargado.
--
-- Esta migración:
--   1. Guarda un pedido de certificado (CSR) generado en la Edge, con su clave
--      privada cifrada (`pedido_clave`). La clave nunca sale del servidor: el
--      staff sólo descarga el CSR, lo sube a ARCA y carga el CRT que devuelve.
--   2. Guarda el resultado de la última prueba contra ARCA (`verificado_*`) y
--      el emisor del certificado, para que la pantalla diga lo que pasó.
--   3. Extiende la defensa en la base: tampoco el pedido se guarda en claro.
--   4. La vista de estado suma esos datos (nunca la clave ni el ticket).
-- Idempotente.
BEGIN;

ALTER TABLE public.afip_platform_credentials
  ADD COLUMN IF NOT EXISTS pedido_clave text,
  ADD COLUMN IF NOT EXISTS pedido_csr text,
  ADD COLUMN IF NOT EXISTS pedido_ambiente text CHECK (pedido_ambiente IN ('homologacion', 'produccion')),
  ADD COLUMN IF NOT EXISTS pedido_creado_at timestamptz,
  ADD COLUMN IF NOT EXISTS certificado_emisor text,
  ADD COLUMN IF NOT EXISTS verificado_at timestamptz,
  ADD COLUMN IF NOT EXISTS verificado_ok boolean,
  ADD COLUMN IF NOT EXISTS verificado_motivo text;

COMMENT ON COLUMN public.afip_platform_credentials.pedido_clave IS
  'Clave privada del pedido de certificado pendiente, cifrada (nerqia:v1). Se genera en la Edge y no sale del servidor.';
COMMENT ON COLUMN public.afip_platform_credentials.pedido_csr IS
  'Pedido de certificado (CSR) para subir a ARCA. Es público: no contiene la clave.';

CREATE OR REPLACE FUNCTION public.afip_platform_encrypt_credentials()
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

REVOKE ALL ON FUNCTION public.afip_platform_encrypt_credentials() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_afip_platform_encrypt_credentials ON public.afip_platform_credentials;
CREATE TRIGGER trg_afip_platform_encrypt_credentials
BEFORE INSERT OR UPDATE OF certificate, private_key, pedido_clave
ON public.afip_platform_credentials
FOR EACH ROW EXECUTE FUNCTION public.afip_platform_encrypt_credentials();

-- Vista de definidor a propósito: la tabla no tiene políticas (nadie la lee
-- desde el navegador) y la vista sólo devuelve la fila al staff de plataforma.
-- Sin declararlo, el disparador vistas_invoker_por_defecto la pasaba a
-- invocador y el staff dejaba de verla.
CREATE OR REPLACE VIEW public.afip_platform_status WITH (security_invoker = false) AS
SELECT
  c.cuit,
  c.razon_social,
  c.environment,
  (c.certificate IS NOT NULL AND c.private_key IS NOT NULL) AS configured,
  c.ta_expires_at,
  (c.ta_expires_at IS NOT NULL AND c.ta_expires_at > now()) AS ticket_vigente,
  c.updated_at,
  (SELECT count(*) FROM public.afip_credentials a WHERE a.modo = 'delegado')::int AS comercios_delegados,
  c.certificate_not_before,
  c.certificate_expires_at,
  c.certificate_fingerprint_sha256,
  CASE
    WHEN c.certificate_expires_at IS NULL THEN NULL
    ELSE c.certificate_not_before <= now() AND c.certificate_expires_at > now()
  END AS certificate_valid,
  c.certificado_emisor,
  c.verificado_at,
  c.verificado_ok,
  c.verificado_motivo,
  (c.pedido_clave IS NOT NULL) AS pedido_pendiente,
  c.pedido_csr,
  c.pedido_ambiente,
  c.pedido_creado_at
FROM public.afip_platform_credentials c
WHERE public.is_platform_admin(auth.uid());

COMMENT ON VIEW public.afip_platform_status IS
  'Estado fiscal visible al staff: vigencia, emisor, huella y última prueba contra ARCA del certificado, y el pedido pendiente (sólo el CSR). Nunca PEM, clave privada ni Ticket de Acceso. @revisada: definidor a propósito, sólo staff de plataforma (is_platform_admin).';

COMMIT;
