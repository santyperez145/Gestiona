-- Preview-only, reversible and self-contained. Requires no existing accounts.
-- All users, organizations, products and attributes are synthetic ZZ fixtures.
-- No passwords/login sessions, emails, sales, money movement or provider calls.
-- Apply the reviewed migration first; never grant privileges from this drill.
BEGIN;
SET LOCAL statement_timeout = '90s';

DO $preview_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM public.organizations) THEN
    RAISE EXCEPTION 'Preview-only permissions drill requires zero Auth users/organizations';
  END IF;
END;
$preview_guard$;

CREATE TEMP TABLE zz_catalog_permission_context(
  owner_id uuid, actor_id uuid, org_id uuid, foreign_org_id uuid,
  type_id uuid, foreign_type_id uuid, definition_id uuid, second_definition_id uuid, foreign_definition_id uuid,
  product_id uuid, actor_product_id uuid, foreign_product_id uuid, value_id uuid
) ON COMMIT DROP;
CREATE TEMP TABLE zz_catalog_permission_checks(check_name text) ON COMMIT DROP;
GRANT SELECT ON zz_catalog_permission_context TO authenticated, service_role;
GRANT SELECT, INSERT ON zz_catalog_permission_checks TO authenticated, service_role;

DO $fixtures$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_foreign uuid := gen_random_uuid();
  v_type uuid := gen_random_uuid();
  v_foreign_type uuid := gen_random_uuid();
  v_definition uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_foreign_definition uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_actor_product uuid := gen_random_uuid();
  v_foreign_product uuid := gen_random_uuid();
  v_value uuid := gen_random_uuid();
  v_table regclass;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['public.product_types'::regclass,'public.attribute_definitions'::regclass,'public.product_attribute_values'::regclass]
  LOOP
    IF NOT has_table_privilege('authenticated',v_table,'SELECT')
       OR NOT has_table_privilege('authenticated',v_table,'INSERT')
       OR NOT has_table_privilege('authenticated',v_table,'UPDATE')
       OR NOT has_table_privilege('authenticated',v_table,'DELETE')
       OR has_table_privilege('authenticated',v_table,'TRUNCATE')
       OR has_table_privilege('authenticated',v_table,'REFERENCES')
       OR has_table_privilege('authenticated',v_table,'TRIGGER')
       OR has_table_privilege('anon',v_table,'SELECT') THEN
      RAISE EXCEPTION 'Catalog ACL was not hardened by the migration: %',v_table;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated','public.catalog_attribute_org_immutable()','EXECUTE') THEN
    RAISE EXCEPTION 'Catalog trigger helper is exposed to browser callers';
  END IF;

  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (v_owner,'zz-catalog-permissions-' || v_owner || '@example.invalid','{"account_type":"store_customer","full_name":"ZZ Catalog owner","catalog_permission_fixture":"20261009"}'),
    (v_actor,'zz-catalog-permissions-' || v_actor || '@example.invalid','{"account_type":"store_customer","full_name":"ZZ Catalog actor","catalog_permission_fixture":"20261009"}');
  IF EXISTS(SELECT 1 FROM public.memberships WHERE user_id IN(v_owner,v_actor)) THEN
    RAISE EXCEPTION 'store_customer fixture created an unintended SaaS workspace';
  END IF;
  INSERT INTO public.organizations(id,name,slug,owner_user_id) VALUES
    (v_org,'ZZ Catalog permissions own','zz-cat-perm-own-' || v_org,v_owner),
    (v_foreign,'ZZ Catalog permissions foreign','zz-cat-perm-other-' || v_foreign,v_owner);
  INSERT INTO public.memberships(org_id,user_id,role) VALUES
    (v_org,v_owner,'owner'),(v_org,v_actor,'viewer'),(v_foreign,v_owner,'owner');
  PERFORM public.seed_default_permissions(v_org);
  PERFORM public.seed_default_permissions(v_foreign);
  UPDATE public.role_permissions SET can_view=true,can_create=false,can_edit=false,can_delete=false
  WHERE org_id=v_org AND role='viewer' AND module='products';
  UPDATE public.role_permissions SET can_create=false
  WHERE org_id=v_org AND role='viewer' AND module='sales';
  UPDATE public.role_permissions SET can_view=true,can_create=false,can_edit=true,can_delete=false
  WHERE org_id IN(v_org,v_foreign) AND role='vendedor' AND module='products';
  UPDATE public.role_permissions SET can_create=false
  WHERE org_id=v_org AND role='vendedor' AND module='sales';

  INSERT INTO public.product_types(id,org_id,name,slug) VALUES
    (v_type,v_org,'ZZ Own type','zz-permission-own'),
    (v_foreign_type,v_foreign,'ZZ Foreign type','zz-permission-foreign');
  INSERT INTO public.attribute_definitions(id,org_id,product_type_id,name,slug,data_type) VALUES
    (v_definition,v_org,v_type,'ZZ Own attribute','zz-main','text'),
    (v_second,v_org,v_type,'ZZ Second attribute','zz-second','text'),
    (v_foreign_definition,v_foreign,v_foreign_type,'ZZ Foreign attribute','zz-foreign','text');
  INSERT INTO public.products(id,org_id,user_id,name,sale_price_ars,cost_currency,cost_ars,cost_usd,total_cost_usd,stock,product_type_id) VALUES
    (v_product,v_org,v_owner,'ZZ Attribute permission product',100,'ARS',50,0,0,0,v_type),
    (v_actor_product,v_org,v_actor,'ZZ Actor-created attribute product',100,'ARS',50,0,0,0,v_type),
    (v_foreign_product,v_foreign,v_owner,'ZZ Foreign attribute permission product',100,'ARS',50,0,0,0,v_foreign_type);
  INSERT INTO public.product_attribute_values(id,org_id,product_id,attribute_definition_id,value_text)
  VALUES(v_value,v_org,v_product,v_definition,'ZZ Original value');
  INSERT INTO zz_catalog_permission_context VALUES(v_owner,v_actor,v_org,v_foreign,v_type,v_foreign_type,v_definition,v_second,v_foreign_definition,v_product,v_actor_product,v_foreign_product,v_value);
