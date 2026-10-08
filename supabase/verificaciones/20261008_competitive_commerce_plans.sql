-- Real roles, synthetic tenants and rollback. No provider payment or merchant data mutation.
BEGIN;
CREATE TEMP TABLE zz_plan_context(org_id uuid, other_org uuid, owner_id uuid, admin_id uuid, viewer_id uuid, trial_id uuid, paid_id uuid);
DO $$
DECLARE o uuid := gen_random_uuid(); other_o uuid := gen_random_uuid(); owner_u uuid; admin_u uuid; viewer_u uuid; trial_p uuid; paid_p uuid;
BEGIN
  SELECT user_id INTO owner_u FROM public.memberships WHERE role = 'owner' ORDER BY created_at LIMIT 1;
  SELECT id INTO admin_u FROM auth.users WHERE id <> owner_u ORDER BY created_at LIMIT 1;
  SELECT id INTO viewer_u FROM auth.users WHERE id NOT IN (owner_u, admin_u) ORDER BY created_at LIMIT 1;
  ASSERT owner_u IS NOT NULL AND admin_u IS NOT NULL AND viewer_u IS NOT NULL, 'Three existing identities required';
  SELECT id INTO trial_p FROM public.plans WHERE code = 'trial';
  SELECT id INTO paid_p FROM public.plans WHERE code = 'starter';
  ASSERT (SELECT count(*) = 4 FROM public.plans WHERE code IN ('trial','starter','pro','business') AND max_products IS NULL AND max_sales_per_month IS NULL AND max_users IS NULL);
  ASSERT (SELECT bool_and(price_ars_yearly = price_ars_monthly * 9) FROM public.plans WHERE code IN ('starter','pro','business'));
  INSERT INTO public.organizations(id,name,slug,owner_user_id,plan_id,trial_ends_at)
    VALUES(o,'ZZ Competitive plan','zz-plan-'||o,owner_u,trial_p,now()+interval '14 days'),
      (other_o,'ZZ Competitive other','zz-plan-'||other_o,admin_u,trial_p,now()+interval '14 days');
  INSERT INTO public.memberships(org_id,user_id,role)
    VALUES(o,owner_u,'owner'),(o,admin_u,'admin'),(o,viewer_u,'viewer'),(other_o,admin_u,'owner');
  INSERT INTO public.subscriptions(org_id,plan_id,status,current_period_end,precio_ars)
    VALUES(o,trial_p,'trialing',now()+interval '14 days',12345);
  INSERT INTO zz_plan_context VALUES(o,other_o,owner_u,admin_u,viewer_u,trial_p,paid_p);
END $$;
GRANT SELECT ON zz_plan_context TO authenticated;
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',owner_id,'role','authenticated')::text, true) FROM zz_plan_context;
SET LOCAL ROLE authenticated;
DO $$ DECLARE c record; e jsonb; denied boolean := false; BEGIN
  SELECT * INTO c FROM zz_plan_context;
  e := public.org_entitlements(c.org_id);
  ASSERT (e->>'ia')::boolean AND (e->>'ia_cupo_mensual')::int = 100, 'Trial quota missing';
  ASSERT e->'max_products' = 'null'::jsonb AND e->'max_users' = 'null'::jsonb AND e->'max_sales_per_month' = 'null'::jsonb, 'Trial core capped';
  BEGIN PERFORM public.org_entitlements(c.other_org); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'Cross-tenant entitlement leak';
END $$;
RESET ROLE;
UPDATE public.organizations SET trial_ends_at = now()-interval '1 day' WHERE id IN (SELECT org_id FROM zz_plan_context);
SET LOCAL ROLE authenticated;
DO $$ DECLARE c record; e jsonb; BEGIN
  SELECT * INTO c FROM zz_plan_context;
  e := public.org_entitlements(c.org_id);
  ASSERT NOT (e->>'ia')::boolean AND NOT (e->>'backups')::boolean AND NOT (e->>'branding')::boolean, 'Expired trial retains premium';
  ASSERT e->>'motivo_de_corte' = 'prueba_finalizada', 'Cron must not be required to expire extras';
  ASSERT e->'max_products' = 'null'::jsonb AND e->'max_users' = 'null'::jsonb AND e->'max_sales_per_month' = 'null'::jsonb, 'Expired trial caps commerce';
  ASSERT (e->>'ia_restante')::int = 0, 'Expired trial keeps AI allowance';
