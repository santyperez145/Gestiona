-- Reversible fixtures only: never invokes a mail provider or prints personal data.
BEGIN;
CREATE TEMP TABLE zz_marketing_result (
  stable_token boolean, single_token boolean, eligible_before boolean,
  blocked_after_unsubscribe boolean, repeat_unsubscribe boolean,
  opted_out_duplicate_blocked boolean, tenant_isolated boolean
) ON COMMIT DROP;
GRANT SELECT, INSERT ON zz_marketing_result TO service_role;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_org uuid;
  v_user uuid;
  v_sequence uuid;
  v_enrollment uuid;
  v_customer uuid;
  v_token text;
  v_retry text;
  v_email text := 'zz-marketing-' || gen_random_uuid() || '@example.invalid';
  v_eligible boolean;
  v_duplicate_blocked boolean;
BEGIN
  SELECT org_id, user_id INTO v_org, v_user FROM public.memberships
  ORDER BY org_id, user_id LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'Se necesita una organización existente'; END IF;

  INSERT INTO public.customers (org_id, user_id, name, email, marketing_consent_at)
  VALUES (v_org, v_user, 'ZZ marketing verification', v_email, now()) RETURNING id INTO v_customer;
  v_eligible := public.marketing_email_eligible(v_org, upper(v_email));

  INSERT INTO public.customers (org_id, user_id, name, email, marketing_opt_out_at)
  VALUES (v_org, v_user, 'ZZ marketing duplicate', upper(v_email), now());
  v_duplicate_blocked := NOT public.marketing_email_eligible(v_org, v_email);
  DELETE FROM public.customers WHERE org_id = v_org AND name = 'ZZ marketing duplicate' AND email = upper(v_email);

  INSERT INTO public.drip_sequences (org_id, name, active)
  VALUES (v_org, 'ZZ marketing verification', false) RETURNING id INTO v_sequence;
  INSERT INTO public.drip_enrollments (sequence_id, org_id, customer_id, customer_email, status)
  VALUES (v_sequence, v_org, v_customer, v_email, 'paused') RETURNING id INTO v_enrollment;

  v_token := public.drip_unsubscribe_token(v_enrollment);
  v_retry := public.drip_unsubscribe_token(v_enrollment);
  IF v_token !~ '^[a-f0-9]{32}$' THEN RAISE EXCEPTION 'Token inválido'; END IF;
  IF NOT (public.process_drip_unsubscribe(v_token)->>'ok')::boolean THEN
    RAISE EXCEPTION 'La baja falló';
  END IF;

  INSERT INTO zz_marketing_result VALUES (
    v_token = v_retry,
    (SELECT count(*) = 1 FROM public.drip_unsubscribe_tokens WHERE enrollment_id = v_enrollment),
    v_eligible, NOT public.marketing_email_eligible(v_org, v_email),
    (public.process_drip_unsubscribe(v_token)->>'ok')::boolean,
    v_duplicate_blocked, NOT public.marketing_email_eligible(gen_random_uuid(), v_email)
  );
END;
$$;

SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.drip_unsubscribe_token(gen_random_uuid());
    RAISE EXCEPTION 'anon pudo emitir tokens';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.drip_unsubscribe_token(gen_random_uuid());
    RAISE EXCEPTION 'authenticated pudo emitir tokens';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SELECT * FROM zz_marketing_result;
ROLLBACK;