END;
$fixtures$;

-- A forged service_role JWT claim does not change the actual database role.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','service_role')::text,true)
FROM zz_catalog_permission_context;
SET LOCAL ROLE authenticated;
DO $viewer$
DECLARE
  v_ctx record;
  v_target record;
  v_count integer;
  v_blocked boolean;
BEGIN
  IF current_user <> 'authenticated' THEN RAISE EXCEPTION 'Viewer proof is not running as authenticated'; END IF;
  SELECT * INTO v_ctx FROM zz_catalog_permission_context;
  IF (SELECT count(*) FROM public.product_types WHERE org_id=v_ctx.org_id) <> 1
     OR (SELECT count(*) FROM public.attribute_definitions WHERE org_id=v_ctx.org_id) <> 2
     OR (SELECT count(*) FROM public.product_attribute_values WHERE org_id=v_ctx.org_id) <> 1
     OR EXISTS(SELECT 1 FROM public.product_types WHERE org_id=v_ctx.foreign_org_id) THEN
    RAISE EXCEPTION 'Viewer read policy lost own data or exposed the foreign tenant';
  END IF;
  v_blocked := false;
  BEGIN
    INSERT INTO public.product_types(org_id,name,slug) VALUES(v_ctx.org_id,'ZZ forbidden','zz-viewer-forbidden');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Viewer inserted a product type'; END IF;
  v_blocked := false;
  BEGIN
    INSERT INTO public.attribute_definitions(org_id,product_type_id,name,slug,data_type)
    VALUES(v_ctx.org_id,v_ctx.type_id,'ZZ forbidden','zz-viewer-forbidden','text');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Viewer inserted an attribute definition'; END IF;
  v_blocked := false;
  BEGIN
    INSERT INTO public.product_attribute_values(org_id,product_id,attribute_definition_id,value_text)
    VALUES(v_ctx.org_id,v_ctx.product_id,v_ctx.second_definition_id,'ZZ forbidden');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Viewer inserted an attribute value'; END IF;
  FOR v_target IN SELECT * FROM (VALUES
    ('product_types',v_ctx.type_id,'name'),
    ('attribute_definitions',v_ctx.definition_id,'name'),
    ('product_attribute_values',v_ctx.value_id,'value_text')
  ) AS target(table_name,row_id,column_name)
  LOOP
    EXECUTE format('UPDATE public.%I SET %I=$1 WHERE id=$2',v_target.table_name,v_target.column_name)
      USING 'ZZ forbidden update',v_target.row_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 0 THEN RAISE EXCEPTION 'Viewer updated %',v_target.table_name; END IF;
    EXECUTE format('DELETE FROM public.%I WHERE id=$1',v_target.table_name) USING v_target.row_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 0 THEN RAISE EXCEPTION 'Viewer deleted %',v_target.table_name; END IF;
  END LOOP;
  INSERT INTO zz_catalog_permission_checks VALUES('viewer: own read, foreign hidden, no insert/update/delete, forged service claim cannot bypass');
