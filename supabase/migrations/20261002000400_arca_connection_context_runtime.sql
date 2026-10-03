-- Completa el contexto versionado aplicado por 20261002000300: contempla el
-- modo con certificado propio y cambios de certificado, y mantiene la vista
-- alineada con la misma autoridad usada por el backend.

CREATE OR REPLACE FUNCTION public.afip_invalidar_contexto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF ROW(
       NEW.cuit, NEW.punto_venta, NEW.environment, NEW.tipo_emisor, NEW.modo,
       NEW.certificate, NEW.private_key
     ) IS DISTINCT FROM ROW(
       OLD.cuit, OLD.punto_venta, OLD.environment, OLD.tipo_emisor, OLD.modo,
       OLD.certificate, OLD.private_key
     ) THEN
    NEW.conexion_version := OLD.conexion_version + 1;
    NEW.delegacion_verificada := false;
    NEW.delegacion_verificada_at := NULL;
    NEW.last_error := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.afip_confirmar_contexto(
  p_org uuid,
  p_version bigint,
  p_environment text,
  p_ok boolean,
  p_detalle text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_config public.afip_credentials%ROWTYPE;
  v_platform_environment text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Solo el backend confirma la conexion fiscal'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_config
    FROM public.afip_credentials
   WHERE org_id = p_org
   FOR UPDATE;
  IF NOT FOUND OR p_version IS NULL OR v_config.conexion_version <> p_version THEN
    RETURN jsonb_build_object('ok', false, 'code', 'configuration_changed');
  END IF;
  IF v_config.environment IS DISTINCT FROM p_environment THEN
    RETURN jsonb_build_object('ok', false, 'code', 'environment_mismatch');
  END IF;
  IF v_config.modo <> 'propio' THEN
    SELECT environment INTO v_platform_environment
      FROM public.afip_platform_credentials
     WHERE certificate IS NOT NULL AND private_key IS NOT NULL
       AND environment = p_environment
     LIMIT 1;
    IF v_platform_environment IS DISTINCT FROM p_environment THEN
      RETURN jsonb_build_object('ok', false, 'code', 'environment_mismatch');
    END IF;
  END IF;
  PERFORM public.afip_marcar_delegacion(p_org, p_ok, p_detalle);
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

CREATE OR REPLACE VIEW public.afip_connection_status AS
SELECT a.org_id, a.cuit, a.punto_venta, a.environment, a.tipo_emisor,
  a.razon_social, a.domicilio, a.modo,
  a.cuit IS NOT NULL AND btrim(a.cuit) <> '' AND CASE a.modo
    WHEN 'propio' THEN a.certificate IS NOT NULL AND a.private_key IS NOT NULL
    ELSE EXISTS (
      SELECT 1 FROM public.afip_platform_credentials p
      WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL
        AND p.environment = a.environment
    )
  END AS configured,
  EXISTS (
    SELECT 1 FROM public.afip_platform_credentials p
    WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL
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
    WHEN a.modo <> 'propio' AND NOT a.delegacion_verificada
      AND regexp_replace(COALESCE(a.cuit, ''), '\D', '', 'g') =
        regexp_replace(COALESCE((SELECT p.cuit FROM public.afip_platform_credentials p
          WHERE p.environment = a.environment LIMIT 1), ''), '\D', '', 'g')
      THEN 'sin_delegacion_necesaria'
    WHEN a.modo <> 'propio' AND NOT a.delegacion_verificada THEN 'falta_delegar'
    ELSE 'listo'
  END AS motivo,
  a.delegacion_verificada, a.delegacion_verificada_at, a.last_error,
  a.ingresos_brutos, a.inicio_actividades,
  (SELECT p.environment FROM public.afip_platform_credentials p LIMIT 1) AS plataforma_ambiente,
  a.conexion_version
FROM public.afip_credentials a
WHERE public.is_org_member(a.org_id, auth.uid());

GRANT SELECT ON public.afip_connection_status TO authenticated;
REVOKE ALL ON FUNCTION public.afip_confirmar_contexto(uuid,bigint,text,boolean,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_confirmar_contexto(uuid,bigint,text,boolean,text)
  TO service_role;

DO $guard$
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.afip_confirmar_contexto(uuid,bigint,text,boolean,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'La pantalla puede confirmar un contexto fiscal';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'afip_credentials'
      AND column_name = 'conexion_version'
  ) THEN
    RAISE EXCEPTION 'Falta la version del contexto fiscal';
  END IF;
END;
$guard$;
