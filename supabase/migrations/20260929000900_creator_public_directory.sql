-- Directorio publico de creadores con consentimiento, moderacion y minima
-- exposicion. Reemplaza el perfil legacy que filtraba email, UUID y datos no
-- verificados o inventados.

BEGIN;

ALTER TABLE public.creator_accounts
  ADD COLUMN IF NOT EXISTS public_slug text,
  ADD COLUMN IF NOT EXISTS profile_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'AR',
  ADD COLUMN IF NOT EXISTS rate_from_ars numeric(15,2),
  ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS moderation_notes text,
  ADD COLUMN IF NOT EXISTS moderated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moderated_at timestamptz,
  ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT 'unverified';

ALTER TABLE public.creator_accounts
  DROP CONSTRAINT IF EXISTS creator_accounts_public_slug_check,
  ADD CONSTRAINT creator_accounts_public_slug_check
    CHECK (public_slug IS NULL OR public_slug ~ '^[a-z0-9][a-z0-9-]{2,47}$'),
  DROP CONSTRAINT IF EXISTS creator_accounts_country_check,
  ADD CONSTRAINT creator_accounts_country_check CHECK (country_code ~ '^[A-Z]{2}$'),
  DROP CONSTRAINT IF EXISTS creator_accounts_rate_check,
  ADD CONSTRAINT creator_accounts_rate_check CHECK (rate_from_ars IS NULL OR rate_from_ars >= 0),
  DROP CONSTRAINT IF EXISTS creator_accounts_moderation_check,
  ADD CONSTRAINT creator_accounts_moderation_check CHECK (moderation_status IN ('draft','pending','approved','rejected')),
  DROP CONSTRAINT IF EXISTS creator_accounts_identity_check,
  ADD CONSTRAINT creator_accounts_identity_check CHECK (identity_status IN ('unverified','pending','verified','rejected'));

CREATE UNIQUE INDEX IF NOT EXISTS creator_accounts_public_slug_unique
  ON public.creator_accounts(lower(public_slug)) WHERE public_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS creator_accounts_discovery
  ON public.creator_accounts(moderation_status, discoverable, category)
  WHERE discoverable AND moderation_status='approved';

-- Las columnas de moderacion e identidad no se escriben desde PostgREST. Todo
-- cambio de perfil pasa por RPCs con lista blanca; la lectura propia se mantiene.
REVOKE INSERT, UPDATE ON public.creator_accounts FROM authenticated;

CREATE OR REPLACE FUNCTION public.creator_ensure_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_user auth.users; v_linked boolean;
BEGIN
  SELECT * INTO v_user FROM auth.users WHERE id=auth.uid();
  IF v_user.id IS NULL THEN RAISE EXCEPTION 'Inicia sesion para crear tu perfil' USING ERRCODE='42501'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.influencers influencer WHERE lower(influencer.email)=lower(v_user.email)) INTO v_linked;
  IF COALESCE(v_user.raw_user_meta_data->>'account_type','')<>'creator' AND NOT v_linked THEN
    RAISE EXCEPTION 'Esta cuenta no esta registrada como creador' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.creator_accounts(user_id,email) VALUES(v_user.id,v_user.email)
  ON CONFLICT(user_id) DO NOTHING;
END;
$fn$;

