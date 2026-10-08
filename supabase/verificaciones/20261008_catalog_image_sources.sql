BEGIN;
-- Only synthetic object rows below have no physical file; never delete real Storage rows through SQL.
SET LOCAL storage.allow_delete_query = 'true';
CREATE TEMP TABLE zz_image_context(org_id uuid, other_org uuid, owner_id uuid, other_user uuid, storage_path text);
DO $$
DECLARE o uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); u uuid; u2 uuid; path text;
BEGIN
  SELECT user_id INTO u FROM public.memberships WHERE role='owner' ORDER BY created_at LIMIT 1;
  SELECT id INTO u2 FROM auth.users WHERE id<>u ORDER BY created_at LIMIT 1;
  ASSERT u IS NOT NULL AND u2 IS NOT NULL;
  INSERT INTO public.organizations(id,name,slug,owner_user_id) VALUES
    (o,'ZZ Image provenance','zz-image-'||o,u),(o2,'ZZ Image other','zz-image-'||o2,u2);
  INSERT INTO public.memberships(org_id,user_id,role) VALUES(o,u,'owner'),(o2,u2,'owner');
  DELETE FROM public.role_permissions WHERE org_id IN (o,o2) AND module='products';
  path := o::text||'/catalog/'||gen_random_uuid()||'.webp';
  INSERT INTO public.catalog_image_sources(org_id,provider_id,source_url,license,license_url,provenance,storage_path,sha256,width,height,byte_size,reviewed_by)
    VALUES(o,gen_random_uuid(),'https://commons.wikimedia.org/ZZ','cc0','https://creativecommons.org/publicdomain/zero/1.0/',
      '{"fixture":true}',path,repeat('a',64),800,600,2000,u);
  INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('product-images',path,u::text);
  INSERT INTO zz_image_context VALUES(o,o2,u,u2,path);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
END $$;
GRANT SELECT ON zz_image_context TO authenticated,anon;
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; c record; BEGIN
  SELECT * INTO c FROM zz_image_context;
  ASSERT (SELECT count(*) FROM public.catalog_image_sources WHERE org_id=c.org_id)=1, 'Own provenance unreadable';
  BEGIN
    INSERT INTO public.catalog_image_sources(org_id,provider_id,source_url,license,license_url,provenance,storage_path,sha256,width,height,byte_size)
      VALUES(c.org_id,gen_random_uuid(),'https://example.org','cc0','https://example.org','{}',c.org_id||'/catalog/forged.webp',repeat('b',64),800,600,1);
    RAISE EXCEPTION 'Browser forged provenance';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('product-images',c.org_id||'/catalog/forged.webp',c.owner_id::text);
    RAISE EXCEPTION 'Browser uploaded into reserved path';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE storage.objects SET metadata='{"forged":true}' WHERE bucket_id='product-images' AND name=c.storage_path;
  GET DIAGNOSTICS n=ROW_COUNT; ASSERT n=0, 'Browser updated service image';
  DELETE FROM storage.objects WHERE bucket_id='product-images' AND name=c.storage_path;
  GET DIAGNOSTICS n=ROW_COUNT; ASSERT n=0, 'Browser deleted service image';
  INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('product-images',c.owner_id||'/zz-manual.webp',c.owner_id::text);
  DELETE FROM storage.objects WHERE bucket_id='product-images' AND name=c.owner_id||'/zz-manual.webp';
  GET DIAGNOSTICS n=ROW_COUNT; ASSERT n=1, 'Manual upload/delete changed';
END $$;
RESET ROLE;
INSERT INTO public.role_permissions(org_id,role,module,can_view,can_create,can_edit,can_delete,can_export)
  SELECT org_id,'admin','products',false,false,false,false,false FROM zz_image_context;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.catalog_image_sources WHERE org_id=(SELECT org_id FROM zz_image_context))=0, 'Permission override ignored';
END $$;
RESET ROLE;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_user,'role','authenticated')::text,true) FROM zz_image_context;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.catalog_image_sources WHERE org_id=(SELECT org_id FROM zz_image_context))=0, 'Cross tenant provenance leaked';
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM * FROM public.catalog_image_sources; RAISE EXCEPTION 'Anon read provenance';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DELETE FROM storage.objects WHERE name IN (SELECT storage_path FROM zz_image_context);
DELETE FROM public.organizations WHERE id IN (SELECT org_id FROM zz_image_context UNION SELECT other_org FROM zz_image_context);
SELECT count(*) AS zz_residue FROM public.catalog_image_sources WHERE org_id IN (SELECT org_id FROM zz_image_context UNION SELECT other_org FROM zz_image_context);
ROLLBACK;
