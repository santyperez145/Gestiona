-- P1-04 — Autorización fiscal server-side.
--
-- `afip_marcar_delegacion` declaraba ser sólo-backend, pero un rol anónimo
-- conservaba EXECUTE y su guarda era:
--
--   IF auth.uid() IS NOT NULL AND NOT is_platform_admin(...) THEN ...
--
-- Para anon, auth.uid() es NULL: la condición no entraba y cualquiera que
-- conociera un org_id podía convertir una delegación en «verificada». Además,
-- `save_afip_config` tenía un rol owner/admin hardcodeado en vez de la matriz
-- funcional que el comercio administra. Este slice cierra ambos contratos.

CREATE OR REPLACE FUNCTION public.save_afip_config(
  p_org_id uuid, p_cuit text, p_punto_venta integer, p_environment text,
  p_tipo_emisor text DEFAULT NULL, p_razon_social text DEFAULT NULL,
  p_domicilio text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_old_values jsonb;
  v_new_values jsonb;
BEGIN
  -- P1-04: membresía y permiso responden preguntas distintas. La primera
  -- evita cross-tenant; la segunda respeta Admin → Permisos incluso si el rol
  -- fue personalizado.
  IF p_org_id IS NULL OR NOT public.is_org_member(p_org_id, v_actor) THEN
    RAISE EXCEPTION 'No pertenecés a esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(
    p_org_id, 'invoices', 'edit', 'configurar la identidad fiscal de AFIP'
  );

  IF p_environment NOT IN ('homologacion', 'produccion') THEN
    RAISE EXCEPTION 'Entorno inválido: %', p_environment;
  END IF;
  IF regexp_replace(COALESCE(p_cuit, ''), '\D', '', 'g') !~ '^\d{11}$' THEN
    RAISE EXCEPTION 'El CUIT debe tener 11 dígitos';
  END IF;
  IF NOT public.cuit_valido(regexp_replace(p_cuit, '\D', '', 'g')) THEN
    RAISE EXCEPTION 'El CUIT no es válido (dígito verificador)';
  END IF;
  IF p_punto_venta IS NULL OR p_punto_venta NOT BETWEEN 1 AND 9999 THEN
    RAISE EXCEPTION 'El punto de venta debe estar entre 1 y 9999';
  END IF;
  IF p_tipo_emisor IS NOT NULL
     AND p_tipo_emisor NOT IN ('monotributo', 'responsable_inscripto', 'exento') THEN
    RAISE EXCEPTION 'Tipo de emisor inválido';
  END IF;

  -- Nunca se auditan TA, certificado ni clave. Sólo los datos fiscales que la
  -- persona acaba de confirmar en la pantalla.
  SELECT jsonb_build_object(
    'cuit', credentials.cuit,
    'punto_venta', credentials.punto_venta,
    'environment', credentials.environment,
    'tipo_emisor', credentials.tipo_emisor,
    'razon_social', credentials.razon_social,
    'domicilio', credentials.domicilio
  ) INTO v_old_values
  FROM public.afip_credentials credentials
  WHERE credentials.org_id = p_org_id;

  INSERT INTO public.afip_credentials AS credentials (
    org_id, cuit, punto_venta, environment, tipo_emisor, razon_social, domicilio
  ) VALUES (
    p_org_id,
    regexp_replace(p_cuit, '\D', '', 'g'),
    p_punto_venta, p_environment, p_tipo_emisor,
    NULLIF(trim(p_razon_social), ''), NULLIF(trim(p_domicilio), '')
  )
  ON CONFLICT (org_id) DO UPDATE SET
    cuit = EXCLUDED.cuit,
    punto_venta = EXCLUDED.punto_venta,
    -- Un TA pertenece a un ambiente. Cambiarlo invalida sólo el ticket; el
    -- certificado/delegación conservan su autoridad y no pasan por el cliente.
    ta_token = CASE
      WHEN credentials.environment <> EXCLUDED.environment THEN NULL
      ELSE credentials.ta_token
    END,
    ta_sign = CASE
      WHEN credentials.environment <> EXCLUDED.environment THEN NULL
      ELSE credentials.ta_sign
    END,
    ta_expires_at = CASE
      WHEN credentials.environment <> EXCLUDED.environment THEN NULL
      ELSE credentials.ta_expires_at
    END,
    environment = EXCLUDED.environment,
    tipo_emisor = EXCLUDED.tipo_emisor,
    razon_social = EXCLUDED.razon_social,
    domicilio = EXCLUDED.domicilio,
    updated_at = now();

  v_new_values := jsonb_build_object(
    'cuit', regexp_replace(p_cuit, '\D', '', 'g'),
    'punto_venta', p_punto_venta,
    'environment', p_environment,
    'tipo_emisor', p_tipo_emisor,
    'razon_social', NULLIF(trim(p_razon_social), ''),
    'domicilio', NULLIF(trim(p_domicilio), '')
  );

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id,
    old_values, new_values, details, severity, tags
  ) VALUES (
    v_actor, p_org_id, 'update', 'fiscal_configuration', p_org_id::text,
    v_old_values, v_new_values,
    jsonb_build_object('permission', 'invoices.edit', 'source', 'save_afip_config'),
    'warning', ARRAY['fiscal','configuration']::text[]
  );

  RETURN jsonb_build_object(
    'ok', true,
    'modo', (SELECT modo FROM public.afip_credentials WHERE org_id = p_org_id)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.save_afip_config(uuid, text, integer, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_afip_config(uuid, text, integer, text, text, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.afip_marcar_delegacion(
  p_org uuid,
  p_ok boolean,
  p_detalle text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  -- PostgREST sólo puede entrar con service_role. La excepción de session_user
  -- mantiene repetibles las verificaciones SQL ejecutadas directamente por el
  -- dueño de la base; `authenticator` (anon/authenticated) nunca la satisface.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT (
       auth.role() IS NULL
       AND session_user IN ('postgres', 'supabase_admin')
     ) THEN
    RAISE EXCEPTION 'Sólo el backend puede marcar el estado de la delegación'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.afip_credentials
  SET delegacion_verificada = p_ok,
      delegacion_verificada_at = CASE WHEN p_ok THEN now() ELSE NULL END,
      last_error = CASE
        WHEN p_ok THEN NULL
        ELSE left(COALESCE(p_detalle, ''), 500)
      END
  WHERE org_id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La organización no tiene configuración fiscal'
      USING ERRCODE = '22023';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.afip_marcar_delegacion(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_marcar_delegacion(uuid, boolean, text)
  TO service_role;

-- La estadística ya corre como invoker y la RLS filtra el tenant. Se quita anon
-- igualmente: no existe una pantalla fiscal pública y el contrato no debe
-- depender de que la tabla de abajo conserve para siempre la policy correcta.
REVOKE ALL ON FUNCTION public.get_afip_stats(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_afip_stats(uuid, integer) TO authenticated;

DO $verification$
BEGIN
  IF has_function_privilege(
       'anon',
       'public.afip_marcar_delegacion(uuid,boolean,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.afip_marcar_delegacion(uuid,boolean,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.afip_marcar_delegacion(uuid,boolean,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'afip_marcar_delegacion no quedó exclusiva del backend';
  END IF;
  IF has_function_privilege(
       'anon',
       'public.save_afip_config(uuid,text,integer,text,text,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'anon todavía puede invocar save_afip_config';
  END IF;
END;
$verification$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260828000150', 'anon_no_verifica_una_delegacion_fiscal')
ON CONFLICT DO NOTHING;
