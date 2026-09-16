BEGIN;
DO $verify$
DECLARE
  v_org uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_user uuid;
  v_role text;
  v_count int;
  v_denied boolean;
  v_error text;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'requires an existing user';
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Product permissions', 'zz-permissions-' || v_org::text, v_user),
    (v_other, 'ZZ Product permissions', 'zz-permissions-' || v_other::text, v_user);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  -- New organizations seed explicit restrictions; first test the no-row fallback.
  DELETE FROM public.role_permissions WHERE org_id = v_org AND module = 'products';
  INSERT INTO public.products(id, org_id, user_id, name, stock) VALUES (v_product, v_org, v_user, 'ZZ Product', 0);
  INSERT INTO public.products(org_id, user_id, name, stock) VALUES (v_other, v_user, 'ZZ Other product', 0);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  FOREACH v_role IN ARRAY ARRAY['owner', 'admin', 'vendedor', 'viewer'] LOOP
    UPDATE public.memberships SET role = v_role::public.org_role WHERE org_id = v_org AND user_id = v_user;
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM public.products WHERE id = v_product;
    ASSERT v_count = 1, 'member cannot read';
    SELECT count(*) INTO v_count FROM public.products WHERE org_id = v_other;
    ASSERT v_count = 0, 'cross-tenant read';
    UPDATE public.products SET name = 'ZZ Edited' WHERE id = v_product;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    ASSERT v_count = CASE WHEN v_role IN ('owner', 'admin') THEN 1 ELSE 0 END, 'default edit mismatch';
    v_denied := false;
    BEGIN
      INSERT INTO public.products(org_id, user_id, name, stock) VALUES (v_org, v_user, 'ZZ Created', 0);
    EXCEPTION WHEN insufficient_privilege THEN v_denied := true; GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    END;
    ASSERT v_denied = (v_role = 'viewer'), format('default create mismatch for %s: %s', v_role, v_error);
    DELETE FROM public.products WHERE id = v_product;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    ASSERT v_count = CASE WHEN v_role IN ('owner', 'admin') THEN 1 ELSE 0 END, 'default delete mismatch';
    RESET ROLE;
    INSERT INTO public.products(id, org_id, user_id, name, stock) VALUES (v_product, v_org, v_user, 'ZZ Product', 0) ON CONFLICT (id) DO NOTHING;
  END LOOP;

  -- Edit-only viewer: explicit grants work, creation and deletion remain denied.
  INSERT INTO public.role_permissions(org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (v_org, 'viewer', 'products', true, false, true, false, false);
  SET LOCAL ROLE authenticated;
  UPDATE public.products SET name = 'ZZ Edit-only' WHERE id = v_product;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  ASSERT v_count = 1, 'explicit edit grant ignored';
  DELETE FROM public.products WHERE id = v_product;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  ASSERT v_count = 0, 'edit grant allowed deletion';
  RESET ROLE;

  UPDATE public.memberships SET role = 'admin' WHERE org_id = v_org AND user_id = v_user;
  INSERT INTO public.role_permissions(org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (v_org, 'admin', 'products', true, false, false, false, false);
  SET LOCAL ROLE authenticated;
  UPDATE public.products SET name = 'ZZ Forbidden' WHERE id = v_product;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  ASSERT v_count = 0, 'admin ignored explicit denial';
  DELETE FROM public.products WHERE id = v_product;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  ASSERT v_count = 0, 'admin ignored delete denial';
  RESET ROLE;
  UPDATE public.role_permissions SET can_view = false WHERE org_id = v_org AND role = 'admin';
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.products WHERE id = v_product;
  ASSERT v_count = 0, 'view denial ignored';
  RESET ROLE;
  DELETE FROM public.memberships WHERE org_id = v_org AND user_id = v_user;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.products WHERE id = v_product;
  ASSERT v_count = 0, 'non-member read permitted';
  RESET ROLE;
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_count FROM public.products WHERE id = v_product;
  ASSERT v_count = 0, 'anonymous raw product read';
  RESET ROLE;
  RAISE NOTICE 'PASS: product roles, overrides, tenant boundaries and anonymous denial';
END;
$verify$;
ROLLBACK;
SELECT count(*) AS remaining_test_organizations FROM public.organizations WHERE name = 'ZZ Product permissions';
