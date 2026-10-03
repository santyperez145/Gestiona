-- Synthetic catalog only. No source workbook, production stock or orders are used.
BEGIN;
CREATE TEMP TABLE zz_import_context(org_id uuid, owner_id uuid, admin_id uuid, viewer_id uuid, session_id uuid, prefix text, other_session uuid);
DO $$
DECLARE v_org uuid := gen_random_uuid(); v_other_org uuid := gen_random_uuid(); v_other_session uuid := gen_random_uuid(); v_plan uuid; v_owner uuid; v_admin uuid; v_viewer uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY created_at LIMIT 1;
  SELECT id INTO v_admin FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  SELECT id INTO v_viewer FROM auth.users WHERE id NOT IN (v_owner,v_admin) ORDER BY created_at LIMIT 1;
  ASSERT v_owner IS NOT NULL AND v_admin IS NOT NULL AND v_viewer IS NOT NULL, 'Three existing identities required';
  INSERT INTO public.plans(code,name,price_usd_monthly,price_usd_yearly,max_products,max_users,active)
    VALUES ('zz-import-'||v_org,'ZZ Import test',0,0,498,10,false) RETURNING id INTO v_plan;
  INSERT INTO public.organizations(id,name,slug,owner_user_id,plan_id) VALUES(v_org,'ZZ Import test','zz-import-'||v_org,v_owner,v_plan);
  INSERT INTO public.memberships(org_id,user_id,role) VALUES(v_org,v_owner,'owner'),(v_org,v_admin,'admin'),(v_org,v_viewer,'viewer');
  INSERT INTO public.role_permissions(org_id,role,module,can_view,can_create,can_edit,can_delete,can_export)
    VALUES(v_org,'admin','products',true,true,true,true,true)
    ON CONFLICT(org_id,role,module) DO NOTHING;
  INSERT INTO public.organizations(id,name,slug,owner_user_id,plan_id) VALUES(v_other_org,'ZZ Other import tenant','zz-import-'||v_other_org,v_admin,v_plan);
  INSERT INTO public.memberships(org_id,user_id,role) VALUES(v_other_org,v_admin,'owner');
  INSERT INTO public.catalog_import_sessions(id,org_id,created_by,filename,source_format,source_system,total,source_rows,options)
    VALUES(v_other_session,v_other_org,v_admin,'zz-other.xlsx','xlsx','generic',1,1,'{"stock_mode":"ignore"}'::jsonb);
  INSERT INTO zz_import_context VALUES(v_org,v_owner,v_admin,v_viewer,gen_random_uuid(),'ZZ-'||v_org||'-',v_other_session);
END;
$$;
GRANT SELECT ON zz_import_context TO authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true) FROM zz_import_context;
SET LOCAL ROLE authenticated;
DO $$
DECLARE c record; s jsonb; payload jsonb; options jsonb := '{"stock_mode":"ignore","exchange_rate":0,"auto_price":false}'::jsonb;
  batch uuid; denied boolean; started timestamptz := clock_timestamp(); count_before int; detail jsonb; second uuid := gen_random_uuid();