ALTER TABLE public.influencer_reviews
  ADD COLUMN IF NOT EXISTS public_consent boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.creator_publication_visibility (
  proof_id uuid PRIMARY KEY REFERENCES public.influencer_publication_proofs(id) ON DELETE CASCADE,
  creator_user_id uuid NOT NULL REFERENCES public.creator_accounts(user_id) ON DELETE CASCADE,
  visible boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.creator_publication_visibility ENABLE ROW LEVEL SECURITY;
CREATE POLICY creator_publication_visibility_self ON public.creator_publication_visibility
  FOR SELECT TO authenticated USING (creator_user_id=auth.uid());
REVOKE ALL ON public.creator_publication_visibility FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.creator_publication_visibility TO authenticated;

CREATE OR REPLACE FUNCTION public.creator_upsert_own_profile(
  p_display_name text, p_bio text, p_phone text, p_instagram text, p_tiktok text, p_youtube text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_email text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicia sesion para editar tu perfil' USING ERRCODE='42501'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id=auth.uid();
  INSERT INTO public.creator_accounts(user_id,email,display_name,bio,phone,instagram,tiktok,youtube,onboarding_completed)
  VALUES(auth.uid(),v_email,NULLIF(btrim(p_display_name),''),NULLIF(btrim(p_bio),''),NULLIF(btrim(p_phone),''),
    NULLIF(btrim(p_instagram),''),NULLIF(btrim(p_tiktok),''),NULLIF(btrim(p_youtube),''),true)
  ON CONFLICT(user_id) DO UPDATE SET
    display_name=EXCLUDED.display_name,bio=EXCLUDED.bio,phone=EXCLUDED.phone,
    instagram=EXCLUDED.instagram,tiktok=EXCLUDED.tiktok,youtube=EXCLUDED.youtube,
    onboarding_completed=true,
    moderation_status=CASE WHEN creator_accounts.profile_public OR creator_accounts.discoverable THEN 'pending' ELSE creator_accounts.moderation_status END,
    moderation_notes=CASE WHEN creator_accounts.profile_public OR creator_accounts.discoverable THEN NULL ELSE creator_accounts.moderation_notes END,
    updated_at=now();
END;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_update_public_profile(
  p_public_slug text, p_profile_public boolean, p_discoverable boolean,
  p_category text, p_city text, p_country_code text, p_rate_from_ars numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_row public.creator_accounts; v_slug text:=lower(btrim(COALESCE(p_public_slug,'')));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Inicia sesion para publicar tu perfil' USING ERRCODE='42501'; END IF;
  IF v_slug !~ '^[a-z0-9][a-z0-9-]{2,47}$' THEN
    RAISE EXCEPTION 'Usa un enlace de 3 a 48 caracteres, letras, numeros y guiones' USING ERRCODE='22023';
  END IF;
  IF COALESCE(p_profile_public,false) OR COALESCE(p_discoverable,false) THEN
    IF char_length(btrim(COALESCE(p_category,''))) < 2 THEN RAISE EXCEPTION 'Elegí una categoria para publicar' USING ERRCODE='22023'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.creator_accounts WHERE user_id=auth.uid() AND char_length(btrim(COALESCE(display_name,'')))>=2 AND char_length(btrim(COALESCE(bio,'')))>=10) THEN
      RAISE EXCEPTION 'Completa tu nombre y una bio de al menos 10 caracteres' USING ERRCODE='22023';
    END IF;
  END IF;
  UPDATE public.creator_accounts SET public_slug=v_slug,
    profile_public=COALESCE(p_profile_public,false), discoverable=COALESCE(p_discoverable,false),
    category=NULLIF(btrim(p_category),''), city=NULLIF(btrim(p_city),''),
    country_code=upper(COALESCE(NULLIF(btrim(p_country_code),''),'AR')),
    rate_from_ars=CASE WHEN p_rate_from_ars IS NULL OR p_rate_from_ars=0 THEN NULL ELSE round(p_rate_from_ars,2) END,
    moderation_status=CASE WHEN COALESCE(p_profile_public,false) OR COALESCE(p_discoverable,false) THEN 'pending' ELSE 'draft' END,
    moderation_notes=NULL, moderated_by=NULL, moderated_at=NULL, updated_at=now()
  WHERE user_id=auth.uid() RETURNING * INTO v_row;
  IF v_row.user_id IS NULL THEN RAISE EXCEPTION 'Primero completa tu perfil de creador' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('public_slug',v_row.public_slug,'profile_public',v_row.profile_public,
    'discoverable',v_row.discoverable,'moderation_status',v_row.moderation_status);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Ese enlace publico ya esta en uso' USING ERRCODE='23505';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_public_profile_payload(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  WITH account AS (
    SELECT ca.* FROM public.creator_accounts ca
    WHERE lower(ca.public_slug)=lower(btrim(p_slug)) AND ca.profile_public AND ca.moderation_status='approved'
  ), linked AS (
    SELECT i.* FROM public.influencers i JOIN account a ON lower(i.email)=lower(a.email)
  ), reputation AS (
    SELECT round(avg(r.rating)::numeric,1) rating, count(*) reviews_count
    FROM public.influencer_reviews r WHERE r.public_consent AND r.influencer_id IN (SELECT id FROM linked)
  ), performance AS (
    SELECT max(report.followers) followers,
      round(avg(report.engagement_rate) FILTER (WHERE report.engagement_rate IS NOT NULL),2) engagement_rate,
      max(report.reviewed_at) last_verified_at
    FROM public.influencer_social_metric_reports report
    WHERE report.status='verified' AND report.period_end>=CURRENT_DATE-INTERVAL '180 days'
      AND report.influencer_id IN (SELECT id FROM linked)
  ), collaborations AS (
    SELECT count(DISTINCT cc.campaign_id) FILTER (WHERE campaign.status IN ('completed','finalizada')) completed
    FROM public.influencer_campaign_creators cc
    JOIN public.influencer_campaigns campaign ON campaign.id=cc.campaign_id
    WHERE cc.influencer_id IN (SELECT id FROM linked)
  )
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'slug',a.public_slug,'name',a.display_name,'avatar_url',a.avatar_url,'bio',a.bio,
    'instagram',a.instagram,'tiktok',a.tiktok,'youtube',a.youtube,
    'category',a.category,'city',a.city,'country_code',a.country_code,'rate_from_ars',a.rate_from_ars,
    'identity_verified',a.identity_status='verified','followers',p.followers,
    'engagement_rate',p.engagement_rate,'metrics_verified',p.last_verified_at IS NOT NULL,
    'last_verified_at',p.last_verified_at,'rating',r.rating,'reviews_count',r.reviews_count,
    'completed_campaigns',c.completed
  )) FROM account a CROSS JOIN reputation r CROSS JOIN performance p CROSS JOIN collaborations c;
