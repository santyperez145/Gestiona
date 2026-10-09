-- Proveedor en la importación de catálogo. Datos sintéticos ZZ; termina en ROLLBACK.
BEGIN;
CREATE TEMP TABLE zz_supplier_context(org_id uuid, other_org uuid, owner_id uuid, viewer_id uuid, session_id uuid, existing_supplier uuid, foreign_supplier uuid, prefix text);
DO $$
DECLARE v_org uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); v_plan uuid; v_owner uuid; v_viewer uuid; v_existing uuid; v_foreign uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.memberships WHERE role = 'owner' ORDER BY created_at LIMIT 1;
  SELECT id INTO v_viewer FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  ASSERT v_owner IS NOT NULL AND v_viewer IS NOT NULL, 'Two existing identities required';
  INSERT INTO public.plans(code,name,price_usd_monthly,price_usd_yearly,max_products,max_users,active)
    VALUES ('zz-supplier-'||v_org,'ZZ Supplier import',0,0,1000,10,false) RETURNING id INTO v_plan;
  INSERT INTO public.organizations(id,name,slug,owner_user_id,plan_id) VALUES
    (v_org,'ZZ Supplier import','zz-supplier-'||v_org,v_owner,v_plan),
    (v_other,'ZZ Supplier other tenant','zz-supplier-'||v_other,v_viewer,v_plan);
  INSERT INTO public.memberships(org_id,user_id,role) VALUES(v_org,v_owner,'owner'),(v_org,v_viewer,'viewer'),(v_other,v_viewer,'owner');
  INSERT INTO public.suppliers(org_id,name) VALUES(v_org,'ZZ Existente') RETURNING id INTO v_existing;
  INSERT INTO public.suppliers(org_id,name) VALUES(v_other,'ZZ Nuevo Distribuidor') RETURNING id INTO v_foreign;
  INSERT INTO zz_supplier_context VALUES(v_org,v_other,v_owner,v_viewer,gen_random_uuid(),v_existing,v_foreign,'ZZ-SUP-'||v_org||'-');
END;
$$;
GRANT SELECT ON zz_supplier_context TO authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true) FROM zz_supplier_context;
SET LOCAL ROLE authenticated;
DO $$
DECLARE c record; s jsonb; second uuid := gen_random_uuid();
  options jsonb := '{"stock_mode":"ignore","exchange_rate":0,"auto_price":false}'::jsonb;
  v_new uuid;
BEGIN
  SELECT * INTO c FROM zz_supplier_context;
  s := public.start_catalog_import(c.session_id,c.org_id,'zz-suppliers.xlsx','xlsx','generic',4,4,options);
  s := public.stage_catalog_import_chunk(c.session_id,0,jsonb_build_array(
    jsonb_build_object('name','ZZ Tornillo','sku',c.prefix||'1','sale_price_ars',100,'supplier','ZZ Nuevo Distribuidor','provided',jsonb_build_array('name','sku','sale_price_ars','supplier')),
    jsonb_build_object('name','ZZ Tuerca','sku',c.prefix||'2','sale_price_ars',100,'supplier','  zz nuevo DISTRIBUIDOR ','provided',jsonb_build_array('name','sku','sale_price_ars','supplier')),
    jsonb_build_object('name','ZZ Arandela','sku',c.prefix||'3','sale_price_ars',100,'supplier','zz existente','provided',jsonb_build_array('name','sku','sale_price_ars','supplier')),
    jsonb_build_object('name','ZZ Clavo','sku',c.prefix||'4','sale_price_ars',100,'provided',jsonb_build_array('name','sku','sale_price_ars'))));
  ASSERT (s->>'valid')::int = 4, 'Supplier must not invalidate rows: '||s;
  ASSERT (SELECT count(*) FROM public.product_import_rows r JOIN public.catalog_import_chunks k ON k.batch_id=r.batch_id
    WHERE k.session_id=c.session_id AND 'Proveedor nuevo: se creará al aplicar' = ANY(r.validation_warnings)) = 2, 'New supplier warning missing';
  ASSERT (SELECT count(*) FROM public.suppliers WHERE org_id=c.org_id) = 1, 'Staging created suppliers';
  s := public.approve_catalog_import(c.session_id,false);
  s := public.apply_catalog_import_chunk(c.session_id,0);
  ASSERT s->>'status'='completed' AND (s->>'created')::int=4, 'Apply failed: '||s;
  ASSERT (SELECT count(*) FROM public.suppliers WHERE org_id=c.org_id AND lower(btrim(name))='zz nuevo distribuidor') = 1, 'Supplier duplicated by case/spaces';
  SELECT id INTO v_new FROM public.suppliers WHERE org_id=c.org_id AND lower(btrim(name))='zz nuevo distribuidor';
  ASSERT v_new <> c.foreign_supplier, 'Another tenant supplier was reused';
  ASSERT (SELECT count(*) FROM public.products WHERE org_id=c.org_id AND supplier_id=v_new) = 2, 'New supplier not assigned';
  ASSERT (SELECT supplier_id FROM public.products WHERE org_id=c.org_id AND sku=c.prefix||'3') = c.existing_supplier, 'Existing supplier not matched';
  ASSERT (SELECT supplier_id FROM public.products WHERE org_id=c.org_id AND sku=c.prefix||'4') IS NULL, 'Row without supplier got one';

  -- Una actualización sin columna Proveedor conserva el proveedor actual.
  s := public.start_catalog_import(second,c.org_id,'zz-suppliers-update.xlsx','xlsx','generic',1,1,options);
  s := public.stage_catalog_import_chunk(second,0,jsonb_build_array(
    jsonb_build_object('name','ZZ Tornillo','sku',c.prefix||'1','sale_price_ars',150,'provided',jsonb_build_array('name','sku','sale_price_ars'))));
  s := public.approve_catalog_import(second,false);
  s := public.apply_catalog_import_chunk(second,0);
  ASSERT (SELECT supplier_id FROM public.products WHERE org_id=c.org_id AND sku=c.prefix||'1') = v_new, 'Update without supplier column cleared it';

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',c.viewer_id,'role','authenticated')::text,true);
  ASSERT (SELECT count(*) FROM public.product_import_rows WHERE org_id=c.org_id)=0, 'Viewer can read staged rows';
  RAISE NOTICE 'OK: supplier match/create, case-insensitive, tenant isolation, update keeps supplier';
END;
$$;
RESET ROLE;
DO $$ BEGIN
  ASSERT NOT has_function_privilege('authenticated','public.product_import_assign_supplier()','EXECUTE'), 'Trigger function exposed';
  ASSERT (SELECT count(*) FROM public.audit_funciones_expuestas)=0, 'Unreviewed exposed functions';
END; $$;
ROLLBACK;
SELECT count(*) AS remaining_synthetic_organizations FROM public.organizations WHERE slug LIKE 'zz-supplier-%';
