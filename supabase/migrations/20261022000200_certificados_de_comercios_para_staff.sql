-- Estado del certificado de ARCA de cada comercio, para el staff de plataforma.
--
-- Desde 20261022000100 cada comercio factura con su propio certificado y lo
-- conecta solo. El panel de plataforma sólo veía la cola de delegaciones: el
-- staff no tenía cómo saber qué comercio quedó con el certificado vencido,
-- rechazado o a medio conectar antes de que el comercio escriba a soporte.
--
-- Vista de definidor a propósito: lee `afip_credentials` (RLS sin políticas) y
-- devuelve filas sólo a quien es staff (`is_platform_admin`). Expone vigencia,
-- emisor, última prueba y si hay pedido pendiente. Nunca PEM, clave, pedido ni
-- ticket. Idempotente.
BEGIN;

CREATE OR REPLACE VIEW public.platform_afip_certificados WITH (security_invoker = false) AS
SELECT
  c.org_id,
  o.name AS organization_name,
  c.cuit,
  c.razon_social,
  c.environment,
  c.modo,
  c.punto_venta,
  c.certificate_expires_at AS certificado_vence,
  c.certificado_emisor,
  c.certificado_verificado_ok,
  c.certificado_verificado_at,
  c.certificado_verificado_motivo,
  (c.pedido_clave IS NOT NULL) AS pedido_pendiente,
  c.pedido_creado_at,
  c.delegacion_verificada AS conexion_verificada,
  c.last_error,
  CASE
    WHEN c.cuit IS NULL OR btrim(c.cuit) = '' THEN 'sin_datos'
    WHEN c.modo <> 'propio' THEN 'delegado'
    WHEN c.certificate IS NULL THEN CASE WHEN c.pedido_clave IS NOT NULL THEN 'pedido_pendiente' ELSE 'sin_certificado' END
    WHEN c.certificate_expires_at IS NOT NULL AND c.certificate_expires_at <= now() THEN 'vencido'
    WHEN c.certificado_verificado_ok = false THEN 'rechazado'
    WHEN NOT c.delegacion_verificada THEN 'falta_verificar'
    WHEN c.certificate_expires_at IS NOT NULL AND c.certificate_expires_at <= now() + interval '30 days' THEN 'por_vencer'
    ELSE 'listo'
  END AS estado
FROM public.afip_credentials c
JOIN public.organizations o ON o.id = c.org_id
WHERE public.is_platform_admin(auth.uid());

COMMENT ON VIEW public.platform_afip_certificados IS
  'Estado del certificado de ARCA de cada comercio para soporte: vigencia, emisor, última prueba, pedido pendiente y conexión. Nunca PEM, clave, pedido ni ticket. @revisada: definidor a propósito, sólo staff de plataforma (is_platform_admin).';

REVOKE ALL ON public.platform_afip_certificados FROM PUBLIC, anon;
GRANT SELECT ON public.platform_afip_certificados TO authenticated;

COMMIT;
