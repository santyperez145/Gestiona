-- Trusted devices are an opt-in exception to the interactive TOTP prompt, not
-- an AAL2 assertion. A password-authenticated, live auth.sessions row and a
-- separate 256-bit device credential are both required to create a grant.
-- This migration deliberately does not alter tenant RLS or auth hooks.

CREATE SCHEMA IF NOT EXISTS nerqia_auth;
REVOKE ALL ON SCHEMA nerqia_auth FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS nerqia_auth.trusted_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  security_fingerprint text NOT NULL CHECK (security_fingerprint ~ '^[0-9a-f]{64}$'),
  label text NOT NULL DEFAULT 'Dispositivo',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT trusted_devices_label_length CHECK (char_length(label) BETWEEN 1 AND 80),
  CONSTRAINT trusted_devices_expiry_order CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS trusted_devices_user_active_idx
  ON nerqia_auth.trusted_devices (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS nerqia_auth.trusted_session_grants (
  session_id uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES nerqia_auth.trusted_devices(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS trusted_session_grants_device_idx
  ON nerqia_auth.trusted_session_grants (device_id, expires_at DESC);

ALTER TABLE nerqia_auth.trusted_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE nerqia_auth.trusted_session_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE nerqia_auth.trusted_devices, nerqia_auth.trusted_session_grants
  FROM PUBLIC, anon, authenticated, service_role;

-- Never disclose this fingerprint to a browser or a service response. Factor
-- updated_at is intentionally excluded: a normal challenge can modify it.
CREATE OR REPLACE FUNCTION nerqia_auth.trusted_device_security_fingerprint(p_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT encode(extensions.digest(convert_to(
    jsonb_build_object(
      'user_id', u.id,
      'email', u.email,
      'password', u.encrypted_password,
      'factors', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', f.id,
          'type', f.factor_type,
          'status', f.status,
          'created_at', extract(epoch FROM f.created_at)
        ) ORDER BY f.id)
        FROM auth.mfa_factors f
        WHERE f.user_id = u.id AND f.status = 'verified'
      ), '[]'::jsonb)
    )::text, 'UTF8'
  ), 'sha256'), 'hex')
  FROM auth.users u WHERE u.id = p_user_id
$function$;
REVOKE ALL ON FUNCTION nerqia_auth.trusted_device_security_fingerprint(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION nerqia_auth.trusted_claim_has_method(
  p_claims jsonb, p_method text, p_recent_seconds integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_claims->'amr') = 'array'
        THEN p_claims->'amr' ELSE '[]'::jsonb END
    ) entry
    WHERE entry->>'method' = p_method
      AND CASE WHEN p_recent_seconds IS NULL THEN true
        WHEN entry->>'timestamp' ~ '^[0-9]{9,11}$' THEN
          (entry->>'timestamp')::numeric BETWEEN
            extract(epoch FROM clock_timestamp()) - p_recent_seconds
            AND extract(epoch FROM clock_timestamp()) + 30
        ELSE false END
  )
