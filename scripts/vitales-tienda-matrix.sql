-- Matriz reversible de 20261011001000 (Core Web Vitals de la tienda).
--   node scripts/db.mjs --file scripts/vitales-tienda-matrix.sql
-- Un anónimo manda tres páginas vistas de una tienda ZZ: se clasifican con los
-- rangos de Google, un valor absurdo se descarta, una página desconocida cuenta
-- como «otra» y una tienda inexistente no deja filas. El anónimo no lee; el
-- dueño lee; la vista de plataforma rechaza a un usuario común y al admin le
-- da visitas y % buenas. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_cwv (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_cwv TO anon, authenticated;

DO $d$
DECLARE v_admin uuid; v_comun uuid; v_org uuid; v_tienda text; v_n int; v_antes int; v_txt text;
BEGIN
  SELECT id INTO v_admin FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT u.id INTO v_comun FROM auth.users u WHERE u.id <> v_admin AND NOT public.is_platform_admin(u.id) ORDER BY created_at LIMIT 1;
  INSERT INTO public.platform_admins (user_id) VALUES (v_admin) ON CONFLICT DO NOTHING;
  v_tienda := 'zz-cwv-' || substr(md5(random()::text), 1, 8);
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ cwv', 'zz-cwv-' || substr(md5(random()::text), 1, 8), v_admin) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_admin, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active) VALUES (v_org, v_tienda, 'ZZ tienda', true);
  SELECT count(*) INTO v_antes FROM public.store_vitales;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  PERFORM public.registrar_vitales_tienda(v_tienda, 'producto', 1800, 0.05, 150);   -- buenas
  PERFORM public.registrar_vitales_tienda(v_tienda, 'producto', 3200, 0.3, NULL);   -- regular, mala, sin INP
  PERFORM public.registrar_vitales_tienda(v_tienda, 'checkout', 999999, 0.2, 700);  -- LCP absurdo, regular, mala → otra
  PERFORM public.registrar_vitales_tienda('zz-no-existe', 'inicio', 1000, 0, 100);
  BEGIN
    SELECT count(*) INTO v_n FROM public.store_vitales;
    INSERT INTO zz_cwv VALUES ('el anónimo lee', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_cwv VALUES ('el anónimo lee', 'rechazado'); END;
  RESET ROLE;

  SELECT string_agg(pagina || ':' || metrica || '=' || buenas || '/' || regulares || '/' || malas, ' ' ORDER BY pagina, metrica)
    INTO v_txt FROM public.store_vitales WHERE org_id = v_org;
  INSERT INTO zz_cwv VALUES ('clasificación (otra: cls 0/1/0, inp 0/0/1; producto: cls 1/0/1, inp 1/0/0, lcp 1/1/0)', v_txt);
  INSERT INTO zz_cwv SELECT 'tienda inexistente no deja filas (5 nuevas)', (count(*) - v_antes)::text FROM public.store_vitales;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.store_vitales WHERE org_id = v_org;
  INSERT INTO zz_cwv VALUES ('el dueño lee (5)', v_n::text);
  SELECT string_agg(metrica || ' ' || visitas || ' ' || pct_buenas, ', ' ORDER BY metrica) INTO v_txt
    FROM public.platform_vitales_tiendas(28) WHERE org_id = v_org;
  INSERT INTO zz_cwv VALUES ('plataforma (cls 3 33.3, inp 2 50.0, lcp 2 50.0)', v_txt);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_comun, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.platform_vitales_tiendas(28);
    INSERT INTO zz_cwv VALUES ('usuario común ve plataforma', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_cwv VALUES ('usuario común ve plataforma', 'rechazado'); END;
  RESET ROLE;
END $d$;

SELECT * FROM zz_cwv;
ROLLBACK;
