-- Transactional contract smoke: no mail, TOTP enrollment or durable writes.
-- Run only after 20261004000100_trusted_devices.sql has been applied.
BEGIN;

DO $test$
BEGIN
  IF to_regprocedure('public.trusted_device_command(text,jsonb,text,text,uuid,text)') IS NULL
    OR to_regprocedure('public.get_session_mfa_status()') IS NULL THEN
    RAISE EXCEPTION 'trusted-device RPC contract missing';
  END IF;
  IF has_function_privilege('anon',
      'public.trusted_device_command(text,jsonb,text,text,uuid,text)', 'EXECUTE')
    OR has_function_privilege('authenticated',
      'public.trusted_device_command(text,jsonb,text,text,uuid,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role',
      'public.trusted_device_command(text,jsonb,text,text,uuid,text)', 'EXECUTE')
    OR has_function_privilege('anon','public.get_session_mfa_status()','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.get_session_mfa_status()','EXECUTE')
    OR has_schema_privilege('authenticated','nerqia_auth','USAGE')
    OR has_table_privilege('service_role','nerqia_auth.trusted_devices','SELECT')
    OR (SELECT count(*) FROM public.audit_funciones_expuestas) <> 0 THEN
    RAISE EXCEPTION 'trusted-device SQL permissions are not least-privilege';
  END IF;
END
$test$;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;

DO $test$
DECLARE v_result jsonb;
BEGIN
  v_result := public.trusted_device_command(
    'register', jsonb_build_object(
      'role', 'authenticated', 'sub', gen_random_uuid(),
      'session_id', gen_random_uuid(), 'aal', 'aal2',
      'amr', jsonb_build_array(jsonb_build_object(
        'method', 'totp', 'timestamp', extract(epoch FROM now())::bigint
      ))
    ), p_new_token_hash => repeat('a', 64)
  );
  IF v_result->>'reason' IS DISTINCT FROM 'invalid_session' THEN
    RAISE EXCEPTION 'Forged AAL2 without live auth.sessions was accepted: %', v_result;
  END IF;
END
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', gen_random_uuid(),
  'session_id', gen_random_uuid(), 'aal', 'aal2'
)::text, true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub',
  (current_setting('request.jwt.claims')::jsonb->>'sub'), true);
SET LOCAL ROLE authenticated;

DO $test$
DECLARE v_result jsonb;
BEGIN
  v_result := public.get_session_mfa_status();
  IF v_result->>'satisfied' IS DISTINCT FROM 'false'
    OR v_result->>'requires_mfa' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Stale AAL2 without live session passed UI guard: %', v_result;
  END IF;
END
$test$;

RESET ROLE;

-- Synthetic Auth rows use store_customer to avoid organization bootstrap and
-- never invoke Auth's mail/OTP APIs. All rows, including triggered profiles,
-- disappear on ROLLBACK.
SELECT set_config('td.user_a', gen_random_uuid()::text, true);
SELECT set_config('td.user_b', gen_random_uuid()::text, true);
SELECT set_config('td.session_register', gen_random_uuid()::text, true);
SELECT set_config('td.session_redeem', gen_random_uuid()::text, true);
SELECT set_config('td.session_other', gen_random_uuid()::text, true);
SELECT set_config('td.factor_a', gen_random_uuid()::text, true);
SELECT set_config('td.factor_b', gen_random_uuid()::text, true);

INSERT INTO auth.users (id, email, encrypted_password, raw_user_meta_data)
VALUES
  (current_setting('td.user_a')::uuid,
    'zz-trust-' || replace(current_setting('td.user_a'),'-','') || '@example.invalid',
    'smoke-password-hash-a',
    '{"account_type":"store_customer","full_name":"ZZ trusted device smoke A"}'::jsonb),
  (current_setting('td.user_b')::uuid,
    'zz-trust-' || replace(current_setting('td.user_b'),'-','') || '@example.invalid',
    'smoke-password-hash-b',
    '{"account_type":"store_customer","full_name":"ZZ trusted device smoke B"}'::jsonb);
INSERT INTO auth.sessions (id, user_id) VALUES
  (current_setting('td.session_register')::uuid, current_setting('td.user_a')::uuid),
  (current_setting('td.session_redeem')::uuid, current_setting('td.user_a')::uuid),
  (current_setting('td.session_other')::uuid, current_setting('td.user_b')::uuid);