END;
$viewer$;
RESET ROLE;

DO $make_editor$
DECLARE v_ctx record;
BEGIN
  SELECT * INTO v_ctx FROM zz_catalog_permission_context;
  -- Preparación técnica por el owner: el límite de plan de la membresía
  -- mantiene su guarda normal, también durante este ensayo reversible.
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub',v_ctx.owner_id,'role','authenticated')::text,true);
  UPDATE public.memberships SET role='vendedor' WHERE org_id=v_ctx.org_id AND user_id=v_ctx.actor_id;
  -- Both memberships have edit, so rejection of org_id movement proves the
  -- identity guard, not just lack of permission in the destination tenant.
  INSERT INTO public.memberships(org_id,user_id,role) VALUES(v_ctx.foreign_org_id,v_ctx.actor_id,'vendedor');
END;
$make_editor$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','authenticated')::text,true)
FROM zz_catalog_permission_context;
SET LOCAL ROLE authenticated;
DO $editor$
DECLARE
  v_ctx record;
  v_type uuid := gen_random_uuid();
  v_definition uuid := gen_random_uuid();
  v_target record;
  v_count integer;
  v_blocked boolean;
BEGIN
  SELECT * INTO v_ctx FROM zz_catalog_permission_context;
  IF current_user <> 'authenticated' OR NOT public.has_permission(v_ctx.org_id,'products','edit')
     OR NOT public.has_permission(v_ctx.foreign_org_id,'products','edit') THEN
    RAISE EXCEPTION 'Editor fixture lacks its explicit module permissions';
  END IF;
  INSERT INTO public.product_types(id,org_id,name,slug) VALUES(v_type,v_ctx.org_id,'ZZ Editor type','zz-editor-created');
  INSERT INTO public.attribute_definitions(id,org_id,product_type_id,name,slug,data_type)
    VALUES(v_definition,v_ctx.org_id,v_type,'ZZ Editor attribute','zz-editor-created','text');
  UPDATE public.product_types SET name='ZZ Editor updated' WHERE id=v_type;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Editor cannot update a type'; END IF;
  UPDATE public.attribute_definitions SET name='ZZ Editor updated' WHERE id=v_definition;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Editor cannot update a definition'; END IF;
  DELETE FROM public.attribute_definitions WHERE id=v_definition;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Editor cannot delete a definition'; END IF;
  DELETE FROM public.product_types WHERE id=v_type;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Editor cannot delete a type'; END IF;
  UPDATE public.product_attribute_values SET value_text='ZZ Editor updated',org_id=v_ctx.org_id WHERE id=v_ctx.value_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Editor cannot update a value with unchanged org_id'; END IF;
  DELETE FROM public.product_attribute_values WHERE id=v_ctx.value_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Editor cannot delete a value'; END IF;
  INSERT INTO public.product_attribute_values(id,org_id,product_id,attribute_definition_id,value_text)
    VALUES(v_ctx.value_id,v_ctx.org_id,v_ctx.product_id,v_ctx.definition_id,'ZZ Editor restored');

  FOR v_target IN SELECT * FROM (VALUES
    ('product_types',v_ctx.type_id),('attribute_definitions',v_ctx.definition_id),('product_attribute_values',v_ctx.value_id)
  ) AS target(table_name,row_id)
  LOOP
    v_blocked := false;
    BEGIN
      EXECUTE format('UPDATE public.%I SET org_id=$1 WHERE id=$2',v_target.table_name)
        USING v_ctx.foreign_org_id,v_target.row_id;
    EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Editor moved % between authorized tenants',v_target.table_name; END IF;
  END LOOP;
  v_blocked := false;
  BEGIN
    INSERT INTO public.attribute_definitions(org_id,product_type_id,name,slug,data_type)
      VALUES(v_ctx.org_id,v_ctx.foreign_type_id,'ZZ Foreign parent','zz-foreign-parent','text');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Editor attached a definition to a foreign tenant type'; END IF;
  v_blocked := false;
  BEGIN
    UPDATE public.attribute_definitions SET product_type_id=v_ctx.foreign_type_id WHERE id=v_ctx.definition_id;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Editor reassigned an existing definition to a foreign parent'; END IF;
  INSERT INTO zz_catalog_permission_checks VALUES('editor: schema/value CRUD succeeds, same-org upsert compatible, org movement and foreign parent denied even with two edit memberships');
