-- Integridad material del certificado ARCA de plataforma.
-- La extensión .crt no prueba ambiente, vigencia ni correspondencia con la
-- clave privada. La Edge valida el X.509 antes de cifrarlo y persiste sólo
-- metadatos no secretos para operación/renovación.

ALTER TABLE public.afip_platform_credentials
  ADD COLUMN IF NOT EXISTS certificate_not_before timestamptz,
  ADD COLUMN IF NOT EXISTS certificate_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS certificate_fingerprint_sha256 text;

ALTER TABLE public.afip_platform_credentials
  DROP CONSTRAINT IF EXISTS afip_platform_certificate_validity_order,
  ADD CONSTRAINT afip_platform_certificate_validity_order CHECK (
    certificate_not_before IS NULL OR certificate_expires_at IS NULL
    OR certificate_not_before < certificate_expires_at
  ),
  DROP CONSTRAINT IF EXISTS afip_platform_certificate_fingerprint_format,
  ADD CONSTRAINT afip_platform_certificate_fingerprint_format CHECK (
    certificate_fingerprint_sha256 IS NULL
    OR certificate_fingerprint_sha256 ~ '^[0-9a-f]{64}$'
  );

COMMENT ON COLUMN public.afip_platform_credentials.certificate_not_before IS
  'Inicio de vigencia X.509 validado server-side al cargar CRT + KEY.';
COMMENT ON COLUMN public.afip_platform_credentials.certificate_expires_at IS
  'Fin de vigencia X.509 validado server-side; no es la vigencia del Ticket de Acceso.';
COMMENT ON COLUMN public.afip_platform_credentials.certificate_fingerprint_sha256 IS
  'Huella SHA-256 no secreta del DER validado; permite identificar una rotación sin exponer PEM.';

CREATE OR REPLACE VIEW public.afip_platform_status AS
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
  END AS certificate_valid
FROM public.afip_platform_credentials c
WHERE public.is_platform_admin(auth.uid());

COMMENT ON VIEW public.afip_platform_status IS
  'Estado fiscal visible al staff: vigencia y huella del certificado, nunca PEM, clave privada ni Ticket de Acceso.';
GRANT SELECT ON public.afip_platform_status TO authenticated;
