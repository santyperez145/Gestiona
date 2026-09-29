-- Verificacion reversible del consentimiento, moderacion y alta desde directorio.
BEGIN;

DO $verify$
DECLARE
  v_creator uuid; v_admin uuid; v_email text; v_source_org uuid:=gen_random_uuid();
  v_brand_org uuid:=gen_random_uuid(); v_source_influencer uuid:=gen_random_uuid();
  v_payload jsonb; v_added uuid; v_count integer;
BEGIN
  SELECT user_id INTO v_creator FROM public.memberships WHERE role='owner' ORDER BY joined_at LIMIT 1;
  SELECT user_id INTO v_admin FROM public.platform_admins WHERE role='superadmin' LIMIT 1;
  SELECT email INTO v_email FROM auth.users WHERE id=v_creator;
  ASSERT v_creator IS NOT NULL AND v_admin IS NOT NULL AND v_email IS NOT NULL, 'requires creator candidate and superadmin';

  INSERT INTO public.organizations(id,name,slug,owner_user_id) VALUES
    (v_source_org,'ZZ Creator source','zz-creator-source-'||v_source_org,v_creator),
    (v_brand_org,'ZZ Creator brand','zz-creator-brand-'||v_brand_org,v_creator);
  INSERT INTO public.memberships(org_id,user_id,role) VALUES(v_source_org,v_creator,'owner'),(v_brand_org,v_creator,'owner');
  INSERT INTO public.creator_accounts(user_id,email,display_name,bio,onboarding_completed)
  VALUES(v_creator,v_email,'ZZ Creadora','Contenido de prueba para marcas.',true)
  ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,bio=EXCLUDED.bio;
  INSERT INTO public.influencers(id,org_id,user_id,name,email,referral_code,status)
  VALUES(v_source_influencer,v_source_org,v_creator,'ZZ Creadora',v_email,'zz-source-'||substr(v_source_influencer::text,1,8),'activo');

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_creator,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM public.creator_update_public_profile('zz-creadora-publica',true,true,'Tecnologia','Cordoba','AR',25000);
  RESET ROLE;
  SET LOCAL ROLE anon;
  v_payload:=public.get_influencer_public_profile('zz-creadora-publica');
  RESET ROLE;
  ASSERT v_payload IS NULL, 'un perfil pendiente se hizo publico';

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM public.platform_moderate_creator_profile(v_creator,'approved',NULL);
  RESET ROLE;

  SET LOCAL ROLE anon;
  v_payload:=public.get_influencer_public_profile('zz-creadora-publica');
  RESET ROLE;
  ASSERT v_payload->>'name'='ZZ Creadora', 'el perfil aprobado no se publico';
  ASSERT NOT (v_payload ? 'email') AND NOT (v_payload ? 'user_id') AND NOT (v_payload ? 'id'), 'el perfil publico filtro identidad privada';
  ASSERT public.get_influencer_public_profile(v_creator::text) IS NULL, 'el UUID interno sigue siendo un token publico';

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_creator,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT public.creator_directory_add_to_org(v_brand_org,'zz-creadora-publica') INTO v_added;
  ASSERT v_added IS NOT NULL, 'la marca no pudo agregar el perfil';
  PERFORM public.creator_directory_add_to_org(v_brand_org,'zz-creadora-publica');
  RESET ROLE;
  SELECT count(*) INTO v_count FROM public.influencers WHERE org_id=v_brand_org AND lower(email)=lower(v_email);
  ASSERT v_count=1, 'reintentar duplico al creador en la marca';
  RAISE NOTICE 'PASS: consent, moderation, privacy, discovery and idempotent add';
END
$verify$;

ROLLBACK;
SELECT count(*) AS remaining_test_organizations FROM public.organizations WHERE name LIKE 'ZZ Creator %';