INSERT INTO auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
VALUES
  (current_setting('td.factor_a')::uuid, current_setting('td.user_a')::uuid,
    'totp', 'verified', now(), now()),
  (current_setting('td.factor_b')::uuid, current_setting('td.user_b')::uuid,
    'totp', 'verified', now(), now());

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;

DO $test$
DECLARE
  v_aal2 jsonb := jsonb_build_object(
    'role','authenticated','sub',current_setting('td.user_a'),
    'session_id',current_setting('td.session_register'),'aal','aal2',
    'amr',jsonb_build_array(jsonb_build_object(
      'method','totp','timestamp',extract(epoch FROM clock_timestamp())::bigint
    )));
  v_aal1 jsonb := jsonb_build_object(
    'role','authenticated','sub',current_setting('td.user_a'),
    'session_id',current_setting('td.session_redeem'),'aal','aal1',
    'amr',jsonb_build_array(jsonb_build_object('method','password')));
  v_other jsonb := jsonb_build_object(
    'role','authenticated','sub',current_setting('td.user_b'),
    'session_id',current_setting('td.session_other'),'aal','aal1',
    'amr',jsonb_build_array(jsonb_build_object('method','password')));
  v_result jsonb;
BEGIN
  -- AAL2 alone and an old TOTP challenge never mint a trusted device.
  v_result := public.trusted_device_command('register',v_aal2 - 'amr',
    p_new_token_hash => repeat('b',64));
  IF v_result->>'reason' IS DISTINCT FROM 'fresh_mfa_required' THEN
    RAISE EXCEPTION 'Register accepted AAL2 without TOTP AMR: %',v_result;
  END IF;
  v_result := public.trusted_device_command('register',
    jsonb_set(v_aal2,'{amr}',jsonb_build_array(jsonb_build_object(
      'method','totp','timestamp',extract(epoch FROM clock_timestamp())::bigint - 301
    ))), p_new_token_hash => repeat('b',64));
  IF v_result->>'reason' IS DISTINCT FROM 'fresh_mfa_required' THEN
    RAISE EXCEPTION 'Register accepted stale TOTP: %',v_result;
  END IF;
  v_result := public.trusted_device_command('register',v_aal2,
    p_new_token_hash => repeat('b',64),p_label => 'ZZ smoke browser');
  IF v_result->>'allowed' IS DISTINCT FROM 'true'
    OR v_result->>'device_id' IS NULL THEN
    RAISE EXCEPTION 'Valid AAL2 TOTP could not register device: %',v_result;
  END IF;
  PERFORM set_config('td.device_a',v_result->>'device_id',true);
  PERFORM set_config('td.expires_a',v_result->>'expires_at',true);
  v_result := public.trusted_device_command('status',v_aal1,
    p_token_hash => repeat('b',64));
  IF v_result->>'allowed' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Device without per-session redemption was trusted: %',v_result;
  END IF;
  v_result := public.trusted_device_command('redeem',v_aal1 - 'amr',
    p_token_hash => repeat('b',64));
  IF v_result->>'reason' IS DISTINCT FROM 'password_login_required' THEN
    RAISE EXCEPTION 'Passwordless session redeemed device: %',v_result;
  END IF;
  v_result := public.trusted_device_command('redeem',v_other,
    p_token_hash => repeat('b',64));
  IF v_result->>'allowed' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Other user redeemed device: %',v_result;
  END IF;
  v_result := public.trusted_device_command('redeem',v_aal1,
    p_token_hash => repeat('b',64));
  IF v_result->>'allowed' IS DISTINCT FROM 'true'
    OR v_result->>'expires_at' IS DISTINCT FROM current_setting('td.expires_a') THEN
    RAISE EXCEPTION 'Password session was not granted fixed 7-day trust: %',v_result;
  END IF;
  v_result := public.trusted_device_command('status',v_aal1,
    p_token_hash => repeat('c',64));
  IF v_result->>'allowed' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Wrong device cookie passed status: %',v_result;
  END IF;
  v_result := public.trusted_device_command('status',v_aal1,
    p_token_hash => repeat('b',64));
  IF v_result->>'allowed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Live grant and cookie were rejected: %',v_result;
  END IF;
  v_result := public.trusted_device_command('list',v_aal1,
    p_token_hash => repeat('b',64));
  IF v_result->>'allowed' IS DISTINCT FROM 'true'
    OR v_result->>'device_id' IS DISTINCT FROM current_setting('td.device_a')
    OR jsonb_array_length(v_result->'devices') <> 1 THEN
    RAISE EXCEPTION 'Own device list/current cookie incorrect: %',v_result;
  END IF;
  v_result := public.trusted_device_command('list',v_aal1);
  IF v_result->>'allowed' IS DISTINCT FROM 'false'
    OR jsonb_array_length(v_result->'devices') <> 1 THEN
    RAISE EXCEPTION 'List conflated authorization with browser cookie: %',v_result;
  END IF;
