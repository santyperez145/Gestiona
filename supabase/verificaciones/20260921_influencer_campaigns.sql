BEGIN;
DO $verify$
DECLARE
  v_org uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_id uuid := gen_random_uuid();
  v_creator uuid := gen_random_uuid();
  v_delivery uuid := gen_random_uuid();
  v_other_creator uuid := gen_random_uuid();
  v_user uuid;
  v_campaign public.influencer_campaigns;
  v_denied boolean;
  v_count integer;
  v_role text;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'requires existing user';
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (v_org, 'ZZ Influencer verification', 'zz-influencer-' || v_org, v_user),
    (v_other, 'ZZ Influencer verification', 'zz-influencer-' || v_other, v_user);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  DELETE FROM public.role_permissions WHERE org_id = v_org AND module = 'influencers';
  INSERT INTO public.influencers(id, org_id, user_id, name, referral_code, status) VALUES
    (v_creator, v_org, v_user, 'ZZ Creator', v_creator::text, 'active'),
    (v_other_creator, v_other, v_user, 'ZZ Other creator', v_other_creator::text, 'active');
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO v_campaign FROM public.save_influencer_campaign(v_org, v_id, 0, 'ZZ Campaign',
    'Create an original video about the product', 'sales', 'instagram', 1000, current_date + 10, ARRAY[v_creator]);
  ASSERT v_campaign.status = 'draft' AND v_campaign.version = 1, 'create did not persist';
  PERFORM public.save_influencer_campaign(v_org, v_id, 0, 'ZZ Campaign',
    'Create an original video about the product', 'sales', 'instagram', 1000, current_date + 10, ARRAY[v_creator]);
  SELECT count(*) INTO v_count FROM public.influencer_campaign_events WHERE campaign_id = v_id;
  ASSERT v_count = 1, 'create retry duplicated audit';
  v_denied := false;
  BEGIN
    PERFORM public.save_influencer_campaign(v_org, gen_random_uuid(), 0, 'ZZ Invalid', '', 'sales', 'instagram', 1000, current_date + 10, ARRAY[v_other_creator]);
  EXCEPTION WHEN raise_exception THEN v_denied := SQLERRM = 'invalid_campaign_creator'; END;
  ASSERT v_denied, 'cross-tenant creator accepted';
  v_denied := false;
  BEGIN UPDATE public.influencer_campaigns SET budget_ars = 1 WHERE id = v_id;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'direct campaign mutation permitted';
  SELECT * INTO v_campaign FROM public.transition_influencer_campaign(v_org, v_id, 1, 'active');
  ASSERT v_campaign.status = 'active' AND v_campaign.version = 2, 'activation failed';
  v_denied := false;
  BEGIN PERFORM public.transition_influencer_campaign(v_org, v_id, 1, 'paused');
  EXCEPTION WHEN serialization_failure THEN v_denied := true; END;
  ASSERT v_denied, 'stale version allowed';
  SELECT * INTO v_campaign FROM public.transition_influencer_campaign(v_org, v_id, 2, 'paused');
  SELECT * INTO v_campaign FROM public.save_influencer_campaign(v_org, v_id, 3, 'ZZ Updated',
    'Updated original video requirements', 'content', 'tiktok', 2000, current_date + 12, ARRAY[v_creator]);
  ASSERT v_campaign.version = 4 AND v_campaign.budget_ars = 2000, 'paused edit failed';
  PERFORM public.transition_influencer_campaign(v_org, v_id, 4, 'active');
  PERFORM public.transition_influencer_campaign(v_org, v_id, 5, 'completed');
  v_denied := false;
  BEGIN PERFORM public.transition_influencer_campaign(v_org, v_id, 6, 'active');
  EXCEPTION WHEN raise_exception THEN v_denied := SQLERRM = 'invalid_campaign_transition'; END;
  ASSERT v_denied, 'closed campaign reopened';
  SELECT count(*) INTO v_count FROM public.influencer_campaigns WHERE org_id = v_other;
  ASSERT v_count = 0, 'cross-tenant campaign read';
  v_denied := false;
  BEGIN PERFORM public.save_influencer_campaign(v_other, gen_random_uuid(), 0, 'ZZ Forbidden', '', 'sales', 'instagram', 100, null, ARRAY[]::uuid[]);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'cross-tenant campaign creation';
  INSERT INTO public.influencer_deliverables(id, org_id, influencer_id, influencer_name, campaign_id, description, due_date)
    VALUES (v_delivery, v_org, v_creator, 'ZZ Creator', v_id, 'ZZ Deliverable', current_date + 12);
  v_denied := false;
  BEGIN UPDATE public.influencer_deliverables SET status = 'completado' WHERE id = v_delivery;
  EXCEPTION WHEN raise_exception THEN v_denied := true; END;
  ASSERT v_denied, 'approved without content evidence';
  UPDATE public.influencer_deliverables SET status = 'entregado', content_url = 'https://example.com/zz-test' WHERE id = v_delivery;
  v_denied := false;
  BEGIN UPDATE public.influencer_deliverables SET status = 'completado' WHERE id = v_delivery;
  EXCEPTION WHEN raise_exception THEN v_denied := SQLERRM = 'review_required'; END;
  ASSERT v_denied, 'approved without review';
  UPDATE public.influencer_deliverables SET status = 'completado', review_notes = 'ZZ Reviewed' WHERE id = v_delivery;
  v_denied := false;
  BEGIN INSERT INTO public.influencer_contracts(org_id, influencer_id, influencer_name, valid_from)
    VALUES (v_org, v_other_creator, 'ZZ Other creator', current_date);
  EXCEPTION WHEN foreign_key_violation THEN v_denied := true; END;
  ASSERT v_denied, 'cross-tenant contract relation allowed';
  RESET ROLE;
  FOREACH v_role IN ARRAY ARRAY['admin', 'vendedor', 'viewer'] LOOP
    UPDATE public.memberships SET role = v_role::public.org_role WHERE org_id = v_org AND user_id = v_user;
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_count FROM public.influencer_campaigns WHERE id = v_id;
    ASSERT v_count = CASE WHEN v_role = 'admin' THEN 1 ELSE 0 END, 'role read boundary';
    v_denied := false;
    BEGIN PERFORM public.save_influencer_campaign(v_org, gen_random_uuid(), 0, 'ZZ Role', '', 'sales', 'instagram', 0, null, ARRAY[]::uuid[]);
    EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
    ASSERT v_denied = (v_role <> 'admin'), 'role write boundary';
    RESET ROLE;
  END LOOP;
  UPDATE public.memberships SET role = 'admin' WHERE org_id = v_org AND user_id = v_user;
  INSERT INTO public.role_permissions(org_id, role, module, can_view, can_create, can_edit, can_delete, can_export)
    VALUES (v_org, 'admin', 'influencers', true, false, false, false, false);
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN PERFORM public.save_influencer_campaign(v_org, gen_random_uuid(), 0, 'ZZ Denied', '', 'sales', 'instagram', 0, null, ARRAY[]::uuid[]);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'explicit create denial ignored';
  UPDATE public.influencers SET name = 'ZZ Forbidden' WHERE id = v_creator;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  ASSERT v_count = 0, 'legacy creator update ignored permissions';
  RESET ROLE;
  UPDATE public.role_permissions SET can_view = false WHERE org_id = v_org AND module = 'influencers';
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.influencer_campaigns WHERE org_id = v_org;
  ASSERT v_count = 0, 'explicit view denial ignored';
  RESET ROLE;
  SET LOCAL ROLE anon;
  v_denied := false;
  BEGIN PERFORM public.save_influencer_campaign(v_org, gen_random_uuid(), 0, 'ZZ Anonymous', '', 'sales', 'instagram', 0, null, ARRAY[]::uuid[]);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'anonymous campaign creation allowed';
  RESET ROLE;
  RAISE NOTICE 'PASS: campaign lifecycle, idempotency, conflicts, tenancy and role permissions';
END;
$verify$;
ROLLBACK;
SELECT count(*) AS remaining_test_organizations FROM public.organizations WHERE name = 'ZZ Influencer verification';