$function$;
REVOKE ALL ON FUNCTION nerqia_auth.trusted_claim_has_method(jsonb,text,integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- The Edge Function passes claims from a JWT it has validated with Auth.
-- PostgREST's service key is the only executor of this command. SQL performs
-- an independent subject/session/AMR check before making any grant.
CREATE OR REPLACE FUNCTION public.trusted_device_command(
  p_action text,
  p_claims jsonb,
  p_token_hash text DEFAULT NULL,
  p_new_token_hash text DEFAULT NULL,
  p_device_id uuid DEFAULT NULL,
  p_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_user_id uuid;
  v_session_id uuid;
  v_fingerprint text;
  v_device nerqia_auth.trusted_devices%ROWTYPE;
  v_grant nerqia_auth.trusted_session_grants%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_aal2 boolean;
  v_current_grant boolean := false;
  v_label text;
  v_devices jsonb;
  v_current_device_id uuid;
  v_target_device_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'trusted_device_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('register','redeem','status','list','revoke','revoke_all')
    OR jsonb_typeof(p_claims) IS DISTINCT FROM 'object'
    OR p_claims->>'role' IS DISTINCT FROM 'authenticated'
    OR coalesce(p_claims->>'sub','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR coalesce(p_claims->>'session_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_session');
  END IF;
  v_user_id := (p_claims->>'sub')::uuid;
  v_session_id := (p_claims->>'session_id')::uuid;
  IF NOT EXISTS (
    SELECT 1 FROM auth.sessions s
    WHERE s.id = v_session_id AND s.user_id = v_user_id
      AND (s.not_after IS NULL OR s.not_after > v_now)
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_session');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.mfa_factors f
    WHERE f.user_id = v_user_id AND f.status = 'verified'
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'mfa_not_enrolled');
  END IF;
  v_fingerprint := nerqia_auth.trusted_device_security_fingerprint(v_user_id);
  IF v_fingerprint IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_session');
  END IF;
  v_aal2 := coalesce(p_claims->>'aal' = 'aal2', false);
  SELECT g.* INTO v_grant
  FROM nerqia_auth.trusted_session_grants g
  JOIN nerqia_auth.trusted_devices d ON d.id = g.device_id AND d.user_id = g.user_id
  WHERE g.session_id = v_session_id AND g.user_id = v_user_id
    AND g.expires_at > v_now AND d.expires_at > v_now AND d.revoked_at IS NULL
    AND d.security_fingerprint = v_fingerprint;
  v_current_grant := FOUND;

  IF p_action = 'register' THEN
    IF NOT v_aal2 OR NOT (
      nerqia_auth.trusted_claim_has_method(p_claims,'totp',300)
      OR nerqia_auth.trusted_claim_has_method(p_claims,'mfa/totp',300)
    ) OR NOT EXISTS (
      SELECT 1 FROM auth.mfa_factors f
      WHERE f.user_id = v_user_id AND f.factor_type = 'totp' AND f.status = 'verified'
    ) THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'fresh_mfa_required');
    END IF;
    IF p_new_token_hash IS NULL OR p_new_token_hash !~ '^[0-9a-f]{64}$' THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_credential');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 812013));
    v_label := left(coalesce(nullif(btrim(p_label),''),'Dispositivo'), 80);
    IF (SELECT count(*) FROM nerqia_auth.trusted_devices d
      WHERE d.user_id = v_user_id AND d.revoked_at IS NULL AND d.expires_at > v_now
        AND (p_token_hash IS NULL OR d.token_hash <> p_token_hash)) >= 20 THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'device_limit_reached');
    END IF;
    -- Re-registering the current browser replaces its old cookie, if present.
    IF p_token_hash ~ '^[0-9a-f]{64}$' THEN
      UPDATE nerqia_auth.trusted_devices d SET revoked_at = v_now
      WHERE d.user_id = v_user_id AND d.token_hash = p_token_hash
        AND d.revoked_at IS NULL;
    END IF;
    INSERT INTO nerqia_auth.trusted_devices (
      user_id, token_hash, security_fingerprint, label, created_at, expires_at
    ) VALUES (
      v_user_id, p_new_token_hash, v_fingerprint, v_label, v_now,
      v_now + interval '7 days'
    ) RETURNING * INTO v_device;
    RETURN jsonb_build_object(
      'allowed', true, 'device_id', v_device.id,
      'expires_at', v_device.expires_at
    );
  END IF;

  IF p_action = 'redeem' THEN
    -- A remembered browser never turns an OAuth/magic-link login into MFA.
    IF NOT nerqia_auth.trusted_claim_has_method(p_claims,'password') THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'password_login_required');
    END IF;
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_credential');
    END IF;
    SELECT d.* INTO v_device FROM nerqia_auth.trusted_devices d
    WHERE d.user_id = v_user_id AND d.token_hash = p_token_hash
      AND d.revoked_at IS NULL AND d.expires_at > v_now
      AND d.security_fingerprint = v_fingerprint
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'device_not_trusted');
    END IF;
    INSERT INTO nerqia_auth.trusted_session_grants (
      session_id, user_id, device_id, created_at, expires_at
    ) VALUES (
      v_session_id, v_user_id, v_device.id, v_now, v_device.expires_at
    ) ON CONFLICT (session_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      device_id = EXCLUDED.device_id,
      created_at = EXCLUDED.created_at,
      expires_at = EXCLUDED.expires_at;
    UPDATE nerqia_auth.trusted_devices SET last_used_at = v_now
    WHERE id = v_device.id;
    RETURN jsonb_build_object(
      'allowed', true, 'device_id', v_device.id,
      'expires_at', v_device.expires_at
    );
  END IF;

  IF p_action = 'status' THEN
    -- The service status requires possession of the cookie as well as the
    -- session grant; the public UI helper below only reads the grant.
    v_current_grant := v_current_grant AND coalesce(p_token_hash ~ '^[0-9a-f]{64}$',false)
      AND EXISTS (SELECT 1 FROM nerqia_auth.trusted_devices d
        WHERE d.id = v_grant.device_id AND d.token_hash = p_token_hash);
    RETURN jsonb_build_object(
      'allowed', v_current_grant,
      'expires_at', CASE WHEN v_current_grant THEN v_grant.expires_at ELSE NULL END
    );
  END IF;

  IF NOT (v_aal2 OR v_current_grant) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'mfa_required');
  END IF;
  IF p_action = 'list' THEN
    IF coalesce(p_token_hash ~ '^[0-9a-f]{64}$', false) THEN
      SELECT d.id INTO v_current_device_id FROM nerqia_auth.trusted_devices d
      WHERE d.user_id = v_user_id AND d.token_hash = p_token_hash
        AND d.revoked_at IS NULL AND d.expires_at > v_now
        AND d.security_fingerprint = v_fingerprint;
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'label', x.label, 'created_at', x.created_at,
      'last_used_at', x.last_used_at, 'expires_at', x.expires_at,
      'current', coalesce(x.id = v_current_device_id, false)
    ) ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_devices
    FROM (SELECT d.id,d.label,d.created_at,d.last_used_at,d.expires_at
      FROM nerqia_auth.trusted_devices d
      WHERE d.user_id = v_user_id AND d.revoked_at IS NULL AND d.expires_at > v_now
        AND d.security_fingerprint = v_fingerprint
      ORDER BY d.created_at DESC LIMIT 20) x;
    RETURN jsonb_build_object('allowed', v_current_device_id IS NOT NULL,
      'device_id', v_current_device_id,
      'expires_at', (SELECT d.expires_at FROM nerqia_auth.trusted_devices d
        WHERE d.id = v_current_device_id),
      'devices', v_devices);
  END IF;
  IF p_action = 'revoke' THEN
    v_target_device_id := p_device_id;
    IF v_target_device_id IS NULL AND coalesce(p_token_hash ~ '^[0-9a-f]{64}$', false) THEN
      SELECT d.id INTO v_target_device_id FROM nerqia_auth.trusted_devices d
      WHERE d.user_id = v_user_id AND d.token_hash = p_token_hash;
    END IF;
    IF v_target_device_id IS NULL AND p_token_hash IS NULL THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'device_required');
    END IF;
    UPDATE nerqia_auth.trusted_devices d SET revoked_at = v_now
    WHERE d.id = v_target_device_id AND d.user_id = v_user_id AND d.revoked_at IS NULL;
    RETURN jsonb_build_object('allowed', true, 'revoked', FOUND);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text, 812013));
  UPDATE nerqia_auth.trusted_devices d SET revoked_at = v_now
  WHERE d.user_id = v_user_id AND d.revoked_at IS NULL;
  RETURN jsonb_build_object('allowed', true, 'revoked', true);