END
$test$;

RESET ROLE;
DO $test$
DECLARE v_device nerqia_auth.trusted_devices%ROWTYPE;
BEGIN
  SELECT * INTO v_device FROM nerqia_auth.trusted_devices
  WHERE id = current_setting('td.device_a')::uuid;
  IF v_device.token_hash IS DISTINCT FROM repeat('b',64)
    OR v_device.security_fingerprint !~ '^[0-9a-f]{64}$'
    OR v_device.expires_at - v_device.created_at <> interval '7 days'
    OR (SELECT count(*) FROM nerqia_auth.trusted_session_grants
      WHERE user_id = current_setting('td.user_a')::uuid) <> 1 THEN
    RAISE EXCEPTION 'Device persistence, 7-day TTL or session grant incorrect';
  END IF;
END
$test$;

SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','authenticated','sub',current_setting('td.user_a'),
  'session_id',current_setting('td.session_redeem'),'aal','aal1'
)::text,true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub',current_setting('td.user_a'),true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE v_result jsonb;
BEGIN
  v_result := public.get_session_mfa_status();
  IF v_result->>'requires_mfa' IS DISTINCT FROM 'true'
    OR v_result->>'satisfied' IS DISTINCT FROM 'true'
    OR v_result->>'trusted_until' IS NULL THEN
    RAISE EXCEPTION 'AAL1 live grant not reflected in own UI status: %',v_result;
  END IF;
END
$test$;

RESET ROLE;
-- A password change invalidates existing trust without a special trigger.
UPDATE auth.users SET encrypted_password = 'smoke-password-hash-a-changed'
WHERE id = current_setting('td.user_a')::uuid;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF public.get_session_mfa_status()->>'satisfied' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Password change left existing grant trusted';
  END IF;
END
$test$;
RESET ROLE;
UPDATE auth.users SET encrypted_password = 'smoke-password-hash-a'
WHERE id = current_setting('td.user_a')::uuid;

SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_claims jsonb := jsonb_build_object(
    'role','authenticated','sub',current_setting('td.user_a'),
    'session_id',current_setting('td.session_redeem'),'aal','aal1',
    'amr',jsonb_build_array(jsonb_build_object('method','password')));
  v_result jsonb;
BEGIN
  v_result := public.trusted_device_command('revoke',v_claims,
    p_token_hash => repeat('b',64));
  IF v_result->>'revoked' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Current device could not be revoked without ID: %',v_result;
  END IF;
  v_result := public.trusted_device_command('status',v_claims,
    p_token_hash => repeat('b',64));
  IF v_result->>'allowed' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Revoked device still satisfies grant: %',v_result;
  END IF;
END
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','authenticated','sub',current_setting('td.user_a'),
  'session_id',current_setting('td.session_redeem'),'aal','aal1'
)::text,true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF public.get_session_mfa_status()->>'satisfied' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Revocation left own AAL1 grant usable';
  END IF;
END
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_aal2 jsonb := jsonb_build_object(
    'role','authenticated','sub',current_setting('td.user_a'),
    'session_id',current_setting('td.session_register'),'aal','aal2',
    'amr',jsonb_build_array(jsonb_build_object(
      'method','totp','timestamp',extract(epoch FROM clock_timestamp())::bigint)));
  v_aal1 jsonb := jsonb_build_object(
    'role','authenticated','sub',current_setting('td.user_a'),
    'session_id',current_setting('td.session_redeem'),'aal','aal1',
    'amr',jsonb_build_array(jsonb_build_object('method','password')));
  v_result jsonb;
