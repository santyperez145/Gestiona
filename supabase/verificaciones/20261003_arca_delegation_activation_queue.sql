-- Verificación reversible del handoff comercio -> Platform.
-- No llama ARCA, no lee secretos y no deja organizaciones ni solicitudes.
BEGIN;

CREATE TEMP TABLE zz_arca_activation_results (
  scenario text PRIMARY KEY,
  ok boolean NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_owner uuid;
  v_admin uuid;
  v_environment text;
  v_version bigint;
  v_first_request timestamptz;
  v_result jsonb;
  v_motivo text;
BEGIN
  SELECT user_id INTO v_owner
    FROM public.memberships
   WHERE role = 'owner'
   ORDER BY joined_at
   LIMIT 1;
  SELECT user_id INTO v_admin FROM public.platform_admins LIMIT 1;
  SELECT environment INTO v_environment
    FROM public.afip_platform_credentials
   WHERE certificate IS NOT NULL AND private_key IS NOT NULL
   LIMIT 1;
  IF v_owner IS NULL OR v_admin IS NULL OR v_environment IS NULL THEN
    RAISE EXCEPTION 'Se necesitan owner, platform admin y certificado de plataforma';
  END IF;

  INSERT INTO public.organizations(id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ ARCA activation', 'zz-arca-activation-' || v_org, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role)
  VALUES (v_org, v_owner, 'owner');
  INSERT INTO public.afip_credentials(
    org_id, cuit, punto_venta, environment, tipo_emisor,
    razon_social, domicilio, modo, delegacion_verificada
  ) VALUES (
    v_org, '20123456786', 7, v_environment, 'responsable_inscripto',
    'ZZ ARCA activation', 'ZZ address', 'delegado', false
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  v_result := public.afip_solicitar_revision_delegacion(v_org);
  SELECT delegacion_solicitada_at INTO v_first_request
    FROM public.afip_credentials WHERE org_id = v_org;
  INSERT INTO zz_arca_activation_results VALUES (
    'merchant_requests_activation',
    v_result->>'estado' = 'pendiente' AND v_first_request IS NOT NULL
  );

  v_result := public.afip_solicitar_revision_delegacion(v_org);
  INSERT INTO zz_arca_activation_results
  SELECT 'duplicate_request_is_idempotent',
    v_result->>'estado' = 'pendiente'
    AND delegacion_solicitada_at = v_first_request
    AND (SELECT count(*) FROM public.audit_logs
          WHERE org_id = v_org AND entity_type = 'fiscal_delegation') = 1
  FROM public.afip_credentials WHERE org_id = v_org;

  SELECT motivo INTO v_motivo
    FROM public.afip_connection_status WHERE org_id = v_org;
  INSERT INTO zz_arca_activation_results VALUES (
    'merchant_sees_platform_handoff', v_motivo = 'esperando_plataforma'
  );
  INSERT INTO zz_arca_activation_results VALUES (
    'browser_cannot_confirm',
    NOT has_function_privilege(
      'authenticated',
      'public.afip_confirmar_contexto(uuid,bigint,text,boolean,text,uuid)',
      'EXECUTE'
    )
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text,
    true
  );
  INSERT INTO zz_arca_activation_results
  SELECT 'platform_queue_contains_request', count(*) = 1
    FROM public.platform_afip_delegation_queue WHERE org_id = v_org;

  SELECT conexion_version INTO v_version
    FROM public.afip_credentials WHERE org_id = v_org;
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin, 'role', 'service_role')::text,
    true
  );
  v_result := public.afip_confirmar_contexto(
    v_org, v_version, v_environment, false, 'designación no aceptada', v_admin
  );
  INSERT INTO zz_arca_activation_results
  SELECT 'platform_review_is_persisted',
    v_result = '{"ok":true}'::jsonb
    AND delegacion_revisada_at IS NOT NULL
    AND delegacion_revisada_por = v_admin
    AND last_error = 'designación no aceptada'
  FROM public.afip_credentials WHERE org_id = v_org;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  SELECT motivo INTO v_motivo
    FROM public.afip_connection_status WHERE org_id = v_org;
  INSERT INTO zz_arca_activation_results VALUES (
    'merchant_sees_actionable_correction', v_motivo = 'requiere_correccion'
  );

  v_result := public.afip_solicitar_revision_delegacion(v_org);
  INSERT INTO zz_arca_activation_results
  SELECT 'retry_clears_previous_review',
    v_result->>'estado' = 'pendiente'
    AND delegacion_revisada_at IS NULL
    AND delegacion_revisada_por IS NULL
    AND last_error IS NULL
  FROM public.afip_credentials WHERE org_id = v_org;

  SELECT conexion_version INTO v_version
    FROM public.afip_credentials WHERE org_id = v_org;
  UPDATE public.afip_credentials SET punto_venta = 8 WHERE org_id = v_org;
  INSERT INTO zz_arca_activation_results
  SELECT 'config_change_invalidates_handoff',
    conexion_version = v_version + 1
    AND delegacion_solicitada_at IS NULL
    AND delegacion_revisada_at IS NULL
    AND delegacion_verificada = false
  FROM public.afip_credentials WHERE org_id = v_org;

  IF EXISTS (
    SELECT 1 FROM zz_arca_activation_results WHERE ok IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'Fallaron aserciones del handoff fiscal';
  END IF;
END;
$$;

SELECT * FROM zz_arca_activation_results ORDER BY scenario;
ROLLBACK;
