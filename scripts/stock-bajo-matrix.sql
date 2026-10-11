-- Matriz reversible de 20261011001400 (aviso de stock bajo sin ruido).
--   node scripts/db.mjs --file scripts/stock-bajo-matrix.sql
-- En una organización ZZ: un producto que nunca se vendió baja de stock (como
-- en una importación) → sin aviso; una venta lo deja bajo el umbral → un
-- aviso; reponer y volver a bajar con el aviso sin leer → no repite; leído y
-- vuelve a bajar → avisa de nuevo. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_sb (caso text, valor text) ON COMMIT DROP;

DO $d$
DECLARE v_owner uuid; v_org uuid; v_p uuid; v_q uuid;
  avisos int;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ stock bajo', 'zz-stock-bajo-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ importado', 100, 50) RETURNING id INTO v_q;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock) VALUES (v_org, v_owner, 'ZZ vendido', 100, 5) RETURNING id INTO v_p;

  UPDATE public.products SET stock = 0 WHERE id = v_q;
  SELECT count(*) INTO avisos FROM public.notifications WHERE entity_id = v_q::text AND type = 'stock_bajo';
  INSERT INTO zz_sb VALUES ('nunca vendido baja a 0 → 0 avisos', avisos::text);

  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, paid)
    VALUES (v_org, v_owner, v_p, 'ZZ vendido', 3, 100, 300, true);
  SELECT count(*) INTO avisos FROM public.notifications WHERE entity_id = v_p::text AND type = 'stock_bajo';
  INSERT INTO zz_sb VALUES ('venta deja 2 (umbral 3) → 1 aviso', avisos::text);

  UPDATE public.products SET stock = 10 WHERE id = v_p;
  UPDATE public.products SET stock = 1 WHERE id = v_p;
  SELECT count(*) INTO avisos FROM public.notifications WHERE entity_id = v_p::text AND type = 'stock_bajo';
  INSERT INTO zz_sb VALUES ('repone y vuelve a bajar sin leer → sigue 1', avisos::text);

  UPDATE public.notifications SET read = true WHERE entity_id = v_p::text AND type = 'stock_bajo';
  UPDATE public.products SET stock = 10 WHERE id = v_p;
  UPDATE public.products SET stock = 2 WHERE id = v_p;
  SELECT count(*) INTO avisos FROM public.notifications WHERE entity_id = v_p::text AND type = 'stock_bajo';
  INSERT INTO zz_sb VALUES ('leído y vuelve a bajar → 2', avisos::text);
END $d$;

SELECT * FROM zz_sb;
ROLLBACK;
