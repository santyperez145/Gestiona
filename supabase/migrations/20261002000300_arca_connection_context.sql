-- Contexto versionado para verificar la representacion fiscal sin confirmar
-- una configuracion que cambio mientras ARCA respondia.

ALTER TABLE public.afip_credentials
  ADD COLUMN IF NOT EXISTS conexion_version bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.afip_invalidar_contexto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF ROW(NEW.cuit, NEW.punto_venta, NEW.environment, NEW.tipo_emisor, NEW.modo)
     IS DISTINCT FROM ROW(OLD.cuit, OLD.punto_venta, OLD.environment, OLD.tipo_emisor, OLD.modo) THEN
    NEW.conexion_version := OLD.conexion_version + 1;
    NEW.delegacion_verificada := false;
    NEW.delegacion_verificada_at := NULL;
    NEW.last_error := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_afip_invalidar_contexto ON public.afip_credentials;
CREATE TRIGGER trg_afip_invalidar_contexto
BEFORE UPDATE ON public.afip_credentials
FOR EACH ROW EXECUTE FUNCTION public.afip_invalidar_contexto();

CREATE OR REPLACE FUNCTION public.afip_invalidar_representacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'INSERT' THEN
    UPDATE public.afip_credentials
       SET conexion_version = conexion_version + 1,
           delegacion_verificada = false,
           delegacion_verificada_at = NULL,
           last_error = NULL
     WHERE modo = 'delegado';
  ELSIF ROW(NEW.cuit, NEW.environment, NEW.certificate, NEW.private_key)
      IS DISTINCT FROM ROW(OLD.cuit, OLD.environment, OLD.certificate, OLD.private_key) THEN
    UPDATE public.afip_credentials
       SET conexion_version = conexion_version + 1,
           delegacion_verificada = false,
           delegacion_verificada_at = NULL,
           last_error = NULL
     WHERE modo = 'delegado';
  END IF;
  RETURN NULL;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_afip_invalidar_representacion ON public.afip_platform_credentials;
CREATE TRIGGER trg_afip_invalidar_representacion
AFTER INSERT OR DELETE OR UPDATE ON public.afip_platform_credentials
FOR EACH ROW EXECUTE FUNCTION public.afip_invalidar_representacion();

CREATE OR REPLACE FUNCTION public.afip_confirmar_contexto(
  p_org uuid,
  p_version bigint,
  p_environment text,
  p_ok boolean,
  p_detalle text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_config public.afip_credentials%ROWTYPE;
  v_environment text;
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
  SELECT environment INTO v_environment
    FROM public.afip_platform_credentials
   WHERE certificate IS NOT NULL AND private_key IS NOT NULL;
  IF v_config.environment IS DISTINCT FROM p_environment
     OR v_environment IS DISTINCT FROM p_environment THEN
    RETURN jsonb_build_object('ok', false, 'code', 'environment_mismatch');
  END IF;
  PERFORM public.afip_marcar_delegacion(p_org, p_ok, p_detalle);
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

CREATE OR REPLACE VIEW public.afip_connection_status AS
SELECT a.org_id, a.cuit, a.punto_venta, a.environment, a.tipo_emisor,
  a.razon_social, a.domicilio, a.modo,
  a.cuit IS NOT NULL AND btrim(a.cuit) <> '' AND EXISTS (
    SELECT 1 FROM public.afip_platform_credentials p
    WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL
      AND p.environment = a.environment
  ) AS configured,
  EXISTS (
    SELECT 1 FROM public.afip_platform_credentials p
    WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL
  ) AS plataforma_lista,
  (SELECT p.cuit FROM public.afip_platform_credentials p
    WHERE p.certificate IS NOT NULL LIMIT 1) AS plataforma_cuit,
  (SELECT p.razon_social FROM public.afip_platform_credentials p
    WHERE p.certificate IS NOT NULL LIMIT 1) AS plataforma_razon_social,
  (SELECT p.ta_expires_at FROM public.afip_platform_credentials p
    WHERE p.environment = a.environment LIMIT 1) AS ta_expires_at,
  COALESCE((SELECT p.ta_expires_at > now()
    FROM public.afip_platform_credentials p
    WHERE p.environment = a.environment LIMIT 1), false) AS ticket_vigente,
  CASE
    WHEN a.cuit IS NULL OR btrim(a.cuit) = '' THEN 'falta_datos_fiscales'
    WHEN NOT EXISTS (SELECT 1 FROM public.afip_platform_credentials p
      WHERE p.certificate IS NOT NULL AND p.private_key IS NOT NULL) THEN 'falta_plataforma'
    WHEN NOT EXISTS (SELECT 1 FROM public.afip_platform_credentials p
      WHERE p.environment = a.environment) THEN 'falta_ambiente'
    WHEN NOT a.delegacion_verificada AND a.cuit =
      (SELECT p.cuit FROM public.afip_platform_credentials p LIMIT 1)
      THEN 'sin_delegacion_necesaria'
    WHEN NOT a.delegacion_verificada THEN 'falta_delegar'
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
REVOKE ALL ON FUNCTION public.afip_invalidar_contexto()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_invalidar_contexto() TO service_role;
REVOKE ALL ON FUNCTION public.afip_invalidar_representacion()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_invalidar_representacion() TO service_role;
