-- Verificación destructiva-cero del alta de comercios desde Platform.
--
-- Ejecutar con:
--   npx supabase db query --linked --file supabase/verificaciones/20260822_atomic_merchant_provisioning.sql

DO $verification$
DECLARE
  v_admin uuid;
  v_admin_email text;
  v_owner uuid := gen_random_uuid();
  v_owner_email text := 'zz-provisioning-' || gen_random_uuid()::text || '@example.invalid';
  v_outsider uuid;
  v_key uuid := gen_random_uuid();
  v_org_id uuid;
  v_retry_org_id uuid;
  v_first_created boolean;
  v_retry_created boolean;
  v_blocked boolean;
  v_count integer;
  v_before_orgs integer;
  v_before_provisionings integer;
  v_existing_before jsonb;
  v_existing_after jsonb;
BEGIN
  SELECT platform_admin.user_id, auth_user.email
  INTO v_admin, v_admin_email
  FROM public.platform_admins platform_admin
  JOIN auth.users auth_user ON auth_user.id = platform_admin.user_id
  WHERE platform_admin.role = 'superadmin'
  ORDER BY platform_admin.granted_at
  LIMIT 1;

  SELECT auth_user.id INTO v_outsider
  FROM auth.users auth_user
  WHERE auth_user.id <> v_admin
    AND NOT public.is_platform_admin(auth_user.id)
  ORDER BY auth_user.created_at
  LIMIT 1;

  IF v_admin IS NULL OR v_outsider IS NULL THEN
    RAISE EXCEPTION 'verification requires a superadmin and an outsider';
  END IF;

  SELECT count(*) INTO v_before_orgs FROM public.organizations;
  SELECT count(*) INTO v_before_provisionings
  FROM public.platform_organization_provisionings;
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', organization.id,
      'name', organization.name,
      'trial_ends_at', organization.trial_ends_at
    ) ORDER BY organization.id
  ), '[]'::jsonb)
  INTO v_existing_before
  FROM public.organizations organization
  WHERE organization.owner_user_id = v_admin;

  BEGIN
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub', v_admin,
        'role', 'authenticated',
        'email', v_admin_email
      )::text,
      true
    );

    -- Usuario técnico sin organización. El metadata usa el mismo camino que la
    -- Edge Function y el trigger debe dejar el alta al RPC transaccional.
    INSERT INTO auth.users (
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      v_owner,
      'authenticated',
      'authenticated',
      v_owner_email,
      '',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'full_name', 'ZZ Owner piloto',
        'account_type', 'platform_invited_owner'
      ),
      now(),
      now()
    );
    IF EXISTS (SELECT 1 FROM public.memberships WHERE user_id = v_owner) THEN
      RAISE EXCEPTION 'platform invited owner trigger created a premature workspace';
    END IF;

    -- Reutilizar un usuario ya vinculado debe fallar sin tocar su organización.
    v_blocked := false;
    BEGIN
      PERFORM public.provision_platform_organization(
        gen_random_uuid(),
        v_admin,
        'ZZ No debe renombrar negocio existente',
        NULL,
        14
      );
    EXCEPTION WHEN OTHERS THEN
      v_blocked := position('already belongs' in SQLERRM) > 0;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'existing owner was provisioned again';
    END IF;

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', organization.id,
        'name', organization.name,
        'trial_ends_at', organization.trial_ends_at
      ) ORDER BY organization.id
    ), '[]'::jsonb)
    INTO v_existing_after
    FROM public.organizations organization
    WHERE organization.owner_user_id = v_admin;
    IF v_existing_after IS DISTINCT FROM v_existing_before THEN
      RAISE EXCEPTION 'rejected provisioning mutated an existing organization';
    END IF;

    SELECT
      (result->>'org_id')::uuid,
      (result->>'created')::boolean
    INTO v_org_id, v_first_created
    FROM (
      SELECT public.provision_platform_organization(
        v_key,
        v_owner,
        'ZZ Piloto aprovisionamiento',
        NULL,
        21
      ) AS result
    ) call;

    SELECT
      (result->>'org_id')::uuid,
      (result->>'created')::boolean
    INTO v_retry_org_id, v_retry_created
    FROM (
      SELECT public.provision_platform_organization(
        v_key,
        v_owner,
        'ZZ Piloto aprovisionamiento',
        NULL,
        21
      ) AS result
    ) call;

    IF NOT v_first_created OR v_retry_created OR v_org_id IS DISTINCT FROM v_retry_org_id THEN
      RAISE EXCEPTION 'provisioning retry is not idempotent: % / % / % / %',
        v_first_created, v_retry_created, v_org_id, v_retry_org_id;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.organizations organization
    JOIN public.memberships membership
      ON membership.org_id = organization.id
     AND membership.user_id = v_owner
     AND membership.role = 'owner'
    JOIN public.subscriptions subscription
      ON subscription.org_id = organization.id
     AND subscription.status = 'trialing'
    JOIN public.settings setting
      ON setting.org_id = organization.id
     AND setting.user_id = v_owner
    JOIN public.platform_organization_provisionings provisioning
      ON provisioning.org_id = organization.id
     AND provisioning.idempotency_key = v_key
    WHERE organization.id = v_org_id
      AND organization.name = 'ZZ Piloto aprovisionamiento'
      AND organization.owner_user_id = v_owner
      AND organization.plan_id = subscription.plan_id
      AND setting.business_name = organization.name
      AND subscription.current_period_end = organization.trial_ends_at;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'atomic provisioning graph is incomplete: % rows', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.admin_audit_logs audit
    WHERE audit.action = 'provisionOrganization'
      AND audit.target_org_id = v_org_id
      AND audit.target_user_id = v_owner
      AND audit.details->>'idempotency_key' = v_key::text;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'provisioning audit is missing or duplicated: %', v_count;
    END IF;

    v_blocked := false;
    BEGIN
      PERFORM public.provision_platform_organization(
        v_key,
        v_owner,
        'ZZ Datos diferentes',
        NULL,
        21
      );
    EXCEPTION WHEN OTHERS THEN
      v_blocked := position('different provisioning data' in SQLERRM) > 0;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'same idempotency key accepted different data';
    END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text,
      true
    );
    v_blocked := false;
    BEGIN
      PERFORM public.provision_platform_organization(
        gen_random_uuid(),
        v_outsider,
        'ZZ Alta no autorizada',
        NULL,
        14
      );
    EXCEPTION WHEN OTHERS THEN
      v_blocked := position('requires platform superadmin' in SQLERRM) > 0;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'outsider provisioned an organization';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT count(*) INTO v_count FROM public.organizations;
  IF v_count <> v_before_orgs THEN
    RAISE EXCEPTION 'verification left organizations: before %, after %', v_before_orgs, v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.platform_organization_provisionings;
  IF v_count <> v_before_provisionings THEN
    RAISE EXCEPTION 'verification left provisionings: before %, after %',
      v_before_provisionings, v_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organizations WHERE name LIKE 'ZZ Piloto aprovisionamiento%'
  ) THEN
    RAISE EXCEPTION 'verification left ZZ organizations';
  END IF;

  RAISE NOTICE 'atomic provisioning verification passed: graph=1, retry=1 org, previous org unchanged, outsider blocked, audit=1, leftovers=0';
END
$verification$;
