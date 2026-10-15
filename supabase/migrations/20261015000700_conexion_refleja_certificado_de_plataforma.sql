-- La conexión del comercio refleja si ARCA acepta el certificado de Nerqia.
--
-- Medido el 2026-10-15: el certificado de la plataforma era de homologación
-- («Computadores Test») cargado como producción y WSAA lo rechazaba, pero la
-- vista decía `configured = true` y la pantalla del comercio «Nerqia puede
-- pedir autorización a ARCA». Ahora, si la última prueba real
-- (afip_platform_credentials.verificado_ok, 20261015000600) fue un rechazo:
--   · `configured` y `plataforma_lista` son false para quien usa delegación;
--   · `motivo` es 'plataforma_rechazada' (no es un problema del comercio);
--   · `plataforma_verificada` (al final) dice true/false/null sin detalle.
-- Vista de definidor a propósito (lee la tabla del certificado, sin políticas);
-- filtra por membresía. Recreada desde 20261003000120 con esos cambios.
-- Idempotente.
BEGIN;

CREATE OR REPLACE VIEW public.afip_connection_status WITH (security_invoker = false) AS
SELECT a.org_id, a.cuit, a.punto_venta, a.environment, a.tipo_emisor,
  a.razon_social, a.domicilio, a.modo,
  a.cuit IS NOT NULL AND btrim(a.cuit) <> '' AND CASE a.modo
    WHEN 'propio' THEN a.certificate IS NOT NULL AND a.private_key IS NOT NULL
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
  -- Las columnas nuevas se anexan al final: CREATE OR REPLACE VIEW debe
  -- conservar nombre/orden de todas las columnas preexistentes.
  a.delegacion_solicitada_at, a.delegacion_revisada_at,
  -- Última prueba real del certificado de Nerqia contra ARCA (sin detalle):
  -- true aceptado, false rechazado, null todavía no probado.
  CASE a.modo WHEN 'propio' THEN NULL ELSE
    (SELECT p.verificado_ok FROM public.afip_platform_credentials p
      WHERE p.environment = a.environment LIMIT 1) END AS plataforma_verificada
FROM public.afip_credentials a
WHERE public.is_org_member(a.org_id, auth.uid());

COMMENT ON VIEW public.afip_connection_status IS
  'Estado fiscal del comercio para la UI: datos del emisor, delegación y si ARCA acepta hoy el certificado de la plataforma. Nunca certificados, claves ni tickets. @revisada: definidor a propósito, filtra por membresía.';

COMMIT;
