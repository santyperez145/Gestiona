-- Verificación destructiva-cero del diagnóstico temporal de soporte.
--
-- Ejecutar con:
--   npx supabase db query --linked --file supabase/verificaciones/20260822_support_diagnostic_access.sql

DO $verification$
DECLARE
  v_staff uuid;
  v_staff_email text;
  v_owner uuid;
  v_outsider uuid;
  v_org uuid;
  v_request_id uuid;
  v_retry_id uuid;
  v_first_expiry timestamptz;
  v_retry_expiry timestamptz;
  v_snapshot jsonb;
  v_count integer;
  v_blocked boolean;
  v_before integer;
BEGIN
  SELECT pa.user_id, u.email
  INTO v_staff, v_staff_email
  FROM public.platform_admins pa
  JOIN auth.users u ON u.id = pa.user_id
  WHERE pa.role IN ('support', 'superadmin')
  ORDER BY (pa.role = 'support') DESC, pa.granted_at
  LIMIT 1;

  SELECT m.user_id, m.org_id
  INTO v_owner, v_org
  FROM public.memberships m
  WHERE m.role = 'owner'
    AND m.user_id <> v_staff
  ORDER BY m.created_at
  LIMIT 1;

  SELECT u.id INTO v_outsider
  FROM auth.users u
  WHERE u.id NOT IN (v_staff, v_owner)
    AND NOT public.is_org_member(v_org, u.id)
    AND NOT public.is_platform_admin(u.id)
  LIMIT 1;

  IF v_staff IS NULL OR v_owner IS NULL OR v_org IS NULL OR v_outsider IS NULL THEN
    RAISE EXCEPTION 'verification requires support staff, owner and outsider';
  END IF;

  SELECT count(*) INTO v_before
  FROM public.support_diagnostic_access_requests;

  BEGIN
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_staff, 'role', 'authenticated', 'email', v_staff_email)::text,
      true
    );

    SELECT (public.request_support_diagnostic_access(v_org, 'activation')->>'id')::uuid
    INTO v_request_id;
    SELECT (public.request_support_diagnostic_access(v_org, 'activation')->>'id')::uuid
    INTO v_retry_id;
    IF v_request_id IS DISTINCT FROM v_retry_id THEN
      RAISE EXCEPTION 'pending request retry created another id: % / %', v_request_id, v_retry_id;
    END IF;
    SELECT count(*) INTO v_count
    FROM public.support_diagnostic_access_requests
    WHERE org_id = v_org AND requested_by = v_staff AND revoked_at IS NULL;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'request retry left % open rows', v_count;
    END IF;

    v_blocked := false;
    BEGIN
      PERFORM public.get_support_diagnostic_snapshot(v_request_id);
    EXCEPTION WHEN OTHERS THEN
      v_blocked := position('not active' in SQLERRM) > 0;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'pending request could read a snapshot';
    END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text,
      true
    );
    v_blocked := false;
    BEGIN
      PERFORM public.approve_support_diagnostic_access(v_request_id, 15);
    EXCEPTION WHEN OTHERS THEN
      v_blocked := position('requires organization owner' in SQLERRM) > 0;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'outsider approved diagnostic access';
    END IF;
    SELECT count(*) INTO v_count
    FROM public.organization_support_diagnostic_requests
    WHERE id = v_request_id;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'outsider can read owner diagnostic requests';
    END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
      true
    );
    SELECT (public.approve_support_diagnostic_access(v_request_id, 15)->>'expires_at')::timestamptz
    INTO v_first_expiry;
    SELECT (public.approve_support_diagnostic_access(v_request_id, 60)->>'expires_at')::timestamptz
    INTO v_retry_expiry;
    IF v_first_expiry IS DISTINCT FROM v_retry_expiry THEN
      RAISE EXCEPTION 'approval retry extended consent: % / %', v_first_expiry, v_retry_expiry;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_support_diagnostic_requests
      WHERE id = v_request_id AND status = 'active'
        AND staff_email = v_staff_email
    ) THEN
      RAISE EXCEPTION 'owner cannot see active consent';
    END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_staff, 'role', 'authenticated', 'email', v_staff_email)::text,
      true
    );
    v_snapshot := public.get_support_diagnostic_snapshot(v_request_id);
    v_snapshot := public.get_support_diagnostic_snapshot(v_request_id);
    IF (v_snapshot#>>'{access,view_count}')::integer <> 2 THEN
      RAISE EXCEPTION 'snapshot views were not counted: %', v_snapshot#>>'{access,view_count}';
    END IF;
    IF v_snapshot->>'schema_version' <> '1'
       OR NOT (v_snapshot ? 'activation')
       OR NOT (v_snapshot ? 'catalog_quality')
       OR NOT (v_snapshot ? 'stock_accuracy')
       OR NOT (v_snapshot ? 'integrations') THEN
      RAISE EXCEPTION 'snapshot contract is incomplete: %', v_snapshot;
    END IF;
    IF lower(v_snapshot::text) ~ '(access_token|refresh_token|api_key|private_key|certificate|customer|product_name|sale_price|cost_usd|total_ars|last_error|error_message)' THEN
      RAISE EXCEPTION 'snapshot exposes a forbidden key: %', v_snapshot;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.platform_support_diagnostic_requests
      WHERE id = v_request_id AND status = 'active' AND view_count = 2
    ) THEN
      RAISE EXCEPTION 'requesting staff cannot see its audited access';
    END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
      true
    );
    PERFORM public.revoke_support_diagnostic_access(v_request_id);
    PERFORM public.revoke_support_diagnostic_access(v_request_id);

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_staff, 'role', 'authenticated', 'email', v_staff_email)::text,
      true
    );
    v_blocked := false;
    BEGIN
      PERFORM public.get_support_diagnostic_snapshot(v_request_id);
    EXCEPTION WHEN OTHERS THEN
      v_blocked := position('not active' in SQLERRM) > 0;
    END;
    IF NOT v_blocked THEN
      RAISE EXCEPTION 'revoked access could still read a snapshot';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT count(*) INTO v_count
  FROM public.support_diagnostic_access_requests;
  IF v_count <> v_before THEN
    RAISE EXCEPTION 'verification left request rows: before %, after %', v_before, v_count;
  END IF;

  RAISE NOTICE 'support diagnostic verification passed: request retry=1, owner approval fixed expiry, outsider blocked, snapshot sanitized, views=2, revoke enforced, leftovers=0';
END
$verification$;