BEGIN
  SELECT * INTO c FROM zz_import_context;
  denied := false;
  BEGIN PERFORM public.catalog_import_status(c.other_session); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'Owner of a different tenant can read source records';
  s := public.start_catalog_import(c.session_id,c.org_id,'zz-reference.xls','xls','generic',501,501,options);
  ASSERT s->>'status' = 'preparing';
  ASSERT (public.start_catalog_import(c.session_id,c.org_id,'zz-reference.xls','xls','generic',501,501,options)->>'id')::uuid = c.session_id;
  denied := false;
  BEGIN PERFORM public.start_catalog_import(c.session_id,c.org_id,'other.xls','xls','generic',501,501,options); EXCEPTION WHEN OTHERS THEN denied := true; END;
  ASSERT denied, 'Session options/file must be immutable';
  FOR start_at IN 0..2 LOOP
    SELECT jsonb_agg(jsonb_build_object('name','ZZ Same description','sku',c.prefix||lpad((CASE WHEN i=501 THEN 1 ELSE i END)::text,6,'0'),
      'cost_ars',100,'sale_price_ars',200,'stock',CASE WHEN i%2=0 THEN -3 ELSE 1.5 END,
      'barcode','ZZ-PRIMARY-'||i,'barcode_aliases',jsonb_build_array('ZZ-ALT-'||i),
      'source_record','{"headers":["VENTA","CODIGO PROVEEDOR","CODIGO PROVEEDOR"],"values":[160,"ZZ-SKU","ZZ-SUPPLIER"]}',
      'source_row',i+1,'provided',jsonb_build_array('name','sku','cost_ars','sale_price_ars','stock','barcode','barcode_aliases'))) INTO payload
    FROM generate_series(start_at*250+1,least((start_at+1)*250,501)) i;
    s := public.stage_catalog_import_chunk(c.session_id,start_at*250,payload);
    ASSERT (public.stage_catalog_import_chunk(c.session_id,start_at*250,payload)->>'prepared')::int = (s->>'prepared')::int, 'Stage retry duplicated a chunk';
    IF start_at=0 THEN
      SELECT batch_id INTO batch FROM public.catalog_import_chunks WHERE session_id=c.session_id AND position=0;
      denied := false;
      BEGIN PERFORM public.apply_catalog_migration(batch,true); EXCEPTION WHEN OTHERS THEN denied := true; END;
      ASSERT denied, 'Old RPC bypassed session approval';
      denied := false;
      BEGIN PERFORM public.approve_catalog_import(c.session_id,true); EXCEPTION WHEN OTHERS THEN denied := true; END;
      ASSERT denied, 'Approval before complete validation';
    END IF;
  END LOOP;
  ASSERT (s->>'valid')::int = 499 AND (s->>'invalid')::int = 2, 'Cross-chunk duplicate codes not detected: '||s;
  ASSERT (SELECT count(*) FROM public.products WHERE org_id=c.org_id)=0, 'Staging changed products';
  denied := false;
  BEGIN PERFORM public.approve_catalog_import(c.session_id,false); EXCEPTION WHEN OTHERS THEN denied := true; END;
  ASSERT denied, 'Invalid rows applied without approval';
  denied := false;
  BEGIN
    PERFORM public.approve_catalog_import(c.session_id,true);
  EXCEPTION WHEN OTHERS THEN
    denied := SQLERRM = 'El catálogo supera el límite de productos de tu plan';
  END;
  ASSERT denied, 'Whole-file plan quota was not enforced before applying the first chunk';
  ASSERT (public.catalog_import_status(c.session_id)->>'status')='ready', 'Quota failure approved the session';
  ASSERT (SELECT count(*) FROM public.products WHERE org_id=c.org_id)=0, 'Quota failure partly mutated products';
END;
$$;
RESET ROLE;
UPDATE public.plans SET max_products=20000
WHERE id IN (SELECT o.plan_id FROM public.organizations o JOIN zz_import_context c ON c.org_id=o.id);
SET LOCAL ROLE authenticated;
DO $$
DECLARE c record; s jsonb; denied boolean; count_before int; second uuid := gen_random_uuid(); started timestamptz := clock_timestamp();
  options jsonb := '{"stock_mode":"ignore","exchange_rate":0,"auto_price":false}'::jsonb;
