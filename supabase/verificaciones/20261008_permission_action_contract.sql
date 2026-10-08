BEGIN;
CREATE TEMP TABLE zz_permission_context(org_id uuid, other_org uuid, owner_id uuid, member_id uuid);
DO $$
DECLARE o uuid := gen_random_uuid(); other_o uuid := gen_random_uuid(); owner_u uuid; member_u uuid;
BEGIN
  SELECT user_id INTO owner_u FROM public.memberships WHERE role = 'owner' ORDER BY created_at LIMIT 1;
  SELECT id INTO member_u FROM auth.users WHERE id <> owner_u ORDER BY created_at LIMIT 1;
  ASSERT owner_u IS NOT NULL AND member_u IS NOT NULL, 'Two existing identities required';
  INSERT INTO public.organizations(id,name,slug,owner_user_id)
    VALUES(o,'ZZ Permission contract','zz-permission-'||o,owner_u),
      (other_o,'ZZ Permission other','zz-permission-'||other_o,member_u);
  INSERT INTO public.memberships(org_id,user_id,role)
    VALUES(o,owner_u,'owner'),(o,member_u,'admin'),(other_o,member_u,'owner');
  DELETE FROM public.role_permissions WHERE org_id IN (o,other_o) AND module = 'products';
  INSERT INTO zz_permission_context VALUES(o,other_o,owner_u,member_u);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_u,'role','authenticated')::text,true);
END $$;
GRANT SELECT ON zz_permission_context TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE c record; action text; BEGIN
  SELECT * INTO c FROM zz_permission_context;
  FOREACH action IN ARRAY ARRAY['view','create','edit','delete','export'] LOOP
    ASSERT public.has_permission(c.org_id,'products',action), 'Owner default changed';
    ASSERT NOT public.has_permission(c.other_org,'products',action), 'Cross-tenant permission';
  END LOOP;
  FOREACH action IN ARRAY ARRAY['anything','VIEW','',NULL] LOOP
    ASSERT NOT public.has_permission(c.org_id,'products',action), 'Malformed action allowed';
  END LOOP;
  ASSERT NOT public.has_permission(NULL,'products','view');
  ASSERT NOT public.has_permission(c.org_id,NULL,'view');
  ASSERT NOT public.has_permission(c.org_id,' ','view');
END $$;
RESET ROLE;
INSERT INTO public.role_permissions(org_id,role,module,can_view,can_create,can_edit,can_delete,can_export)
  SELECT org_id,'admin','products',false,false,false,false,false FROM zz_permission_context;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT NOT public.has_permission((SELECT org_id FROM zz_permission_context),'products','view'), 'Owner override drift';
END $$;
RESET ROLE;
DELETE FROM public.role_permissions WHERE org_id = (SELECT org_id FROM zz_permission_context) AND module = 'products';
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated')::text,true) FROM zz_permission_context;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT public.has_permission((SELECT org_id FROM zz_permission_context),'products','delete'), 'Admin default changed';
  ASSERT NOT public.has_permission((SELECT org_id FROM zz_permission_context),'products','anything');
END $$;
RESET ROLE;
UPDATE public.memberships m SET role='vendedor' FROM zz_permission_context c WHERE m.org_id=c.org_id AND m.user_id=c.member_id;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT public.has_permission((SELECT org_id FROM zz_permission_context),'products','create');
  ASSERT NOT public.has_permission((SELECT org_id FROM zz_permission_context),'products','edit');
END $$;
RESET ROLE;
UPDATE public.memberships m SET role='viewer' FROM zz_permission_context c WHERE m.org_id=c.org_id AND m.user_id=c.member_id;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT public.has_permission((SELECT org_id FROM zz_permission_context),'products','view');
  ASSERT NOT public.has_permission((SELECT org_id FROM zz_permission_context),'products','create');
END $$;
RESET ROLE;
DO $$ BEGIN PERFORM set_config('request.jwt.claims','{"role":"anon"}',true); END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN ASSERT NOT public.has_permission(gen_random_uuid(),'products','view');
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DELETE FROM public.organizations WHERE id IN (SELECT org_id FROM zz_permission_context UNION SELECT other_org FROM zz_permission_context);
SELECT count(*) AS zz_residue FROM public.organizations WHERE slug LIKE 'zz-permission-%';
ROLLBACK;
