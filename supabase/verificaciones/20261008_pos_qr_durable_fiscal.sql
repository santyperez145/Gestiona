-- Preview only. No provider calls; every synthetic identity/event is rolled back.
BEGIN;
CREATE TEMP TABLE zz_pos_fiscal_checks(check_name text) ON COMMIT DROP;
GRANT SELECT, INSERT ON zz_pos_fiscal_checks TO authenticated;
DO $proof$
DECLARE
  v_org uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_key uuid;
  v_sales jsonb;
  v_result jsonb;
  v_proof jsonb;
  v_session uuid;
  v_order text;
  v_invoice uuid;
  v_case integer;
  v_denied boolean;
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (v_actor,'zz-pos-fiscal-' || v_actor || '@example.invalid','{"account_type":"store_customer"}'),
    (v_other,'zz-pos-fiscal-' || v_other || '@example.invalid','{"account_type":"store_customer"}');
  INSERT INTO public.organizations(id,name,slug,owner_user_id)
    VALUES(v_org,'ZZ POS fiscal','zz-pos-fiscal-' || v_org,v_actor);
  INSERT INTO public.memberships(org_id,user_id,role) VALUES(v_org,v_actor,'owner'),(v_org,v_other,'admin');
  UPDATE public.settings SET exchange_rate=1000, afip_tipo_emisor='monotributista' WHERE org_id=v_org;
  INSERT INTO public.products(id,org_id,user_id,name,sale_price_ars,cost_usd,total_cost_usd,stock)
    VALUES(v_product,v_org,v_actor,'ZZ POS fiscal product',9000,2,2,10);
  INSERT INTO public.payment_connections(org_id,provider,external_id,access_token,live_mode)
    VALUES(v_org,'mercadopago','ZZ_ACCOUNT','nerqia:v1:fixture-not-a-token',false);

  FOR v_case IN 1..4 LOOP
    UPDATE public.memberships SET role='owner' WHERE org_id=v_org AND user_id=v_actor;
    UPDATE public.settings SET afip_tipo_emisor='monotributista' WHERE org_id=v_org;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);
    v_key := gen_random_uuid();
    v_sales := jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'product_id',v_product,
      'product_name','ZZ POS fiscal product','quantity',1,'unit_price_ars',9000,
      'paid',true,'payment_method','qr','source','pos'));
    v_result := public.pos_qr_session_prepare_fiscal(v_org,v_sales,v_key,v_case <> 4);
    v_session := (v_result->>'session_id')::uuid;
    ASSERT (v_result->>'invoice_requested')::boolean = (v_case <> 4);
    ASSERT NOT EXISTS(SELECT 1 FROM public.invoices WHERE org_id=v_org AND sale_transaction_id IS NOT NULL
      AND sale_transaction_id=(v_result->>'sale_transaction_id')::uuid);

    v_denied := false;
    BEGIN
      PERFORM public.pos_qr_session_prepare_fiscal(v_org,v_sales,v_key,v_case = 4);
    EXCEPTION WHEN unique_violation THEN v_denied := true;
    END;
    ASSERT v_denied, 'Idempotency key silently changed fiscal opt-in';
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_other,'role','authenticated')::text,true);
    v_denied := false;
    BEGIN
      PERFORM public.pos_qr_session_prepare_fiscal(v_org,v_sales,v_key,v_case <> 4);
    EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
    END;
    ASSERT v_denied, 'Another cashier reused the fiscal request';
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);
    v_order := 'ORD_ZZ_' || replace(v_session::text,'-','');
    PERFORM public.pos_qr_provider_created(v_session,v_order,'ZZ_QR','created','{}');
    v_proof := jsonb_build_object('source','mercadopago_orders_api','provider_evidence_version',1,
      'provider_order_type','qr','provider_currency','ARS','provider_merchant_id','ZZ_ACCOUNT',
      'external_reference','posqr_' || replace(v_session::text,'-',''), 'provider_live_mode',false,
      'payment_count',1,'payment_status','processed','payment_status_detail','accredited',
      'order_total_amount',9000,'order_paid_amount',9000,'payment_amount',9000,'payment_paid_amount',9000);
    IF v_case=1 THEN
      v_result := public.pos_qr_apply_provider(v_session,v_order,'processed','accredited','ZZ_PAY',9000,NULL,NULL,v_proof - 'payment_paid_amount');
      ASSERT v_result->>'state'='manual_review';
      ASSERT NOT EXISTS(SELECT 1 FROM public.invoices WHERE org_id=v_org);
      ASSERT (SELECT stock FROM public.products WHERE id=v_product)=10;
      INSERT INTO zz_pos_fiscal_checks VALUES('incomplete payment never creates invoice or stock movement');
    ELSIF v_case=2 THEN
      UPDATE public.memberships SET role='vendedor' WHERE org_id=v_org AND user_id=v_actor;
      ASSERT public.has_permission(v_org,'sales','create');
      ASSERT NOT public.has_permission(v_org,'invoices','edit');
    ELSIF v_case=3 THEN
      UPDATE public.settings SET afip_tipo_emisor=NULL WHERE org_id=v_org;
    END IF;
    v_result := public.pos_qr_apply_provider(v_session,v_order,'processed','accredited','ZZ_PAY_' || v_case,9000,NULL,NULL,v_proof);
    ASSERT v_result->>'state'='completed', 'Fiscal failure rolled back paid ticket';
    ASSERT (SELECT stock FROM public.products WHERE id=v_product)=10-v_case;
    SELECT invoice_id INTO v_invoice FROM public.pos_qr_sessions WHERE id=v_session;
    IF v_case=1 THEN
      ASSERT v_invoice IS NOT NULL, 'Server did not prepare opted-in invoice';
      ASSERT (SELECT sale_transaction_id FROM public.invoices WHERE id=v_invoice)=(v_result->>'sale_transaction_id')::uuid;
      ASSERT (SELECT total FROM public.invoices WHERE id=v_invoice)=9000;
      ASSERT (SELECT cae FROM public.invoices WHERE id=v_invoice) IS NULL, 'Fixture fabricated a CAE';
      ASSERT (SELECT count(*) FROM public.outbox_events WHERE org_id=v_org AND event_type='factura.creada')=1;
      PERFORM set_config('nerqia.pos_fiscal_verified',v_session::text,true);
      PERFORM set_config('nerqia.pos_fiscal_unaffiliated',v_other::text,true);
      INSERT INTO zz_pos_fiscal_checks VALUES('server prepares canonical invoice and one fiscal outbox delivery');
    ELSIF v_case=2 THEN
      ASSERT v_invoice IS NULL AND v_result->>'invoice_preparation_error'='permission_required';
      INSERT INTO zz_pos_fiscal_checks VALUES('revoked fiscal permission preserves payment and stock, no privilege bypass');
    ELSIF v_case=3 THEN
      ASSERT v_invoice IS NULL AND v_result->>'invoice_preparation_error'='configuration_required';
      INSERT INTO zz_pos_fiscal_checks VALUES('missing fiscal identity preserves payment and records recovery');
    ELSE
      ASSERT v_invoice IS NULL AND NOT (v_result->>'invoice_requested')::boolean;
      INSERT INTO zz_pos_fiscal_checks VALUES('opt-out closes paid sale without creating invoice');
    END IF;
    v_result := public.pos_qr_apply_provider(v_session,v_order,'processed','accredited','ZZ_PAY_' || v_case,9000,NULL,NULL,v_proof);
    ASSERT (SELECT count(*) FROM public.sale_transactions WHERE org_id=v_org)=v_case;
    ASSERT (SELECT stock FROM public.products WHERE id=v_product)=10-v_case;
    ASSERT (SELECT count(*) FROM public.invoices WHERE org_id=v_org)=1;
    ASSERT (SELECT count(*) FROM public.outbox_events WHERE org_id=v_org AND event_type='factura.creada'
      AND objetivo='afip-authorize')=1;
  END LOOP;
  INSERT INTO zz_pos_fiscal_checks VALUES('duplicates never create a second invoice, sale or stock movement');
  ASSERT NOT has_function_privilege('anon','public.pos_qr_session_prepare_fiscal(uuid,jsonb,uuid,boolean)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.trg_pos_qr_prepare_fiscal_invoice()','EXECUTE');
  ASSERT NOT has_function_privilege('service_role','public.trg_pos_qr_prepare_fiscal_invoice()','EXECUTE');
  INSERT INTO zz_pos_fiscal_checks VALUES('private trigger and public request grants bounded');
  v_key := gen_random_uuid();
  v_sales := jsonb_set(v_sales,'{0,id}',to_jsonb(gen_random_uuid()));
  v_result := public.pos_qr_session_prepare(v_org,v_sales,v_key);
  v_session := (v_result->>'session_id')::uuid;
  v_order := 'ORD_ZZ_LEGACY_' || replace(v_session::text,'-','');
  PERFORM public.pos_qr_provider_created(v_session,v_order,'ZZ_QR','created','{}');
  v_result := public.pos_qr_session_prepare_fiscal(v_org,v_sales,v_key,false);
  ASSERT v_result->>'state'='pending' AND (v_result->>'reused')::boolean;
  ASSERT NOT (v_result->>'invoice_requested')::boolean;
  ASSERT (SELECT invoice_request_set_at FROM public.pos_qr_sessions WHERE id=v_session) IS NULL;
  v_denied := false;
  BEGIN
    PERFORM public.pos_qr_session_prepare_fiscal(v_org,v_sales,v_key,true);
  EXCEPTION WHEN unique_violation THEN v_denied := true;
  END;
  ASSERT v_denied, 'Legacy order retroactively enabled fiscal consent';
  ASSERT (SELECT stock FROM public.products WHERE id=v_product)=6;
  ASSERT (SELECT count(*) FROM public.sale_transactions WHERE org_id=v_org)=4;
  INSERT INTO zz_pos_fiscal_checks VALUES('legacy order retries without a new charge or retroactive fiscal consent');
  DELETE FROM public.memberships WHERE org_id=v_org AND user_id=v_other;
