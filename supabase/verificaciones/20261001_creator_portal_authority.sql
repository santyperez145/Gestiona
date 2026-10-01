-- Actual web roles, synthetic ZZ organizations, no external payments or emails.
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.zz_creator_default_probe() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'SELECT 1';

DO $verify$
DECLARE
  v_users uuid[]; v_owner uuid; v_other uuid; v_email text; v_other_email text;
  v_org uuid := gen_random_uuid(); v_other_org uuid := gen_random_uuid();
  v_influencer uuid := gen_random_uuid(); v_other_influencer uuid := gen_random_uuid();
  v_exchange uuid := gen_random_uuid(); v_other_exchange uuid := gen_random_uuid();
  v_bad_exchange uuid := gen_random_uuid(); v_destination uuid; v_request uuid;
  v_contract public.influencer_contracts;
  v_result jsonb; v_before timestamptz; v_count integer; v_denied boolean; v_signature text;
BEGIN
  SELECT array_agg(id) INTO v_users FROM (SELECT id FROM auth.users
    WHERE email IS NOT NULL AND email_confirmed_at IS NOT NULL ORDER BY created_at LIMIT 2) users;
  ASSERT array_length(v_users,1) = 2, 'requires two verified identities';
  v_owner := v_users[1]; v_other := v_users[2];
  SELECT email INTO v_email FROM auth.users WHERE id = v_owner;
  SELECT email INTO v_other_email FROM auth.users WHERE id = v_other;

  ASSERT NOT has_function_privilege('anon','public.zz_creator_default_probe()','EXECUTE'), 'new RPC inherited anon grant';
  ASSERT NOT has_function_privilege('authenticated','public.zz_creator_default_probe()','EXECUTE'), 'new RPC inherited web grant';
  ASSERT has_function_privilege('service_role','public.zz_creator_default_probe()','EXECUTE'), 'internal default lost service access';
  ASSERT NOT has_function_privilege('anon','public.creator_campaigns()','EXECUTE'), 'anonymous campaigns still granted';
  ASSERT NOT has_function_privilege('authenticated','public.recompute_contract_signed(uuid)','EXECUTE'), 'internal contract helper still public';
  ASSERT NOT has_table_privilege('authenticated','public.creator_accounts','INSERT'), 'creator email may be impersonated';
  ASSERT NOT has_table_privilege('authenticated','public.creator_accounts','UPDATE'), 'creator email may be overwritten';
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_creator_earnings(text)','public.request_creator_withdrawal(text,numeric)',
    'public.list_creator_withdrawals(text)','public.get_influencer_portal(text)',
    'public.submit_influencer_content(text,uuid,text,integer)'
  ] LOOP
    ASSERT to_regprocedure(v_signature) IS NULL, 'legacy capability remains: ' || v_signature;
  END LOOP;

  INSERT INTO public.organizations(id,name,slug,owner_user_id) VALUES
    (v_org,'ZZ portal authority A','zz-portal-authority-'||v_org,v_owner),
    (v_other_org,'ZZ portal authority B','zz-portal-authority-'||v_other_org,v_other);
  INSERT INTO public.memberships(org_id,user_id,role) VALUES
    (v_org,v_owner,'owner'),(v_org,v_other,'viewer'),(v_other_org,v_other,'owner');
  INSERT INTO public.creator_accounts(user_id,email,display_name,onboarding_completed) VALUES
    (v_owner,v_email,'ZZ creator A',true),(v_other,v_other_email,'ZZ creator B',true)
  ON CONFLICT(user_id) DO NOTHING;
  INSERT INTO public.influencers(id,org_id,user_id,name,email,referral_code,status) VALUES
    (v_influencer,v_org,v_owner,'ZZ creator identical name',v_email,'ZZ-A-'||v_influencer,'activo'),
    (v_other_influencer,v_other_org,v_other,'ZZ creator identical name',v_other_email,'ZZ-B-'||v_other_influencer,'activo');
  INSERT INTO public.influencer_exchanges(id,org_id,user_id,influencer_id,influencer_name,product_name,quantity,expected_posts,status) VALUES
    (v_exchange,v_org,v_owner,NULL,'ZZ creator identical name','ZZ product A',1,2,'pendiente'),
    (v_other_exchange,v_other_org,v_other,v_other_influencer,'ZZ creator identical name','ZZ product B',1,1,'pendiente');
  v_denied := false;
  BEGIN
    INSERT INTO public.influencer_exchanges(id,org_id,user_id,influencer_id,influencer_name,product_name)
      VALUES(v_bad_exchange,v_org,v_owner,v_other_influencer,'ZZ creator identical name','ZZ invalid tenant');
  EXCEPTION WHEN foreign_key_violation THEN v_denied := true; END;
  ASSERT v_denied, 'invalid cross-org assignment was persisted';

  PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
  SET LOCAL ROLE anon;
  v_denied := false;
  BEGIN PERFORM public.creator_exchanges(); EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'anon read creator exchanges';
  v_denied := false;
  BEGIN PERFORM public.creator_submit_exchange_content(v_exchange,'https://example.invalid/post',2);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'anon submitted content';
  v_denied := false;
  BEGIN PERFORM public.creator_request_withdrawal(100,NULL,NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'anon requested money';
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_other,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM public.influencer_exchanges WHERE org_id = v_org;
  ASSERT v_count = 0, 'viewer read raw exchange records';
  UPDATE public.influencer_exchanges SET status = 'cumplido' WHERE id = v_exchange;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  ASSERT v_count = 0, 'viewer changed brand review status';
  v_denied := false;
  BEGIN PERFORM public.brand_link_creator_exchange(v_exchange,v_influencer);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'viewer linked creator in foreign brand';
  v_denied := false;
  BEGIN PERFORM public.creator_submit_exchange_content(v_exchange,'https://example.invalid/foreign',1);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'same name or membership authorized foreign creator';
  SELECT count(*) INTO v_count FROM public.creator_exchanges() WHERE id IN (v_exchange,v_bad_exchange);
  ASSERT v_count = 0, 'creator read foreign or broken cross-org assignment';
  SELECT count(*) INTO v_count FROM public.creator_exchanges() WHERE id = v_other_exchange;
  ASSERT v_count = 1, 'second creator could not read own assignment';
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_owner,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN PERFORM public.brand_link_creator_exchange(v_exchange,v_other_influencer);
  EXCEPTION WHEN invalid_parameter_value THEN v_denied := true; END;
  ASSERT v_denied, 'owner linked profile from another organization';
  PERFORM public.brand_link_creator_exchange(v_exchange,v_influencer);
  PERFORM public.brand_link_creator_exchange(v_exchange,v_influencer);
  SELECT * INTO v_contract FROM public.create_influencer_contract(v_org,v_influencer,'percentage',0,10,current_date,NULL,'ZZ contract');
  PERFORM public.accept_influencer_contract(v_contract.id,'ZZ verified creator');
  RESET ROLE;
  ASSERT (SELECT is_signed FROM public.influencer_contracts WHERE id = v_contract.id),
    'revoking direct helper access broke bilateral acceptance';
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN UPDATE public.influencer_exchanges SET influencer_id = v_other_influencer WHERE id = v_exchange;
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true; END;
  ASSERT v_denied, 'direct update bypassed creator assignment authority';
  SELECT count(*) INTO v_count FROM public.creator_exchanges() WHERE id = v_exchange;
  ASSERT v_count = 1, 'explicit assignment or retry failed';
  SELECT to_jsonb(exchange) INTO v_result FROM public.creator_exchanges() exchange WHERE id = v_exchange;
  ASSERT NOT (v_result ? 'portal_token') AND NOT (v_result ? 'email') AND NOT (v_result ? 'user_id')
    AND NOT (v_result ? 'product_value_ars'), 'creator received internal fields';
  v_denied := false;
  BEGIN PERFORM public.creator_submit_exchange_content(v_exchange,'javascript:alert(1)',2);
  EXCEPTION WHEN invalid_parameter_value THEN v_denied := true; END;
  ASSERT v_denied, 'unsafe content URL accepted';
  v_denied := false;
  BEGIN PERFORM public.creator_submit_exchange_content(v_exchange,'https://example.invalid/post',1001);
  EXCEPTION WHEN invalid_parameter_value THEN v_denied := true; END;
  ASSERT v_denied, 'unbounded declared posts accepted';
  PERFORM public.creator_submit_exchange_content(v_exchange,'https://example.invalid/post',2);
  SELECT content_submitted_at INTO v_before FROM public.creator_exchanges() WHERE id = v_exchange;
  PERFORM public.creator_submit_exchange_content(v_exchange,'https://example.invalid/post',2);
  ASSERT (SELECT status = 'pendiente' AND content_submitted_at = v_before FROM public.creator_exchanges() WHERE id = v_exchange),
    'submission approved itself or retry changed the date';
  RESET ROLE;

  INSERT INTO public.influencers(org_id,user_id,name,email,referral_code,status)
    VALUES(v_org,v_owner,'ZZ alternative creator',v_email,'ZZ-ALT-'||v_influencer,'activo') RETURNING id INTO v_other_influencer;
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN PERFORM public.brand_link_creator_exchange(v_exchange,v_other_influencer);
  EXCEPTION WHEN SQLSTATE '55000' THEN v_denied := true; END;
  ASSERT v_denied, 'submitted exchange was reassigned';
  RESET ROLE;
  UPDATE public.influencer_exchanges SET status = 'cumplido' WHERE id = v_exchange;
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN PERFORM public.creator_submit_exchange_content(v_exchange,'https://example.invalid/new-post',3);
  EXCEPTION WHEN SQLSTATE '55000' THEN v_denied := true; END;
  ASSERT v_denied, 'closed exchange content was overwritten';
  RESET ROLE;

  INSERT INTO public.influencer_sales(org_id,sale_id,influencer_id,referral_code,sale_total_ars,commission_ars)
    VALUES(v_org,gen_random_uuid(),v_influencer,'ZZ-A-'||v_influencer,10000,1000);
  SET LOCAL ROLE authenticated;
  v_destination := public.creator_payout_destination_save('mercadopago','email','Mercado Pago','ZZ creator A','zz-portal@invalid.test',true);
  v_result := public.creator_request_withdrawal(500,v_destination,'ZZ reversible security check');
  v_request := ((v_result->'request_ids')->>0)::uuid;
  ASSERT v_request IS NOT NULL, 'canonical withdrawal stopped working';
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_other,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  v_denied := false;
  BEGIN PERFORM public.creator_request_withdrawal(100,v_destination,NULL);
  EXCEPTION WHEN invalid_parameter_value THEN v_denied := true; END;
  ASSERT v_denied, 'creator used another account payout destination';
  RESET ROLE;
  ASSERT (SELECT count(*) FROM public.influencer_withdrawal_requests WHERE id = v_request AND status = 'pending') = 1,
    'request missing or marked paid without external evidence';
  RAISE NOTICE 'PASS: creator authority, actual web roles and two tenants, rollback only';
END
$verify$;

ROLLBACK;
SELECT count(*) AS remaining_test_organizations FROM public.organizations WHERE name LIKE 'ZZ portal authority %';
