-- Matriz reversible de 20261011000600 (sinónimos de búsqueda).
--   node scripts/db.mjs --file scripts/sinonimos-busqueda-matrix.sql
-- El dueño vincula un término a su producto; no puede vincularlo a un
-- producto de otro comercio; un anónimo lee los sinónimos por la tienda pero
-- no la tabla; un producto inactivo no sale; un usuario de sólo lectura no
-- vincula (el vendedor sí: tiene permiso de editar la tienda). Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_sn (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_sn TO anon, authenticated;

DO $d$
DECLARE v_owner uuid; v_vend uuid; v_org uuid; v_otro uuid; v_p uuid; v_inactivo uuid; v_ajeno uuid; v_tienda text; v_r jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  v_tienda := 'zz-sin-' || substr(md5(random()::text), 1, 8);
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ sinonimos', 'zz-sinonimos-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ otro', 'zz-otro-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_otro;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_vend, 'viewer') ON CONFLICT DO NOTHING;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active) VALUES (v_org, v_tienda, 'ZZ tienda', true);
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars) VALUES (v_org, v_owner, 'ZZ Esmeriladora 115', 100) RETURNING id INTO v_p;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, is_active) VALUES (v_org, v_owner, 'ZZ inactivo', 100, false) RETURNING id INTO v_inactivo;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars) VALUES (v_otro, v_owner, 'ZZ ajeno', 100) RETURNING id INTO v_ajeno;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.store_search_synonyms (org_id, termino, product_id) VALUES (v_org, 'amoladora', v_p), (v_org, 'zz viejo', v_inactivo);
  BEGIN
    INSERT INTO public.store_search_synonyms (org_id, termino, product_id) VALUES (v_org, 'ajeno', v_ajeno);
    INSERT INTO zz_sn VALUES ('vincular a producto de otro comercio', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_sn VALUES ('vincular a producto de otro comercio', 'rechazado');
  END;
  BEGIN
    INSERT INTO public.store_search_synonyms (org_id, termino, product_id) VALUES (v_org, 'Con Tilde é', v_p);
    INSERT INTO zz_sn VALUES ('término sin normalizar', 'PASÓ (mal)');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO zz_sn VALUES ('término sin normalizar', 'rechazado');
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.store_search_synonyms (org_id, termino, product_id) VALUES (v_org, 'lector', v_p);
    INSERT INTO zz_sn VALUES ('sólo lectura vincula', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_sn VALUES ('sólo lectura vincula', 'rechazado');
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  v_r := public.get_store_search_synonyms(upper(v_tienda));
  INSERT INTO zz_sn VALUES ('la tienda lee sus sinónimos activos (1: amoladora)', jsonb_array_length(v_r)::text || ': ' || (v_r->0->>'termino'));
  INSERT INTO zz_sn VALUES ('apunta al producto (sí)', CASE WHEN v_r->0->>'product_id' = v_p::text THEN 'sí' ELSE 'no' END);
  BEGIN
    PERFORM count(*) FROM public.store_search_synonyms;
    INSERT INTO zz_sn VALUES ('el anónimo lee la tabla', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO zz_sn VALUES ('el anónimo lee la tabla', 'rechazado');
  END;
  INSERT INTO zz_sn VALUES ('tienda inexistente (0)', jsonb_array_length(public.get_store_search_synonyms('zz-no-existe'))::text);
  RESET ROLE;
END $d$;

SELECT * FROM zz_sn;
ROLLBACK;
