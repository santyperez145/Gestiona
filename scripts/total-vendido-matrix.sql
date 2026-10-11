-- Matriz reversible de 20261011001300 (total vendido al día).
--   node scripts/db.mjs --file scripts/total-vendido-matrix.sql --allow-destructive
-- En una organización ZZ: vender 3 y 0,5 (cuenta 1) suma 4; devolver 1 deja
-- 3; mover una venta a otro producto pasa sus unidades; borrar la venta las
-- resta; nunca baja de 0. Después, el contador de cada producto real coincide
-- con sus ventas. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_tv (caso text, valor text) ON COMMIT DROP;

DO $d$
DECLARE v_owner uuid; v_org uuid; v_a uuid; v_b uuid; v_s1 uuid; v_s2 uuid; v_n int;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ vendido', 'zz-vendido-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, unidad_medida) VALUES (v_org, v_owner, 'ZZ A', 100, 50, 'kg') RETURNING id INTO v_a;
  INSERT INTO public.products (org_id, user_id, name, sale_price_ars, stock, unidad_medida) VALUES (v_org, v_owner, 'ZZ B', 100, 50, 'kg') RETURNING id INTO v_b;

  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, paid)
    VALUES (v_org, v_owner, v_a, 'ZZ A', 3, 100, 300, true) RETURNING id INTO v_s1;
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, paid)
    VALUES (v_org, v_owner, v_a, 'ZZ A', 0.5, 100, 50, true) RETURNING id INTO v_s2;
  INSERT INTO zz_tv SELECT 'vende 3 y 0,5 → 4', total_sold::text FROM public.products WHERE id = v_a;

  UPDATE public.sales SET returned_quantity = 1 WHERE id = v_s1;
  INSERT INTO zz_tv SELECT 'devuelve 1 → 3', total_sold::text FROM public.products WHERE id = v_a;

  UPDATE public.sales SET product_id = v_b WHERE id = v_s2;
  INSERT INTO zz_tv SELECT 'mueve la venta de 0,5 a B → A 2 / B 1', (SELECT total_sold FROM public.products WHERE id = v_a) || ' / ' || (SELECT total_sold FROM public.products WHERE id = v_b);

  DELETE FROM public.sales WHERE id = v_s2;
  INSERT INTO zz_tv SELECT 'borra la venta de B → 0', total_sold::text FROM public.products WHERE id = v_b;

  UPDATE public.products SET total_sold = 0 WHERE id = v_a;
  DELETE FROM public.sales WHERE id = v_s1;
  INSERT INTO zz_tv SELECT 'nunca baja de 0', total_sold::text FROM public.products WHERE id = v_a;

  SELECT count(*) INTO v_n FROM public.products p
  WHERE p.org_id <> v_org AND coalesce(p.total_sold, 0) <> coalesce((
    SELECT sum(public._unidades_de_venta(s.quantity, s.returned_quantity)) FROM public.sales s WHERE s.product_id = p.id), 0);
  INSERT INTO zz_tv VALUES ('productos reales con contador distinto a sus ventas (0)', v_n::text);
END $d$;

SELECT * FROM zz_tv;
ROLLBACK;