BEGIN
  v_result := public.trusted_device_command('register',v_aal2,
    p_new_token_hash => repeat('c',64));
  IF v_result->>'allowed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Post-revocation register failed: %',v_result;
  END IF;
  PERFORM set_config('td.device_c',v_result->>'device_id',true);
  v_result := public.trusted_device_command('redeem',v_aal1,
    p_token_hash => repeat('c',64));
  IF v_result->>'allowed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Post-revocation redeem failed: %',v_result;
  END IF;
  v_result := public.trusted_device_command('revoke',v_aal1,
    p_device_id => current_setting('td.device_a')::uuid);
  IF v_result->>'revoked' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Already revoked device reported mutation: %',v_result;
  END IF;
END
$test$;

RESET ROLE;
UPDATE auth.mfa_factors SET status = 'unverified', updated_at = now()
WHERE id = current_setting('td.factor_a')::uuid;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
DO $test$
DECLARE v_result jsonb;
BEGIN
  v_result := public.trusted_device_command('status',jsonb_build_object(
    'role','authenticated','sub',current_setting('td.user_a'),
    'session_id',current_setting('td.session_redeem'),'aal','aal1'),
    p_token_hash => repeat('c',64));
  IF v_result->>'allowed' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Removed MFA factor left device trusted: %',v_result;
  END IF;
END
$test$;

RESET ROLE;
UPDATE auth.mfa_factors SET status = 'verified', updated_at = now()
WHERE id = current_setting('td.factor_a')::uuid;
UPDATE nerqia_auth.trusted_devices
SET created_at = now() - interval '8 days', expires_at = now() - interval '1 second'
WHERE id = current_setting('td.device_c')::uuid;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
DO $test$
DECLARE v_result jsonb;
BEGIN
  v_result := public.trusted_device_command('status',jsonb_build_object(
    'role','authenticated','sub',current_setting('td.user_a'),
    'session_id',current_setting('td.session_redeem'),'aal','aal1'),
    p_token_hash => repeat('c',64));
  IF v_result->>'allowed' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Expired seven-day device left grant usable: %',v_result;
  END IF;
END
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','authenticated','sub',current_setting('td.user_a'),
  'session_id',current_setting('td.session_redeem'),'aal','aal1'
)::text,true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF public.get_session_mfa_status()->>'satisfied' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Expired device left UI grant usable';
  END IF;
END
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_aal2 jsonb := jsonb_build_object(
    'role','authenticated','sub',current_setting('td.user_a'),
    'session_id',current_setting('td.session_register'),'aal','aal2',
    'amr',jsonb_build_array(jsonb_build_object(
      'method','totp','timestamp',extract(epoch FROM clock_timestamp())::bigint)));
  v_aal1 jsonb := jsonb_build_object(
    'role','authenticated','sub',current_setting('td.user_a'),
    'session_id',current_setting('td.session_redeem'),'aal','aal1',
    'amr',jsonb_build_array(jsonb_build_object('method','password')));
  v_result jsonb;
BEGIN
  v_result := public.trusted_device_command('register',v_aal2,
    p_new_token_hash => repeat('d',64));
  IF v_result->>'allowed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Final device registration failed: %',v_result;
  END IF;
  v_result := public.trusted_device_command('redeem',v_aal1,
    p_token_hash => repeat('d',64));
  IF v_result->>'allowed' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Final session grant failed: %',v_result;
  END IF;
END
$test$;

RESET ROLE;
UPDATE auth.sessions SET not_after = now() - interval '1 second'
WHERE id = current_setting('td.session_redeem')::uuid;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SET LOCAL ROLE service_role;
DO $test$
DECLARE v_result jsonb;
BEGIN
  v_result := public.trusted_device_command('status',jsonb_build_object(
    'role','authenticated','sub',current_setting('td.user_a'),
    'session_id',current_setting('td.session_redeem'),'aal','aal1'),
    p_token_hash => repeat('d',64));
  IF v_result->>'reason' IS DISTINCT FROM 'invalid_session' THEN
    RAISE EXCEPTION 'Expired auth.sessions row accepted: %',v_result;
  END IF;
END
$test$;

RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','authenticated','sub',current_setting('td.user_a'),
  'session_id',current_setting('td.session_redeem'),'aal','aal1'
)::text,true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
  IF public.get_session_mfa_status()->>'satisfied' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'Expired auth.sessions row passed UI status';
  END IF;
END
$test$;

RESET ROLE;
ROLLBACK;
SELECT count(*) AS fixture_residues
FROM auth.users WHERE email LIKE 'zz-trust-%@example.invalid';
