-- pgcrypto vive en extensions en el proyecto enlazado. Sin calificarlo, la
-- invitación compila pero falla al ejecutarse.
CREATE OR REPLACE FUNCTION public.create_influencer_invitation(
  p_org_id uuid,
  p_influencer_id uuid,
  p_campaign_id uuid,
  p_days integer DEFAULT 14
)
RETURNS public.influencer_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.influencer_invitations;
BEGIN
  IF NOT public.can_manage_influencers(p_org_id, 'create') THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF p_influencer_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.influencers i
    WHERE i.id = p_influencer_id AND i.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'invalid_influencer' USING ERRCODE = '22023';
  END IF;
  IF p_campaign_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.influencer_campaigns c
    WHERE c.id = p_campaign_id AND c.org_id = p_org_id
  ) THEN
    RAISE EXCEPTION 'invalid_campaign' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.influencer_invitations (
    org_id, campaign_id, influencer_id, token, created_by
  ) VALUES (
    p_org_id, p_campaign_id, p_influencer_id,
    encode(extensions.gen_random_bytes(24), 'hex'), auth.uid()
  )
  ON CONFLICT (org_id, influencer_id, campaign_id) DO UPDATE
    SET token = encode(extensions.gen_random_bytes(24), 'hex'),
        status = CASE
          WHEN influencer_invitations.status IN ('declined', 'expired') THEN 'pending'
          ELSE influencer_invitations.status
        END,
        expires_at = now() + make_interval(days => GREATEST(COALESCE(p_days, 14), 1)),
        responded_at = NULL
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$fn$;

UPDATE public.security_function_contracts c
SET definition_hash = md5(pg_get_functiondef(p.oid)),
    reviewed_on = DATE '2026-09-25'
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'create_influencer_invitation'
  AND c.function_name = p.proname
  AND pg_get_function_identity_arguments(p.oid) = c.identity_arguments;
