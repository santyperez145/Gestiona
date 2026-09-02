-- Identidad fiscal completa al conectar AFIP
--
-- El formulario ya pedía domicilio fiscal, pero `save_afip_config` lo
-- aceptaba vacío (`NULLIF(trim(...), '')` → NULL). Facturas y las páginas
-- legales leen `afip_connection_status.domicilio`: un comercio conectado
-- seguía sin decir dónde vende.
--
-- ⚠️ Misma firma. `CREATE OR REPLACE` con otro parámetro agregaría una
-- sobrecarga (`unaFuncionUnaFirma`). Razón social y domicilio dejan de ser
-- opcionales en el cuerpo.
--
-- ⚠️ `configured` de la vista NO cambia: ARCA no pide domicilio para WSFE.
-- Pedir CAE sigue. No se backfillea Exentry ni se adivina el domicilio desde
-- el padrón, el retiro en local ni el login.

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
  IF NULLIF(trim(p_razon_social), '') IS NULL THEN
    RAISE EXCEPTION 'Falta la razón social';
  END IF;
  IF NULLIF(trim(p_domicilio), '') IS NULL THEN
    RAISE EXCEPTION 'Falta el domicilio fiscal';
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

DO $verif$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(
    'public.save_afip_config(uuid,text,integer,text,text,text,text)'::regprocedure
  ) INTO v_def;
  IF v_def IS NULL OR position('Falta el domicilio fiscal' in v_def) = 0 THEN
    RAISE EXCEPTION 'save_afip_config no exige domicilio fiscal';
  END IF;
  IF position('Falta la razón social' in v_def) = 0 THEN
    RAISE EXCEPTION 'save_afip_config no exige razón social';
  END IF;
  IF position('exigir_permiso' in v_def) = 0
     OR position('''invoices''' in v_def) = 0 THEN
    RAISE EXCEPTION 'save_afip_config perdió la guarda de invoices.edit';
  END IF;
END
$verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260901000070', 'identidad_fiscal_completa')
ON CONFLICT DO NOTHING;