$fn$;

CREATE OR REPLACE FUNCTION public.get_influencer_public_profile(p_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT public.creator_public_profile_payload(p_token);
$fn$;

CREATE OR REPLACE FUNCTION public.get_influencer_public_reviews(p_token text)
RETURNS TABLE(id uuid,rating integer,comment text,created_at timestamptz,org_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT review.id,review.rating,review.comment,review.created_at,organization.name
  FROM public.creator_accounts account
  JOIN public.influencers influencer ON lower(influencer.email)=lower(account.email)
  JOIN public.influencer_reviews review ON review.influencer_id=influencer.id AND review.public_consent
  LEFT JOIN public.organizations organization ON organization.id=review.org_id
  WHERE lower(account.public_slug)=lower(btrim(p_token)) AND account.profile_public AND account.moderation_status='approved'
  ORDER BY review.created_at DESC LIMIT 20;
$fn$;

CREATE OR REPLACE FUNCTION public.get_influencer_public_portfolio(p_token text)
RETURNS TABLE(id uuid,description text,campaign_name text,content_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT proof.id,deliverable.description,campaign.title,proof.publication_url
  FROM public.creator_accounts account
  JOIN public.influencers influencer ON lower(influencer.email)=lower(account.email)
  JOIN public.influencer_publication_proofs proof ON proof.influencer_id=influencer.id AND proof.verified_by IS NOT NULL
  JOIN public.creator_publication_visibility visibility ON visibility.proof_id=proof.id AND visibility.creator_user_id=account.user_id AND visibility.visible
  JOIN public.influencer_deliverables deliverable ON deliverable.id=proof.deliverable_id
  LEFT JOIN public.influencer_campaigns campaign ON campaign.id=proof.campaign_id
  WHERE lower(account.public_slug)=lower(btrim(p_token)) AND account.profile_public AND account.moderation_status='approved'
  ORDER BY proof.created_at DESC LIMIT 12;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_discovery_search(p_org_id uuid,p_query text DEFAULT NULL,p_category text DEFAULT NULL)
RETURNS TABLE(slug text,name text,avatar_url text,bio text,instagram text,tiktok text,youtube text,
  category text,city text,country_code text,rate_from_ars numeric,identity_verified boolean,
  followers numeric,engagement_rate numeric,metrics_verified boolean,rating numeric,reviews_count bigint,completed_campaigns bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT payload->>'slug',payload->>'name',payload->>'avatar_url',payload->>'bio',payload->>'instagram',payload->>'tiktok',payload->>'youtube',
    payload->>'category',payload->>'city',payload->>'country_code',(payload->>'rate_from_ars')::numeric,
    COALESCE((payload->>'identity_verified')::boolean,false),(payload->>'followers')::numeric,
    (payload->>'engagement_rate')::numeric,COALESCE((payload->>'metrics_verified')::boolean,false),
    (payload->>'rating')::numeric,COALESCE((payload->>'reviews_count')::bigint,0),COALESCE((payload->>'completed_campaigns')::bigint,0)
  FROM public.creator_accounts account
  CROSS JOIN LATERAL public.creator_public_profile_payload(account.public_slug) payload
  WHERE public.can_manage_influencers(p_org_id,'view') AND account.discoverable
    AND account.profile_public AND account.moderation_status='approved'
    AND (p_query IS NULL OR account.display_name ILIKE '%'||p_query||'%' OR account.bio ILIKE '%'||p_query||'%')
    AND (p_category IS NULL OR account.category=p_category)
  ORDER BY COALESCE((payload->>'followers')::numeric,0) DESC,account.display_name;
$fn$;

CREATE OR REPLACE FUNCTION public.platform_creator_moderation_queue()
RETURNS TABLE(user_id uuid,display_name text,public_slug text,category text,city text,country_code text,
  profile_public boolean,discoverable boolean,moderation_status text,moderation_notes text,updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT account.user_id,account.display_name,account.public_slug,account.category,account.city,account.country_code,
    account.profile_public,account.discoverable,account.moderation_status,account.moderation_notes,account.updated_at
  FROM public.creator_accounts account
  WHERE public.has_platform_role(ARRAY['superadmin'],auth.uid())
    AND account.moderation_status IN ('pending','approved','rejected')
  ORDER BY CASE account.moderation_status WHEN 'pending' THEN 0 ELSE 1 END,account.updated_at;
$fn$;

CREATE OR REPLACE FUNCTION public.creator_directory_add_to_org(p_org_id uuid,p_slug text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE v_account public.creator_accounts; v_existing uuid; v_code text; v_followers_ig integer:=0; v_followers_tiktok integer:=0; v_engagement numeric:=0;
BEGIN
  IF NOT public.can_manage_influencers(p_org_id,'create') THEN RAISE EXCEPTION 'No tenes permiso para agregar creadores' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_account FROM public.creator_accounts WHERE lower(public_slug)=lower(btrim(p_slug))
    AND profile_public AND discoverable AND moderation_status='approved';
  IF v_account.user_id IS NULL THEN RAISE EXCEPTION 'El perfil ya no esta disponible' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||lower(v_account.email),0));
  SELECT id INTO v_existing FROM public.influencers WHERE org_id=p_org_id AND lower(email)=lower(v_account.email) ORDER BY created_at LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  SELECT COALESCE(max(report.followers) FILTER(WHERE report.platform='instagram'),0)::integer,
         COALESCE(max(report.followers) FILTER(WHERE report.platform='tiktok'),0)::integer,
         COALESCE(round(avg(report.engagement_rate) FILTER(WHERE report.engagement_rate IS NOT NULL),2),0)
    INTO v_followers_ig,v_followers_tiktok,v_engagement
  FROM public.influencer_social_metric_reports report
  JOIN public.influencers linked ON linked.id=report.influencer_id AND lower(linked.email)=lower(v_account.email)
  WHERE report.status='verified' AND report.period_end>=CURRENT_DATE-INTERVAL '180 days';
  v_code:=v_account.public_slug;
  IF EXISTS(SELECT 1 FROM public.influencers WHERE org_id=p_org_id AND referral_code=v_code) THEN
    v_code:=left(v_code,38)||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,6);
  END IF;
  INSERT INTO public.influencers(org_id,user_id,name,instagram,tiktok,email,followers_ig,followers_tiktok,
    engagement_rate,referral_code,status,avatar_url,notes)
  VALUES(p_org_id,auth.uid(),v_account.display_name,v_account.instagram,v_account.tiktok,v_account.email,
    v_followers_ig,v_followers_tiktok,v_engagement,v_code,'activo',v_account.avatar_url,
    'Agregado desde el directorio público de Nerqia') RETURNING id INTO v_existing;
  RETURN v_existing;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.platform_moderate_creator_profile(p_user_id uuid,p_decision text,p_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
  IF NOT public.has_platform_role(ARRAY['superadmin'],auth.uid()) THEN RAISE EXCEPTION 'Solo superadmin puede moderar perfiles' USING ERRCODE='42501'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Decision invalida' USING ERRCODE='22023'; END IF;
  IF p_decision='rejected' AND char_length(btrim(COALESCE(p_notes,'')))<3 THEN RAISE EXCEPTION 'Explica el motivo del rechazo' USING ERRCODE='22023'; END IF;
  UPDATE public.creator_accounts SET moderation_status=p_decision,moderation_notes=NULLIF(btrim(p_notes),''),
    moderated_by=auth.uid(),moderated_at=now(),updated_at=now() WHERE user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Perfil no encontrado' USING ERRCODE='P0002'; END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.creator_update_public_profile(text,boolean,boolean,text,text,text,numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.creator_ensure_account() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.creator_public_profile_payload(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_influencer_public_profile(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_influencer_public_reviews(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_influencer_public_portfolio(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.creator_discovery_search(uuid,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_creator_moderation_queue() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.platform_moderate_creator_profile(uuid,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.creator_directory_add_to_org(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_update_public_profile(text,boolean,boolean,text,text,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_ensure_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_influencer_public_profile(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_influencer_public_reviews(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_influencer_public_portfolio(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.creator_discovery_search(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_creator_moderation_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_moderate_creator_profile(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creator_directory_add_to_org(uuid,text) TO authenticated;

INSERT INTO public.security_function_contracts(function_name,identity_arguments,audience,rationale,definition_hash,reviewed_on)
SELECT contract.function_name,contract.identity_arguments,contract.audience,contract.rationale,
  md5(pg_get_functiondef(procedure.oid)),DATE '2026-09-29'
FROM (VALUES
 ('creator_update_public_profile','p_public_slug text, p_profile_public boolean, p_discoverable boolean, p_category text, p_city text, p_country_code text, p_rate_from_ars numeric','authenticated_delegate','El creador controla publicacion y descubrimiento de su propio perfil.'),
 ('creator_ensure_account','','authenticated_delegate','Crea la cuenta de creador solo para signup creator o email previamente invitado.'),
 ('creator_upsert_own_profile','p_display_name text, p_bio text, p_phone text, p_instagram text, p_tiktok text, p_youtube text','authenticated_delegate','El creador edita su perfil privado y los cambios reabren moderacion publica.'),
 ('creator_public_profile_payload','p_slug text','security_helper','Helper privado que proyecta exclusivamente datos publicos consentidos y moderados.'),
 ('get_influencer_public_profile','p_token text','public_token','Devuelve solo un perfil consentido y moderado por slug publico.'),
 ('get_influencer_public_reviews','p_token text','public_token','Publica solo resenas con consentimiento explicito.'),
 ('get_influencer_public_portfolio','p_token text','public_token','Publica solo pruebas verificadas elegidas por el creador.'),
 ('creator_discovery_search','p_org_id uuid, p_query text, p_category text','authenticated_delegate','Directorio moderado para marcas con permiso de Influencers.'),
 ('creator_directory_add_to_org','p_org_id uuid, p_slug text','authenticated_delegate','Agrega a la red de una marca un perfil publico moderado sin duplicarlo por email.'),
 ('platform_creator_moderation_queue','','authenticated_delegate','Cola transversal con autorizacion interna exclusiva para superadmin.'),
 ('platform_moderate_creator_profile','p_user_id uuid, p_decision text, p_notes text','authenticated_delegate','Superadmin aprueba o rechaza perfiles publicos con traza.')
) contract(function_name,identity_arguments,audience,rationale)
JOIN pg_proc procedure ON procedure.proname=contract.function_name
JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace AND namespace.nspname='public'
WHERE pg_get_function_identity_arguments(procedure.oid)=contract.identity_arguments
ON CONFLICT(function_name,identity_arguments) DO UPDATE SET audience=EXCLUDED.audience,rationale=EXCLUDED.rationale,
  definition_hash=EXCLUDED.definition_hash,reviewed_on=EXCLUDED.reviewed_on;

COMMIT;