END
$function$;
REVOKE ALL ON FUNCTION public.trusted_device_command(text,jsonb,text,text,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trusted_device_command(text,jsonb,text,text,uuid,text)
  TO service_role;

-- Authenticated UI status only; never an authority or a new AAL2 JWT. Reads
-- the current signed PostgREST JWT and live auth.sessions, not browser input.
CREATE OR REPLACE FUNCTION public.get_session_mfa_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  v_claims jsonb := auth.jwt();
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_verified boolean;
  v_required boolean;
  v_aal2 boolean;
  v_expires timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF coalesce(v_claims->>'session_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN jsonb_build_object('requires_mfa', true, 'satisfied', false, 'trusted_until', null);
  END IF;
  v_session_id := (v_claims->>'session_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM auth.sessions s
    WHERE s.id = v_session_id AND s.user_id = v_user_id
      AND (s.not_after IS NULL OR s.not_after > statement_timestamp())) THEN
    RETURN jsonb_build_object('requires_mfa', true, 'satisfied', false, 'trusted_until', null);
  END IF;
  SELECT EXISTS(SELECT 1 FROM auth.mfa_factors f
    WHERE f.user_id = v_user_id AND f.status = 'verified') INTO v_verified;
  v_required := v_verified OR public.is_platform_admin(v_user_id);
  v_aal2 := v_verified AND coalesce(v_claims->>'aal' = 'aal2', false);
  SELECT LEAST(g.expires_at, d.expires_at) INTO v_expires
  FROM nerqia_auth.trusted_session_grants g
  JOIN nerqia_auth.trusted_devices d ON d.id = g.device_id AND d.user_id = g.user_id
  WHERE g.session_id = v_session_id AND g.user_id = v_user_id
    AND g.expires_at > statement_timestamp() AND d.expires_at > statement_timestamp()
    AND d.revoked_at IS NULL
    AND d.security_fingerprint = nerqia_auth.trusted_device_security_fingerprint(v_user_id)
  LIMIT 1;
  RETURN jsonb_build_object(
    'requires_mfa', v_required,
    'satisfied', NOT v_required OR v_aal2 OR v_expires IS NOT NULL,
    'aal2', v_aal2,
    'trusted_until', v_expires
  );
END
$function$;
REVOKE ALL ON FUNCTION public.get_session_mfa_status()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_session_mfa_status() TO authenticated;

-- Explicitly register the only web-exposed SECURITY DEFINER function. The
-- service-only command is intentionally not part of the web audit surface.
INSERT INTO public.security_function_contracts (
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
VALUES (
  'get_session_mfa_status', '', 'authenticated_delegate',
  'Deriva usuario y sesion del JWT autenticado y valida la sesion vigente antes de exponer solo el estado MFA propio.',
  md5(pg_get_functiondef('public.get_session_mfa_status()'::regprocedure)),
  DATE '2026-10-04'
)
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;