END;
$proof$;
SET LOCAL ROLE authenticated;
DO $browser$
BEGIN
  BEGIN
    UPDATE public.pos_qr_sessions SET invoice_requested=false
      WHERE id=current_setting('nerqia.pos_fiscal_verified')::uuid;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT (public.pos_qr_session_response(current_setting('nerqia.pos_fiscal_verified')::uuid)
    ->>'invoice_requested')::boolean, 'Browser mutated the frozen fiscal request';
  INSERT INTO zz_pos_fiscal_checks VALUES('browser role cannot mutate the frozen fiscal decision');
  PERFORM set_config('request.jwt.claims',jsonb_build_object(
    'sub',current_setting('nerqia.pos_fiscal_unaffiliated'),'role','authenticated')::text,true);
  ASSERT public.pos_qr_session_response(current_setting('nerqia.pos_fiscal_verified')::uuid) IS NULL,
    'Unaffiliated browser read another merchant QR or invoice';
  INSERT INTO zz_pos_fiscal_checks VALUES('unaffiliated account cannot read QR or fiscal document');
END;
$browser$;
RESET ROLE;
SELECT * FROM zz_pos_fiscal_checks;
ROLLBACK;
SELECT count(*) AS residual_organizations FROM public.organizations WHERE slug LIKE 'zz-pos-fiscal-%';
SELECT count(*) AS residual_users FROM auth.users WHERE email LIKE 'zz-pos-fiscal-%@example.invalid';
