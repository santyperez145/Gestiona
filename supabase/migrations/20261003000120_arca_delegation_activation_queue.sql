-- La delegación de Facturación Electrónica tiene dos responsables:
-- 1. el comercio designa al CUIT de Nerqia en ARCA;
-- 2. Nerqia acepta la designación y asocia su computador fiscal.
--
-- El estado anterior permitía que el comercio intentara la verificación final
-- directamente. Eso confundía "delegué" con "la plataforma ya aceptó" y no
-- dejaba una cola operable para el staff.

ALTER TABLE public.afip_credentials
  ADD COLUMN IF NOT EXISTS delegacion_solicitada_at timestamptz,
  ADD COLUMN IF NOT EXISTS delegacion_solicitada_por uuid,
  ADD COLUMN IF NOT EXISTS delegacion_revisada_at timestamptz,
  ADD COLUMN IF NOT EXISTS delegacion_revisada_por uuid;

COMMENT ON COLUMN public.afip_credentials.delegacion_solicitada_at IS
  'Momento en que el comercio declara haber completado la designacion en ARCA y pide activacion a Nerqia.';
COMMENT ON COLUMN public.afip_credentials.delegacion_revisada_at IS
  'Ultima verificacion real de la designacion ejecutada por staff contra WSFE.';

CREATE OR REPLACE FUNCTION public.afip_solicitar_revision_delegacion(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_config public.afip_credentials%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_org IS NULL OR NOT public.is_org_member(p_org, v_actor) THEN
    RAISE EXCEPTION 'No pertenecés a esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(
    p_org, 'invoices', 'edit', 'solicitar la activación fiscal'
  );

  SELECT * INTO v_config
    FROM public.afip_credentials
   WHERE org_id = p_org
   FOR UPDATE;
  IF NOT FOUND OR v_config.cuit IS NULL OR btrim(v_config.cuit) = '' THEN
    RAISE EXCEPTION 'Completá primero el CUIT y el punto de venta';
  END IF;
  IF v_config.modo = 'propio' THEN
    RAISE EXCEPTION 'La activación delegada no aplica a un certificado propio';
  END IF;
  IF v_config.delegacion_verificada THEN
    RETURN jsonb_build_object('ok', true, 'estado', 'verificada');
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.afip_platform_credentials platform
     WHERE platform.certificate IS NOT NULL
       AND platform.private_key IS NOT NULL
       AND platform.environment = v_config.environment
  ) THEN
    RAISE EXCEPTION 'Nerqia todavía no tiene un certificado activo para este ambiente';
  END IF;

  -- Repetir el clic no duplica trabajo ni auditoría mientras la solicitud siga
  -- sin revisión. Se devuelve el mismo estado de forma idempotente.
  IF v_config.delegacion_solicitada_at IS NOT NULL
     AND v_config.delegacion_revisada_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'estado', 'pendiente',
      'solicitada_at', v_config.delegacion_solicitada_at
    );
  END IF;

  UPDATE public.afip_credentials
     SET delegacion_solicitada_at = now(),
         delegacion_solicitada_por = v_actor,
         delegacion_revisada_at = NULL,
         delegacion_revisada_por = NULL,
         last_error = NULL,
         updated_at = now()
   WHERE org_id = p_org;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id,
    old_values, new_values, details, severity, tags
  ) VALUES (
    v_actor, p_org, 'update', 'fiscal_delegation', p_org::text,
    NULL,
    jsonb_build_object('estado', 'pendiente', 'environment', v_config.environment),
    jsonb_build_object('source', 'afip_solicitar_revision_delegacion'),
    'warning', ARRAY['fiscal','delegation','activation']::text[]
  );

  RETURN jsonb_build_object('ok', true, 'estado', 'pendiente');
END;
$fn$;

REVOKE ALL ON FUNCTION public.afip_solicitar_revision_delegacion(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.afip_solicitar_revision_delegacion(uuid)
  TO authenticated;

-- La confirmación sigue siendo exclusiva del service role. El actor de staff
-- se pasa explícitamente porque el cliente de la Edge usa service_role y, por
-- lo tanto, auth.uid() no identifica a la persona que inició la revisión.
DROP FUNCTION IF EXISTS public.afip_confirmar_contexto(uuid,bigint,text,boolean,text);
CREATE FUNCTION public.afip_confirmar_contexto(
  p_org uuid,
  p_version bigint,
  p_environment text,
  p_ok boolean,
  p_detalle text DEFAULT NULL,
  p_revisor uuid DEFAULT NULL
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
  IF p_revisor IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.platform_admins admin WHERE admin.user_id = p_revisor
  ) THEN
    RAISE EXCEPTION 'El revisor no pertenece al staff de plataforma'
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
  IF p_revisor IS NOT NULL THEN
    UPDATE public.afip_credentials
       SET delegacion_revisada_at = now(),
           delegacion_revisada_por = p_revisor,
           updated_at = now()
     WHERE org_id = p_org;
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.afip_confirmar_contexto(uuid,bigint,text,boolean,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_confirmar_contexto(uuid,bigint,text,boolean,text,uuid)
  TO service_role;

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
    NEW.delegacion_solicitada_at := NULL;
    NEW.delegacion_solicitada_por := NULL;
    NEW.delegacion_revisada_at := NULL;
    NEW.delegacion_revisada_por := NULL;
    NEW.last_error := NULL;
  END IF;
  RETURN NEW;
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
  a.delegacion_solicitada_at, a.delegacion_revisada_at
FROM public.afip_credentials a
WHERE public.is_org_member(a.org_id, auth.uid());

GRANT SELECT ON public.afip_connection_status TO authenticated;

CREATE OR REPLACE VIEW public.platform_afip_delegation_queue AS
SELECT
  credentials.org_id,
  organization.name AS organization_name,
  credentials.cuit,
  credentials.razon_social,
  credentials.punto_venta,
  credentials.environment,
  credentials.delegacion_solicitada_at,
  credentials.delegacion_revisada_at,
  credentials.delegacion_verificada,
  credentials.delegacion_verificada_at,
  credentials.last_error,
  CASE
    WHEN credentials.delegacion_verificada THEN 'verificada'
    WHEN credentials.delegacion_revisada_at IS NOT NULL THEN 'requiere_correccion'
    ELSE 'pendiente'
  END AS estado
FROM public.afip_credentials credentials
JOIN public.organizations organization ON organization.id = credentials.org_id
WHERE public.is_platform_admin(auth.uid())
  AND credentials.modo <> 'propio'
  AND credentials.delegacion_solicitada_at IS NOT NULL;

COMMENT ON VIEW public.platform_afip_delegation_queue IS
  'Cola de activacion fiscal para staff. No expone certificados, claves ni Tickets de Acceso.';
REVOKE ALL ON public.platform_afip_delegation_queue FROM PUBLIC, anon;
GRANT SELECT ON public.platform_afip_delegation_queue TO authenticated;

DO $guard$
BEGIN
  IF has_function_privilege(
    'anon', 'public.afip_solicitar_revision_delegacion(uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anon puede solicitar una activacion fiscal';
  END IF;
  IF has_function_privilege(
    'authenticated',
    'public.afip_confirmar_contexto(uuid,bigint,text,boolean,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'El navegador puede confirmar una delegacion fiscal';
  END IF;
END;
$guard$;
