-- Verificacion reversible: no llama WSAA/WSFE ni usa credenciales reales.
BEGIN;

CREATE TEMP TABLE zz_arca_context_results (
  scenario text PRIMARY KEY,
  ok boolean NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_owner uuid;
  v_version bigint;
  v_result jsonb;
BEGIN
  SELECT user_id INTO v_owner
    FROM public.memberships
   WHERE role = 'owner'
   ORDER BY joined_at
   LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Se necesita una identidad owner existente';
  END IF;

  INSERT INTO public.organizations(id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ ARCA context', 'zz-arca-context-' || v_org, v_owner);
  INSERT INTO public.memberships(org_id, user_id, role)
  VALUES (v_org, v_owner, 'owner');
  INSERT INTO public.afip_credentials(
    org_id, cuit, punto_venta, environment,
    tipo_emisor, razon_social, domicilio, modo, delegacion_verificada
  ) VALUES (
    v_org, '20123456786', 1, 'produccion',
    'responsable_inscripto', 'ZZ ARCA context', 'ZZ address', 'delegado', true
  );

  SELECT conexion_version INTO v_version
    FROM public.afip_credentials WHERE org_id = v_org;
  UPDATE public.afip_credentials SET punto_venta = 2 WHERE org_id = v_org;
  INSERT INTO zz_arca_context_results
  SELECT 'identity_change_invalidates',
    conexion_version = v_version + 1
    AND delegacion_verificada = false
    AND delegacion_verificada_at IS NULL
  FROM public.afip_credentials WHERE org_id = v_org;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_owner, 'role', 'service_role')::text,
    true
  );
  v_result := public.afip_confirmar_contexto(
    v_org, v_version, 'produccion', true, NULL
  );
  INSERT INTO zz_arca_context_results VALUES (
    'stale_version_blocked',
    v_result = '{"ok":false,"code":"configuration_changed"}'::jsonb
  );

  SELECT conexion_version INTO v_version
    FROM public.afip_credentials WHERE org_id = v_org;
  v_result := public.afip_confirmar_contexto(
    v_org, v_version, 'homologacion', true, NULL
  );
  INSERT INTO zz_arca_context_results VALUES (
    'environment_mismatch_blocked',
    v_result = '{"ok":false,"code":"environment_mismatch"}'::jsonb
  );

  v_result := public.afip_confirmar_contexto(
    v_org, v_version, 'produccion', true, NULL
  );
  INSERT INTO zz_arca_context_results VALUES (
    'delegated_context_confirmed', v_result = '{"ok":true}'::jsonb
  );
  INSERT INTO zz_arca_context_results
  SELECT 'confirmation_persisted', delegacion_verificada = true
    AND delegacion_verificada_at IS NOT NULL
  FROM public.afip_credentials WHERE org_id = v_org;

  INSERT INTO zz_arca_context_results VALUES (
    'browser_cannot_confirm',
    NOT has_function_privilege(
      'authenticated',
      'public.afip_confirmar_contexto(uuid,bigint,text,boolean,text,uuid)',
      'EXECUTE'
    )
  );

  IF EXISTS (
    SELECT 1 FROM zz_arca_context_results WHERE ok IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'Fallaron aserciones del contexto fiscal';
  END IF;
END;
$$;

SELECT * FROM zz_arca_context_results ORDER BY scenario;
ROLLBACK;