END;
$editor$;
RESET ROLE;

UPDATE public.role_permissions SET can_edit=false,can_create=true
WHERE org_id IN(SELECT org_id FROM zz_catalog_permission_context UNION ALL SELECT foreign_org_id FROM zz_catalog_permission_context) AND role='vendedor' AND module='products';
SET LOCAL ROLE authenticated;
DO $creator$
DECLARE v_ctx record; v_count integer; v_blocked boolean := false;
BEGIN
  SELECT * INTO v_ctx FROM zz_catalog_permission_context;
  INSERT INTO public.product_attribute_values(org_id,product_id,attribute_definition_id,value_text)
    VALUES(v_ctx.org_id,v_ctx.actor_product_id,v_ctx.second_definition_id,'ZZ Created value');
  UPDATE public.product_attribute_values SET value_text='ZZ forbidden creator update'
    WHERE product_id=v_ctx.actor_product_id AND attribute_definition_id=v_ctx.second_definition_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Create-only actor updated a value'; END IF;
  DELETE FROM public.product_attribute_values
    WHERE product_id=v_ctx.actor_product_id AND attribute_definition_id=v_ctx.second_definition_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Create-only actor deleted a value'; END IF;
  BEGIN
    INSERT INTO public.product_types(org_id,name,slug) VALUES(v_ctx.org_id,'ZZ forbidden creator','zz-forbidden-creator');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'products.create was mistaken for schema edit'; END IF;
  v_blocked := false;
  BEGIN
    INSERT INTO public.product_attribute_values(org_id,product_id,attribute_definition_id,value_text)
      VALUES(v_ctx.org_id,v_ctx.product_id,v_ctx.second_definition_id,'ZZ forbidden existing owner product');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Create-only actor added a value to another author product'; END IF;
  v_blocked := false;
  BEGIN
    INSERT INTO public.product_attribute_values(org_id,product_id,attribute_definition_id,value_text)
      VALUES(v_ctx.foreign_org_id,v_ctx.foreign_product_id,v_ctx.foreign_definition_id,'ZZ forbidden foreign product');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Create-only actor added a value to another author foreign tenant product'; END IF;
  INSERT INTO zz_catalog_permission_checks VALUES('create-only: inserts initial values on its own product only; cannot add to other author or foreign products, update/delete values or configure schema');
END;
$creator$;
RESET ROLE;

UPDATE public.role_permissions SET can_view=false,can_create=false,can_edit=false
WHERE org_id=(SELECT org_id FROM zz_catalog_permission_context) AND role='vendedor' AND module='products';
UPDATE public.role_permissions SET can_create=true
WHERE org_id=(SELECT org_id FROM zz_catalog_permission_context) AND role='vendedor' AND module='sales';
SET LOCAL ROLE authenticated;
DO $pos_reader$
DECLARE v_ctx record; v_blocked boolean := false;
BEGIN
  SELECT * INTO v_ctx FROM zz_catalog_permission_context;
  IF public.has_permission(v_ctx.org_id,'products','view')
     OR NOT public.has_permission(v_ctx.org_id,'sales','create')
     OR (SELECT count(*) FROM public.product_types WHERE org_id=v_ctx.org_id) <> 1
     OR (SELECT count(*) FROM public.attribute_definitions WHERE org_id=v_ctx.org_id) <> 2
     OR (SELECT count(*) FROM public.product_attribute_values WHERE org_id=v_ctx.org_id) <> 2 THEN
    RAISE EXCEPTION 'POS seller lost descriptive catalog reads without products.view';
  END IF;
  BEGIN
    INSERT INTO public.product_types(org_id,name,slug) VALUES(v_ctx.org_id,'ZZ forbidden POS','zz-forbidden-pos');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'sales.create granted schema edits'; END IF;
  INSERT INTO zz_catalog_permission_checks VALUES('POS: sales.create preserves descriptive reads, never schema writes');
END;
$pos_reader$;
RESET ROLE;