BEGIN
  SELECT * INTO c FROM zz_import_context;
  UPDATE public.role_permissions SET can_create=false WHERE org_id=c.org_id AND role='admin' AND module='products';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',c.admin_id,'role','authenticated')::text,true);
  denied := false;
  BEGIN PERFORM public.approve_catalog_import(c.session_id,true); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'Admin create override was ignored';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',c.owner_id,'role','authenticated')::text,true);
  UPDATE public.role_permissions SET can_create=true WHERE org_id=c.org_id AND role='admin' AND module='products';
  s := public.approve_catalog_import(c.session_id,true);
  denied := false;
  BEGIN PERFORM public.apply_catalog_import_chunk(c.session_id,250); EXCEPTION WHEN OTHERS THEN denied := true; END;
  ASSERT denied, 'Out-of-order chunk was applied';
  s := public.apply_catalog_import_chunk(c.session_id,0);
  count_before := (SELECT count(*) FROM public.products WHERE org_id=c.org_id);
  s := public.apply_catalog_import_chunk(c.session_id,0);
  ASSERT (SELECT count(*) FROM public.products WHERE org_id=c.org_id)=count_before, 'Lost-response retry duplicated products';
  UPDATE public.role_permissions SET can_create=false WHERE org_id=c.org_id AND role='admin' AND module='products';
  denied := false;
  BEGIN PERFORM public.apply_catalog_import_chunk(c.session_id,250); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'Permission revoked after approval was ignored';
  ASSERT (SELECT count(*) FROM public.products WHERE org_id=c.org_id)=count_before, 'Failed chunk partly mutated products';
  ASSERT (public.catalog_import_status(c.session_id)->>'applied')::int=250, 'Failed chunk advanced the cursor';
  UPDATE public.role_permissions SET can_create=true WHERE org_id=c.org_id AND role='admin' AND module='products';
  s := public.apply_catalog_import_chunk(c.session_id,250);
  s := public.apply_catalog_import_chunk(c.session_id,500);
  ASSERT s->>'status'='completed' AND (s->>'created')::int=499 AND (s->>'skipped')::int=2 AND (s->>'reconciled')::boolean, 'Bad reconciliation: '||s;
  ASSERT (SELECT count(*) FROM public.products WHERE org_id=c.org_id)=499, 'Distinct codes with same description collapsed';
  ASSERT NOT EXISTS(SELECT 1 FROM public.products WHERE org_id=c.org_id AND (cost_currency<>'ARS' OR cost_ars<>100 OR sale_price_ars<>200 OR discount_price_ars IS NOT NULL OR stock<>0 OR cardinality(barcode_aliases)<>1)), 'Currency, conditional price or ignored stock changed';
  ASSERT NOT EXISTS(SELECT 1 FROM public.stock_movements WHERE org_id=c.org_id), 'Ignore mode moved inventory';
  s := public.start_catalog_import(second,c.org_id,'zz-update.xlsx','xlsx','generic',1,1,options||'{"stock_mode":"replace"}'::jsonb);
  s := public.stage_catalog_import_chunk(second,0,jsonb_build_array(jsonb_build_object('name','ZZ Renamed','sku',c.prefix||'000002','cost_ars',120,'sale_price_ars',220,'stock',2,'provided',jsonb_build_array('name','sku','cost_ars','sale_price_ars','stock'))));
  ASSERT (s->>'updates')::int=1, 'SKU did not resolve update';
  s := public.approve_catalog_import(second,false);
  s := public.apply_catalog_import_chunk(second,0);
  ASSERT (s->>'updated')::int=1 AND (s->>'stock_movements')::int=1, 'Update stock not reconciled';
  ASSERT EXISTS(SELECT 1 FROM public.stock_movements WHERE org_id=c.org_id AND unit_cost_ars=120 AND quantity=2), 'Native ARS snapshot lost in Kardex';
  second := gen_random_uuid();
  s := public.start_catalog_import(second,c.org_id,'zz-invalid-stock.xlsx','xlsx','generic',2,2,options||'{"stock_mode":"replace"}'::jsonb);
  s := public.stage_catalog_import_chunk(second,0,'[{"name":"ZZ Negative stock","sku":"ZZ-INVALID-NEG","cost_ars":100,"sale_price_ars":200,"stock":-3,"provided":["name","sku","cost_ars","sale_price_ars","stock"]},{"name":"ZZ Fractional stock","sku":"ZZ-INVALID-FRACTION","cost_ars":100,"sale_price_ars":200,"stock":1.5,"provided":["name","sku","cost_ars","sale_price_ars","stock"]}]'::jsonb);
  ASSERT (s->>'invalid')::int=2 AND (s->>'valid')::int=0, 'Negative/fractional inventory was clamped';
  s := public.cancel_catalog_import(second);
  ASSERT s->>'status'='cancelled';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',c.viewer_id,'role','authenticated')::text,true);
  ASSERT (SELECT count(*) FROM public.catalog_import_sessions WHERE org_id=c.org_id)=0, 'Viewer can read raw import';
  ASSERT (SELECT count(*) FROM public.product_import_rows WHERE org_id=c.org_id)=0, 'Viewer can read cost/source records';
  denied := false;
  BEGIN PERFORM public.catalog_import_status(c.session_id); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'Viewer can call status';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',c.owner_id,'role','authenticated')::text,true);
  RAISE NOTICE 'OK: 501 synthetic rows, 3 chunks, whole-file quota, cross-chunk conflicts, idempotence, permissions, ARS and stock; % ms',round(extract(epoch FROM clock_timestamp()-started)*1000);
END;
$$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.audit_funciones_expuestas)=0, 'Unreviewed exposed functions';
  ASSERT NOT has_table_privilege('anon','public.catalog_import_sessions','SELECT'), 'Anonymous raw import access';
  ASSERT NOT has_table_privilege('authenticated','public.catalog_import_sessions','INSERT'), 'Direct session writes';
END; $$;
ROLLBACK;
SELECT count(*) AS remaining_synthetic_organizations FROM public.organizations WHERE slug LIKE 'zz-import-%';
