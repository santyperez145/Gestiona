-- Reversible fixture proof; never enumerate real identities or change roles.
BEGIN;
CREATE TEMP TABLE zz_alias_checks(check_name text) ON COMMIT DROP;
GRANT SELECT, INSERT ON zz_alias_checks TO authenticated, service_role;

DO $fixtures$
DECLARE
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_foreign uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email, raw_user_meta_data)
    VALUES (v_user, 'zz-alias-' || v_user || '@example.invalid', '{"name":"ZZ alias viewer"}'),
           (v_other, 'zz-alias-' || v_other || '@example.invalid', '{"name":"ZZ alias other"}');
  INSERT INTO public.organizations(id, name, slug, owner_user_id)
    VALUES(v_org, 'ZZ alias own', 'zz-alias-' || v_org, v_user),
          (v_foreign, 'ZZ alias foreign', 'zz-alias-' || v_foreign, v_other);
  INSERT INTO public.memberships(org_id, user_id, role)
    VALUES(v_org,v_user,'viewer'),(v_foreign,v_other,'owner')
    ON CONFLICT (org_id,user_id) DO UPDATE SET role=excluded.role;
  PERFORM set_config('nerqia.alias_test_own', v_org::text, true);
  PERFORM set_config('nerqia.alias_test_foreign', v_foreign::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_user,'role','authenticated')::text, true);
  ASSERT NOT has_table_privilege('anon','public.org_members','SELECT');
  ASSERT NOT has_table_privilege('authenticated','public.org_members','INSERT');
  ASSERT NOT has_table_privilege('authenticated','public.org_members','UPDATE');
  ASSERT NOT has_table_privilege('authenticated','public.org_members','DELETE');
  ASSERT NOT has_table_privilege('service_role','public.org_members','INSERT');
  INSERT INTO zz_alias_checks VALUES('anon denied and alias writes revoked');
END;
$fixtures$;

SET LOCAL ROLE authenticated;
DO $viewer$
DECLARE
  v_denied boolean := false;
BEGIN
  ASSERT (SELECT count(*) FROM public.org_members
    WHERE org_id=current_setting('nerqia.alias_test_own')::uuid)=1;
  ASSERT NOT EXISTS(SELECT 1 FROM public.org_members
    WHERE org_id=current_setting('nerqia.alias_test_foreign')::uuid);
  BEGIN
    UPDATE public.org_members SET role='owner'
      WHERE org_id=current_setting('nerqia.alias_test_own')::uuid;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  ASSERT v_denied, 'Alias allowed a browser role change';
  INSERT INTO zz_alias_checks VALUES('viewer reads own tenant, not foreign; cannot escalate');
END;
$viewer$;
RESET ROLE;

SET LOCAL ROLE service_role;
DO $server$
BEGIN
  ASSERT (SELECT count(*) FROM public.org_members WHERE org_id IN (
    current_setting('nerqia.alias_test_own')::uuid,
    current_setting('nerqia.alias_test_foreign')::uuid))=2;
  INSERT INTO zz_alias_checks VALUES('server retains read compatibility');
END;
$server$;
RESET ROLE;
SELECT check_name FROM zz_alias_checks ORDER BY check_name;
ROLLBACK;
SELECT count(*) AS residual_fixture_users FROM auth.users
  WHERE email LIKE 'zz-alias-%@example.invalid';
