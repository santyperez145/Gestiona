-- Serialize token creation without deleting links from previously sent emails.
CREATE OR REPLACE FUNCTION public.drip_unsubscribe_token(p_enrollment_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enrollment public.drip_enrollments%ROWTYPE;
  v_token public.drip_unsubscribe_tokens%ROWTYPE;
BEGIN
  SELECT * INTO v_enrollment FROM public.drip_enrollments
  WHERE id = p_enrollment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Suscripción no encontrada';
  END IF;
  IF NULLIF(btrim(v_enrollment.customer_email), '') IS NULL THEN
    RAISE EXCEPTION 'La suscripción no tiene email';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.drip_sequences
    WHERE id = v_enrollment.sequence_id AND org_id = v_enrollment.org_id) THEN
    RAISE EXCEPTION 'La secuencia no pertenece a la organización';
  END IF;

  SELECT * INTO v_token FROM public.drip_unsubscribe_tokens
  WHERE enrollment_id = v_enrollment.id AND org_id = v_enrollment.org_id
    AND lower(btrim(customer_email)) = lower(btrim(v_enrollment.customer_email))
  ORDER BY created_at DESC, id DESC LIMIT 1;

  IF v_token.id IS NOT NULL THEN
    UPDATE public.drip_unsubscribe_tokens
    SET expires_at = GREATEST(expires_at, now() + interval '90 days')
    WHERE id = v_token.id;
    RETURN v_token.token;
  END IF;

  INSERT INTO public.drip_unsubscribe_tokens (token, enrollment_id, org_id, customer_email)
  VALUES (encode(extensions.gen_random_bytes(16), 'hex'), v_enrollment.id,
    v_enrollment.org_id, lower(btrim(v_enrollment.customer_email)))
  RETURNING * INTO v_token;
  RETURN v_token.token;
END;
$$;

REVOKE ALL ON FUNCTION public.drip_unsubscribe_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drip_unsubscribe_token(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
