-- Completa reputacion publica con hechos verificables: colaboraciones,
-- puntualidad y publicaciones verificadas.

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
  ), delivery AS (
    SELECT CASE WHEN count(*) FILTER(WHERE deliverable.delivery_date IS NOT NULL AND deliverable.due_date IS NOT NULL)=0 THEN NULL
      ELSE round(100.0*count(*) FILTER(WHERE deliverable.delivery_date<=deliverable.due_date)
        /count(*) FILTER(WHERE deliverable.delivery_date IS NOT NULL AND deliverable.due_date IS NOT NULL),1) END on_time_rate
    FROM public.influencer_deliverables deliverable
    WHERE deliverable.status='completado' AND deliverable.influencer_id IN (SELECT id FROM linked)
  ), publications AS (
    SELECT count(DISTINCT proof.id) verified_publications
    FROM public.influencer_publication_proofs proof
    WHERE proof.verified_by IS NOT NULL AND proof.influencer_id IN (SELECT id FROM linked)
  )
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'slug',a.public_slug,'name',a.display_name,'avatar_url',a.avatar_url,'bio',a.bio,
    'instagram',a.instagram,'tiktok',a.tiktok,'youtube',a.youtube,
    'category',a.category,'city',a.city,'country_code',a.country_code,'rate_from_ars',a.rate_from_ars,
    'identity_verified',a.identity_status='verified','followers',p.followers,
    'engagement_rate',p.engagement_rate,'metrics_verified',p.last_verified_at IS NOT NULL,
    'last_verified_at',p.last_verified_at,'rating',r.rating,'reviews_count',r.reviews_count,
    'completed_campaigns',c.completed,'collaborations_count',c.completed,
    'on_time_rate',d.on_time_rate,'verified_publications',publication.verified_publications
  )) FROM account a CROSS JOIN reputation r CROSS JOIN performance p CROSS JOIN collaborations c
    CROSS JOIN delivery d CROSS JOIN publications publication;
$fn$;

DROP FUNCTION IF EXISTS public.creator_discovery_search(uuid,text,text);
CREATE FUNCTION public.creator_discovery_search(p_org_id uuid,p_query text DEFAULT NULL,p_category text DEFAULT NULL)
RETURNS TABLE(slug text,name text,avatar_url text,bio text,instagram text,tiktok text,youtube text,
  category text,city text,country_code text,rate_from_ars numeric,identity_verified boolean,
  followers numeric,engagement_rate numeric,metrics_verified boolean,rating numeric,reviews_count bigint,
  completed_campaigns bigint,collaborations_count bigint,on_time_rate numeric,verified_publications bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
  SELECT payload->>'slug',payload->>'name',payload->>'avatar_url',payload->>'bio',payload->>'instagram',payload->>'tiktok',payload->>'youtube',
    payload->>'category',payload->>'city',payload->>'country_code',(payload->>'rate_from_ars')::numeric,
    COALESCE((payload->>'identity_verified')::boolean,false),(payload->>'followers')::numeric,
    (payload->>'engagement_rate')::numeric,COALESCE((payload->>'metrics_verified')::boolean,false),
    (payload->>'rating')::numeric,COALESCE((payload->>'reviews_count')::bigint,0),
    COALESCE((payload->>'completed_campaigns')::bigint,0),COALESCE((payload->>'collaborations_count')::bigint,0),
    (payload->>'on_time_rate')::numeric,COALESCE((payload->>'verified_publications')::bigint,0)
  FROM public.creator_accounts account
  CROSS JOIN LATERAL public.creator_public_profile_payload(account.public_slug) payload
  WHERE public.can_manage_influencers(p_org_id,'view') AND account.discoverable
    AND account.profile_public AND account.moderation_status='approved'
    AND (p_query IS NULL OR account.display_name ILIKE '%'||p_query||'%' OR account.bio ILIKE '%'||p_query||'%')
    AND (p_category IS NULL OR account.category=p_category)
  ORDER BY COALESCE((payload->>'followers')::numeric,0) DESC,account.display_name;
$fn$;

REVOKE ALL ON FUNCTION public.creator_public_profile_payload(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.creator_discovery_search(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.creator_discovery_search(uuid,text,text) TO authenticated;

UPDATE public.security_function_contracts contract SET definition_hash=md5(pg_get_functiondef(procedure.oid)),reviewed_on=DATE '2026-09-29'
FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
WHERE namespace.nspname='public' AND procedure.proname=contract.function_name
  AND pg_get_function_identity_arguments(procedure.oid)=contract.identity_arguments
  AND contract.function_name IN ('creator_public_profile_payload','creator_discovery_search');
