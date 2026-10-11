-- Matriz reversible de 20261011000900 (el aviso sale solo al vincular).
--   node scripts/db.mjs --file scripts/aviso-busqueda-automatico-matrix.sql --allow-destructive
-- Dos clientes piden aviso por «amoladora» y uno por «taladro» en una tienda
-- ZZ; uno de ellos ya esperaba el producto. El dueño vincula «amoladora» a
-- un producto: los dos pasan a esperar ese producto (sin duplicar), salen de
-- la lista y «taladro» queda. Sin stock no aparecen como pendientes de envío;
-- con stock, sí. Otro comercio no se toca. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_aa (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_aa TO anon, authenticated;

DO $d$
DECLARE v_owner uuid; v_org uuid; v_org2 uuid; v_store uuid; v_store2 uuid; v_p uuid; v_tienda text; v_tienda2 text; v_n int;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  v_tienda := 'zz-auto-' || substr(md5(random()::text), 1, 8);
  v_tienda2 := 'zz-auto2-' || substr(md5(random()::text), 1, 8);
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ auto', 'zz-auto-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ auto2', 'zz-auto2-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active) VALUES (v_org, v_tienda, 'ZZ tienda', true) RETURNING id INTO v_store;
  INSERT INTO public.ecommerce_stores (org_id, slug, name, is_active) VALUES (v_org2, v_tienda2, 'ZZ tienda 2', true) RETURNING id INTO v_store2;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, is_active) VALUES (v_org, v_owner, 'ZZ Esmeriladora', 100, 0, true) RETURNING id INTO v_p;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  PERFORM public.pedir_aviso_de_busqueda(v_tienda, 'Amoladora', 'uno@ejemplo.com');
  PERFORM public.pedir_aviso_de_busqueda(v_tienda, 'amoladora', 'dos@ejemplo.com');
  PERFORM public.pedir_aviso_de_busqueda(v_tienda, 'taladro', 'uno@ejemplo.com');
  PERFORM public.pedir_aviso_de_busqueda(v_tienda2, 'amoladora', 'ajeno@ejemplo.com');
  PERFORM public.request_stock_alert(v_tienda, v_p, 'dos@ejemplo.com', NULL);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.store_search_synonyms (org_id, termino, product_id) VALUES (v_org, 'amoladora', v_p);
  RESET ROLE;

  INSERT INTO zz_aa SELECT 'esperan el producto (2, sin duplicar)', count(*)::text || ' ' || string_agg(email, ', ' ORDER BY email)
    FROM public.store_stock_alerts WHERE product_id = v_p;
  INSERT INTO zz_aa SELECT 'quedan en la lista (taladro)', string_agg(termino, ', ')
    FROM public.store_avisos_de_busqueda WHERE org_id = v_org;
  INSERT INTO zz_aa SELECT 'otro comercio intacto (1)', count(*)::text
    FROM public.store_avisos_de_busqueda WHERE org_id = v_org2;
  SELECT count(*) INTO v_n FROM public.pending_stock_alerts() x WHERE x.product_id = v_p;
  INSERT INTO zz_aa VALUES ('sin stock: nada para enviar (0)', v_n::text);
  UPDATE public.products SET stock = 3 WHERE id = v_p;
  SELECT count(*) INTO v_n FROM public.pending_stock_alerts() x WHERE x.product_id = v_p;
  INSERT INTO zz_aa VALUES ('con stock: listos para enviar (2)', v_n::text);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public._avisos_de_busqueda_a_stock();
    RESET ROLE;
    INSERT INTO zz_aa VALUES ('la función interna se llama directo', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
    RESET ROLE;
    INSERT INTO zz_aa VALUES ('la función interna se llama directo', 'rechazado');
  END;
END $d$;

SELECT * FROM zz_aa;
ROLLBACK;
