-- Internal authority proof. No provider calls, charges or real merchant edits.
BEGIN;
CREATE TEMP TABLE zz_qr_evidence_checks(check_name text) ON COMMIT DROP;
DO $proof$
DECLARE
  v_org uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_user uuid;
  v_session uuid;
  v_order text;
  v_proof jsonb;
  v_bad jsonb;
  v_result jsonb;
  v_ticket uuid;
  v_denied boolean := false;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  ASSERT v_user IS NOT NULL, 'No fixture actor available';
  INSERT INTO public.organizations(id,name,slug,owner_user_id)
    VALUES(v_org,'ZZ QR evidence','zz-qr-evidence-' || v_org::text,v_user);
  INSERT INTO public.memberships(org_id,user_id,role) VALUES(v_org,v_user,'owner');
  UPDATE public.settings SET exchange_rate=1000 WHERE org_id=v_org;
  INSERT INTO public.products(id,org_id,user_id,name,sale_price_ars,cost_usd,total_cost_usd,stock)
    VALUES(v_product,v_org,v_user,'ZZ QR evidence product',9000,2,2,10);
  INSERT INTO public.payment_connections(org_id,provider,external_id,access_token,live_mode)
    VALUES(v_org,'mercadopago','ZZ_ACCOUNT','nerqia:v1:fixture-not-a-token',false);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
  v_result := public.pos_qr_session_prepare(v_org,jsonb_build_array(jsonb_build_object(
    'id',gen_random_uuid(),'product_id',v_product,'product_name','ZZ QR evidence product',
    'quantity',1,'unit_price_ars',9000,'paid',true,'payment_method','qr','source','pos'
  )),gen_random_uuid());
  v_session := (v_result->>'session_id')::uuid;
  v_order := 'ORD_ZZ_' || replace(v_session::text,'-','');
  PERFORM public.pos_qr_provider_created(v_session,v_order,'ZZ_QR','created','{}');
  v_proof := jsonb_build_object(
    'source','mercadopago_orders_api','provider_evidence_version',1,
    'provider_order_type','qr','provider_currency','ARS','provider_merchant_id','ZZ_ACCOUNT',
    'external_reference','posqr_' || replace(v_session::text,'-',''),
    'provider_live_mode',false,'payment_count',1,'payment_status','processed',
    'payment_status_detail','accredited','order_total_amount',9000,
    'order_paid_amount',9000,'payment_amount',9000,'payment_paid_amount',9000
  );

  FOR v_bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    v_proof - 'order_paid_amount',
    v_proof || '{"payment_paid_amount":4500}',
    v_proof || '{"provider_merchant_id":"ZZ_OTHER"}',
    v_proof || '{"external_reference":"posqr_OTHER"}',
    v_proof || '{"provider_currency":"USD"}',
    v_proof || '{"provider_live_mode":true}',
    v_proof || '{"payment_status":"pending"}',
    v_proof || '{"payment_count":2}',
    v_proof || '{"payment_paid_amount":"NaN"}'
  )) LOOP
    v_result := public.pos_qr_apply_provider(v_session,v_order,'processed','accredited','ZZ_PAY',9000,NULL,NULL,v_bad);
    ASSERT v_result->>'state'='manual_review' AND (v_result->>'evidence_rejected')::boolean;
    ASSERT NOT EXISTS(SELECT 1 FROM public.sale_transactions WHERE org_id=v_org);
    ASSERT (SELECT stock FROM public.products WHERE id=v_product)=10;
  END LOOP;
  INSERT INTO zz_qr_evidence_checks VALUES('nine invalid proofs: no sale or stock movement');

  v_result := public.pos_qr_apply_provider(v_session,v_order,'processed','accredited','ZZ_PAY',9000,NULL,NULL,v_proof);
  ASSERT v_result->>'state'='completed', 'Valid accreditation did not close ticket';
  v_ticket := (v_result->>'sale_transaction_id')::uuid;
  ASSERT v_ticket IS NOT NULL AND (SELECT stock FROM public.products WHERE id=v_product)=9;
  INSERT INTO zz_qr_evidence_checks VALUES('valid evidence closes original ticket once');
  v_result := public.pos_qr_apply_provider(v_session,v_order,'processed','accredited','ZZ_PAY',9000,NULL,NULL,v_proof);
  ASSERT (v_result->>'reused')::boolean;
  ASSERT (SELECT count(*) FROM public.sale_transactions WHERE org_id=v_org)=1;
  ASSERT (SELECT stock FROM public.products WHERE id=v_product)=9;
  INSERT INTO zz_qr_evidence_checks VALUES('duplicate notification does not sell twice');

  v_result := public.pos_qr_apply_provider(v_session,v_order,'expired','expired');
  ASSERT v_result->>'state'='completed' AND (v_result->>'ignored_stale')::boolean;
  v_result := public.pos_qr_apply_provider(v_session,v_order,'refunded','refunded');
  ASSERT v_result->>'state'='refunded';
  v_result := public.pos_qr_apply_provider(v_session,v_order,'processed','accredited','ZZ_PAY',9000,NULL,NULL,v_proof);
  ASSERT v_result->>'state'='refunded' AND (v_result->>'ignored_stale')::boolean;
  INSERT INTO zz_qr_evidence_checks VALUES('stale snapshots neither downgrade a sale nor resurrect a refund');

  ASSERT NOT has_function_privilege('authenticated',
    'public.pos_qr_apply_provider(uuid,text,text,text,text,numeric,numeric,numeric,jsonb)','EXECUTE');
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM public.pos_qr_apply_provider_inner(v_session,v_order,'processed');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  RESET ROLE;
  ASSERT v_denied, 'service_role can bypass the evidence guard';
  INSERT INTO zz_qr_evidence_checks VALUES('browser denied; service cannot bypass inner finalizer');
END;
$proof$;
SELECT * FROM zz_qr_evidence_checks;
ROLLBACK;
SELECT count(*) AS residual_organizations FROM public.organizations WHERE slug LIKE 'zz-qr-evidence-%';
