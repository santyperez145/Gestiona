-- Matriz reversible de 20261010002300 (sello «Hecha con Nerqia»).
--   node scripts/db.mjs --file scripts/sello-nerqia-matrix.sql
-- Tienda ZZ sin plan con marca propia: sello con su ref, para anónimos y para
-- un comprador logueado (sin perder su identidad). Con Starter vigente: sin
-- sello. Tienda inexistente o inactiva: sin sello. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE zz_se (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_se TO anon, authenticated;

DO $d$
DECLARE
  v_owner uuid; v_comprador uuid; v_org uuid; v_slug text; v_tienda text; v_r jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_comprador FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  v_slug := 'zz-sello-' || substr(md5(random()::text), 1, 8);
  v_tienda := 'zz-tienda-' || substr(md5(random()::text), 1, 8);
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ sello', v_slug, v_owner) RETURNING id INTO v_org;
  DELETE FROM public.subscriptions WHERE org_id = v_org;
  UPDATE public.organizations SET plan_id = NULL WHERE id = v_org;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active) VALUES (v_org, v_tienda, 'ZZ tienda', true);

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  v_r := public.marca_nerqia_de_tienda(upper(v_tienda));
  INSERT INTO zz_se VALUES ('anónimo, sin marca propia: sello/ref (true/sí)', (v_r->>'mostrar') || '/' || CASE WHEN v_r->>'ref' = v_slug THEN 'sí' ELSE coalesce(v_r->>'ref', '∅') END);
  v_r := public.marca_nerqia_de_tienda('zz-no-existe');
  INSERT INTO zz_se VALUES ('tienda inexistente (false)', v_r->>'mostrar');
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comprador, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_r := public.marca_nerqia_de_tienda(v_tienda);
  INSERT INTO zz_se VALUES ('comprador logueado ajeno (true)', v_r->>'mostrar');
  INSERT INTO zz_se VALUES ('conserva su identidad (sí)', CASE WHEN auth.uid() = v_comprador THEN 'sí' ELSE 'no' END);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  INSERT INTO public.subscriptions (org_id, plan_id, status, current_period_end)
    SELECT v_org, p.id, 'active', now() + interval '20 days' FROM public.plans p WHERE p.code = 'starter';
  SET LOCAL ROLE anon;
  v_r := public.marca_nerqia_de_tienda(v_tienda);
  INSERT INTO zz_se VALUES ('Starter vigente: sin sello (false)', v_r->>'mostrar');
  RESET ROLE;

  UPDATE public.subscriptions SET status = 'paused' WHERE org_id = v_org;
  UPDATE public.ecommerce_stores SET is_active = false WHERE org_id = v_org;
  SET LOCAL ROLE anon;
  v_r := public.marca_nerqia_de_tienda(v_tienda);
  INSERT INTO zz_se VALUES ('tienda inactiva (false)', v_r->>'mostrar');
  RESET ROLE;
END $d$;

SELECT * FROM zz_se;
ROLLBACK;