UPDATE public.role_permissions SET can_create=false
WHERE org_id=(SELECT org_id FROM zz_catalog_permission_context) AND role='vendedor' AND module='sales';
SET LOCAL ROLE authenticated;
DO $revoked$
DECLARE v_ctx record; v_table text; v_count integer; v_blocked boolean := false;
BEGIN
  SELECT * INTO v_ctx FROM zz_catalog_permission_context;
  FOREACH v_table IN ARRAY ARRAY['product_types','attribute_definitions','product_attribute_values'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id=$1',v_table) INTO v_count USING v_ctx.org_id;
    IF v_count <> 0 THEN RAISE EXCEPTION 'Permission revocation still exposes %',v_table; END IF;
  END LOOP;
  BEGIN
    INSERT INTO public.product_types(org_id,name,slug) VALUES(v_ctx.org_id,'ZZ revoked','zz-forbidden-revoked');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Revoked editor retained schema writes'; END IF;
  INSERT INTO zz_catalog_permission_checks VALUES('revocation: existing membership alone grants no read or schema insert');
END;
$revoked$;
RESET ROLE;

UPDATE public.role_permissions SET can_view=true,can_create=true,can_edit=true
WHERE org_id=(SELECT org_id FROM zz_catalog_permission_context) AND role='vendedor' AND module='products';
UPDATE public.memberships SET suspendido_por_plan=true
WHERE org_id=(SELECT org_id FROM zz_catalog_permission_context) AND user_id=(SELECT actor_id FROM zz_catalog_permission_context);
SET LOCAL ROLE authenticated;
DO $suspended$
DECLARE v_ctx record; v_table text; v_count integer; v_blocked boolean := false;
BEGIN
  SELECT * INTO v_ctx FROM zz_catalog_permission_context;
  IF NOT public.has_permission(v_ctx.org_id,'products','edit') OR public.is_org_member(v_ctx.org_id,v_ctx.actor_id) THEN
    RAISE EXCEPTION 'Suspension fixture does not expose the helper/active-membership distinction';
  END IF;
  FOREACH v_table IN ARRAY ARRAY['product_types','attribute_definitions','product_attribute_values'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE org_id=$1',v_table) INTO v_count USING v_ctx.org_id;
    IF v_count <> 0 THEN RAISE EXCEPTION 'Suspended member can read %',v_table; END IF;
  END LOOP;
  BEGIN
    INSERT INTO public.product_types(org_id,name,slug) VALUES(v_ctx.org_id,'ZZ suspended','zz-forbidden-suspended');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Suspended member retained writes through a permission override'; END IF;
  INSERT INTO zz_catalog_permission_checks VALUES('suspension: active-member guard denies access even when has_permission override is true');
END;
$suspended$;
RESET ROLE;

-- Actual PostgreSQL service_role, with a claim that supplies no tenant member.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
SET LOCAL ROLE service_role;
DO $server$
DECLARE v_ctx record; v_new uuid := gen_random_uuid(); v_count integer; v_blocked boolean := false;
BEGIN
  SELECT * INTO v_ctx FROM zz_catalog_permission_context;
  IF current_user <> 'service_role' OR public.is_org_member(v_ctx.org_id,auth.uid()) THEN
    RAISE EXCEPTION 'Service proof is not the real server role without a membership';
  END IF;
  IF (SELECT count(*) FROM public.product_types WHERE org_id IN(v_ctx.org_id,v_ctx.foreign_org_id)) <> 2 THEN
    RAISE EXCEPTION 'The real service role lost its internal catalog reads';
  END IF;
  INSERT INTO public.product_types(id,org_id,name,slug) VALUES(v_new,v_ctx.foreign_org_id,'ZZ Server type','zz-server-only');
  UPDATE public.product_attribute_values SET value_text='ZZ Server retained access' WHERE id=v_ctx.value_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'The real service role lost its internal typed-value writes'; END IF;
  DELETE FROM public.product_types WHERE id=v_new;
  BEGIN
    UPDATE public.product_types SET org_id=v_ctx.foreign_org_id WHERE id=v_ctx.type_id;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Real service role bypassed immutable catalog tenant identity'; END IF;
  INSERT INTO zz_catalog_permission_checks VALUES('server: only actual PostgreSQL service_role bypasses RLS; no privileged JWT claim bypass; immutable tenant identity still enforced');
END;
$server$;
RESET ROLE;

SELECT check_name FROM zz_catalog_permission_checks ORDER BY check_name;
ROLLBACK;

SELECT 'catalog permission role drill passed' AS proof,
  (SELECT count(*) FROM auth.users WHERE raw_user_meta_data->>'catalog_permission_fixture'='20261009') AS residual_fixture_users,
  (SELECT count(*) FROM public.organizations WHERE slug LIKE 'zz-cat-perm-%') AS residual_fixture_orgs;