END $$;
RESET ROLE;
UPDATE public.subscriptions SET status='past_due', current_period_end=now()-interval '9 days' WHERE org_id IN (SELECT org_id FROM zz_plan_context);
SET LOCAL ROLE authenticated;
DO $$ DECLARE e jsonb; BEGIN
  e := public.org_entitlements((SELECT org_id FROM zz_plan_context));
  ASSERT e->>'motivo_de_corte'='prueba_finalizada', 'Hourly cron must not turn a free trial into unpaid debt';
  ASSERT NOT (e->>'ia')::boolean AND (e->>'commerce_gratuito')::boolean, 'Aged free trial state wrong';
END $$;
RESET ROLE;
UPDATE public.subscriptions s SET plan_id=c.paid_id, status='active', current_period_end=now()+interval '20 days' FROM zz_plan_context c WHERE s.org_id=c.org_id;
SET LOCAL ROLE authenticated;
DO $$ DECLARE c record; e jsonb; BEGIN
  SELECT * INTO c FROM zz_plan_context; e := public.org_entitlements(c.org_id);
  ASSERT (e->>'ia')::boolean AND (e->>'ia_cupo_mensual')::int=300, 'Paid extras not restored';
  ASSERT (SELECT precio_ars=12345 FROM public.subscriptions WHERE org_id=c.org_id), 'Contracted amount overwritten';
END $$;
RESET ROLE;
UPDATE public.subscriptions SET status='past_due', current_period_end=now()-interval '2 days' WHERE org_id IN (SELECT org_id FROM zz_plan_context);
SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT (public.org_entitlements((SELECT org_id FROM zz_plan_context))->>'ia')::boolean, 'Paid grace lost'; END $$;
RESET ROLE;
UPDATE public.subscriptions SET current_period_end=now()-interval '30 days' WHERE org_id IN (SELECT org_id FROM zz_plan_context);
SET LOCAL ROLE authenticated;
DO $$ DECLARE e jsonb; BEGIN
  e := public.org_entitlements((SELECT org_id FROM zz_plan_context));
  ASSERT NOT (e->>'ia')::boolean AND (e->>'commerce_gratuito')::boolean, 'Expired paid status wrong';
  ASSERT e->>'motivo_de_corte'='impago', 'Paid debt must retain its own notice';
  ASSERT e->'max_products'='null'::jsonb AND e->'max_users'='null'::jsonb AND e->'max_sales_per_month'='null'::jsonb, 'Past due commerce restricted';
END $$;
RESET ROLE;
UPDATE public.subscriptions SET current_period_end=NULL, created_at=now()-interval '2 hours' WHERE org_id IN (SELECT org_id FROM zz_plan_context);
SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT NOT (public.org_entitlements((SELECT org_id FROM zz_plan_context))->>'ia')::boolean, 'Unpaid checkout grants premium'; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',admin_id,'role','authenticated')::text,true) FROM zz_plan_context;
SET LOCAL ROLE authenticated;
DO $$ BEGIN ASSERT (public.org_entitlements((SELECT org_id FROM zz_plan_context))->>'commerce_gratuito')::boolean; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',viewer_id,'role','authenticated')::text,true) FROM zz_plan_context;
SET LOCAL ROLE authenticated;
DO $$ DECLARE denied boolean := false; BEGIN
  ASSERT (public.org_entitlements((SELECT org_id FROM zz_plan_context))->>'commerce_gratuito')::boolean;
  BEGIN PERFORM public.org_entitlements((SELECT other_org FROM zz_plan_context)); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  ASSERT denied, 'Viewer reads another organization';
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon','public.org_entitlements(uuid)','EXECUTE'), 'Anonymous reads private entitlements';
END $$;
DELETE FROM public.organizations WHERE id IN (SELECT org_id FROM zz_plan_context UNION SELECT other_org FROM zz_plan_context);
SELECT count(*) AS zz_residue FROM public.organizations WHERE slug IN (SELECT 'zz-plan-'||org_id FROM zz_plan_context UNION SELECT 'zz-plan-'||other_org FROM zz_plan_context);
ROLLBACK;
