-- Verificación destructiva-cero de autorización fiscal P1-04.
--
-- Ejecutar con:
--   npx supabase db query --linked --file supabase/verificaciones/20260828_autorizacion_fiscal.sql

DO $verification$
DECLARE
  v_user uuid;
  v_org uuid := gen_random_uuid();
  v_other_org uuid := gen_random_uuid();
  v_suffix text := substr(gen_random_uuid()::text, 1, 8);
  v_result jsonb;
  v_blocked boolean;
  v_count integer;
  v_restos integer;
BEGIN
  SELECT user_account.id INTO v_user
  FROM auth.users user_account
  ORDER BY user_account.created_at
  LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'La verificación necesita un usuario existente';
  END IF;

  BEGIN
    INSERT INTO public.organizations(id, name, slug, owner_user_id)
    VALUES
      (v_org, 'ZZ Fiscal autorizado', 'zz-fiscal-' || v_suffix, v_user),
      (v_other_org, 'ZZ Fiscal ajeno', 'zz-fiscal-ajeno-' || v_suffix, v_user);
    INSERT INTO public.memberships(org_id, user_id, role)
    VALUES (v_org, v_user, 'vendedor');

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
      true
    );

    -- Mismo tenant, permiso desmarcado: no alcanza con ser miembro.
    v_blocked := false;
    BEGIN
      PERFORM public.save_afip_config(
        v_org, '20123456786', 1, 'homologacion',
        'monotributo', 'ZZ Razón fiscal', 'ZZ Domicilio fiscal'
      );
    EXCEPTION WHEN insufficient_privilege THEN
      v_blocked := position('permiso' in SQLERRM) > 0;
    END;
    IF NOT v_blocked OR EXISTS (
      SELECT 1 FROM public.afip_credentials WHERE org_id = v_org
    ) THEN
      RAISE EXCEPTION 'Un vendedor sin invoices.edit pudo configurar AFIP';
    END IF;

    -- La organización habilita el permiso: la misma persona puede ejecutar.
    UPDATE public.role_permissions
    SET can_edit = true
    WHERE org_id = v_org AND role = 'vendedor' AND module = 'invoices';
    v_result := public.save_afip_config(
      v_org, '20123456786', 1, 'homologacion',
      'monotributo', 'ZZ Razón fiscal', 'ZZ Domicilio fiscal'
    );
    IF v_result->>'ok' <> 'true' OR NOT EXISTS (
      SELECT 1 FROM public.afip_credentials
      WHERE org_id = v_org
        AND cuit = '20123456786'
        AND punto_venta = 1
        AND environment = 'homologacion'
    ) THEN
      RAISE EXCEPTION 'invoices.edit no habilitó la configuración fiscal: %', v_result;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.audit_logs
    WHERE org_id = v_org
      AND user_id = v_user
      AND entity_type = 'fiscal_configuration'
      AND details->>'permission' = 'invoices.edit'
      AND NOT (COALESCE(old_values, '{}'::jsonb) ?| ARRAY['ta_token','ta_sign','certificate','private_key'])
      AND NOT (COALESCE(new_values, '{}'::jsonb) ?| ARRAY['ta_token','ta_sign','certificate','private_key']);
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'El cambio fiscal no dejó una auditoría saneada';
    END IF;

    -- El permiso del tenant A no sirve sobre el tenant B.
    v_blocked := false;
    BEGIN
      PERFORM public.save_afip_config(
        v_other_org, '20123456786', 1, 'homologacion',
        'monotributo', 'ZZ Ajeno', 'ZZ Ajeno'
      );
    EXCEPTION WHEN insufficient_privilege THEN
      v_blocked := position('pertenecés' in SQLERRM) > 0;
    END;
    IF NOT v_blocked OR EXISTS (
      SELECT 1 FROM public.afip_credentials WHERE org_id = v_other_org
    ) THEN
      RAISE EXCEPTION 'invoices.edit cruzó de una organización a otra';
    END IF;

    -- La guarda interna frena anon incluso si el ensayo corre como dueño de DB.
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    v_blocked := false;
    BEGIN
      PERFORM public.afip_marcar_delegacion(v_org, true, NULL);
    EXCEPTION WHEN insufficient_privilege THEN
      v_blocked := true;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'anon pudo autoverificar una delegación fiscal';
    END IF;

    -- El único consumidor real es la Edge Function con service_role.
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    PERFORM public.afip_marcar_delegacion(v_org, true, NULL);
    IF NOT EXISTS (
      SELECT 1 FROM public.afip_credentials
      WHERE org_id = v_org AND delegacion_verificada
    ) THEN
      RAISE EXCEPTION 'service_role no pudo guardar la verificación real';
    END IF;

    IF has_function_privilege(
         'anon', 'public.afip_marcar_delegacion(uuid,boolean,text)', 'EXECUTE'
       )
       OR has_function_privilege(
         'authenticated', 'public.afip_marcar_delegacion(uuid,boolean,text)', 'EXECUTE'
       )
       OR NOT has_function_privilege(
         'service_role', 'public.afip_marcar_delegacion(uuid,boolean,text)', 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Las ACL fiscales no coinciden con el contrato';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT
    (SELECT count(*) FROM public.organizations WHERE id IN (v_org, v_other_org))
    + (SELECT count(*) FROM public.afip_credentials WHERE org_id IN (v_org, v_other_org))
    + (SELECT count(*) FROM public.audit_logs WHERE org_id IN (v_org, v_other_org))
  INTO v_restos;
  IF v_restos <> 0 THEN
    RAISE EXCEPTION 'La verificación fiscal dejó % restos', v_restos;
  END IF;

  RAISE NOTICE 'Autorización fiscal verificada: vendedor bloqueado, invoices.edit habilita, cross-tenant bloqueado, anon bloqueado, service_role habilitado, auditoría saneada, restos=0';
END;
$verification$;
