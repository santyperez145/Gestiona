-- Simulacro de 20261014002400 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Una venta cargada a mano sin cobro ni deuda se borra (y el stock vuelve).
--   2. Una venta fiada (con deuda) no se borra.
--   3. Una venta con factura autorizada no se borra.
--   4. Borrar un negocio entero (con una venta fiada) no se frena por esto.
DO $$
DECLARE v_user uuid; v_user2 uuid; v_org uuid; v_org2 uuid; p1 uuid; s1 uuid; s2 uuid; s3 uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  -- Otro usuario para el segundo negocio: las ventas de una misma transacción
  -- y usuario se agrupan en un ticket (assign_sale_transaction).
  SELECT id INTO v_user2 FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ ventas', 'zz-vb-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.products (org_id, user_id, name, stock) VALUES (v_org, v_user, 'ZZ Tornillo', 10) RETURNING id INTO p1;
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, paid)
  VALUES (v_org, v_user, p1, 'ZZ Tornillo', 2, 100, 200, false) RETURNING id INTO s1;
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, paid)
  VALUES (v_org, v_user, p1, 'ZZ Tornillo', 1, 100, 100, false) RETURNING id INTO s2;
  INSERT INTO public.sales (org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, paid)
  VALUES (v_org, v_user, p1, 'ZZ Tornillo', 1, 100, 100, true) RETURNING id INTO s3;
  INSERT INTO public.debts (org_id, user_id, customer_name, amount_ars, remaining_ars, sale_id, status)
  VALUES (v_org, v_user, 'ZZ Cliente', 100, 100, s2, 'pending');
  INSERT INTO public.invoices (org_id, sale_id, cae, number, customer_name) VALUES (v_org, s3, '12345678901234', 'ZZ-0001', 'ZZ Cliente');

  -- 1
  DELETE FROM public.sales WHERE id = s1;
  IF EXISTS (SELECT 1 FROM public.sales WHERE id = s1) OR (SELECT stock FROM public.products WHERE id = p1) <> 8 THEN
    RAISE EXCEPTION 'FALLA 1: stock %', (SELECT stock FROM public.products WHERE id = p1); END IF;
  -- 2
  BEGIN DELETE FROM public.sales WHERE id = s2; RAISE EXCEPTION 'FALLA 2: borró la fiada';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- 3
  BEGIN DELETE FROM public.sales WHERE id = s3; RAISE EXCEPTION 'FALLA 3: borró la facturada';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- 4 (otro negocio: una factura autorizada frena borrar el negocio, a propósito)
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ ventas 2', 'zz-vb2-' || substr(md5(random()::text), 1, 8), v_user2) RETURNING id INTO v_org2;
  PERFORM set_config('gestiona.sale_transaction_id', '', true);  -- otro ticket
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid)
  VALUES (v_org2, v_user2, 'ZZ Algo', 1, 100, 100, false) RETURNING id INTO s1;
  INSERT INTO public.debts (org_id, user_id, customer_name, amount_ars, remaining_ars, sale_id, status) VALUES (v_org2, v_user2, 'ZZ', 100, 100, s1, 'pending');
  DELETE FROM public.organizations WHERE id = v_org2;
  IF EXISTS (SELECT 1 FROM public.sales WHERE org_id = v_org2) THEN RAISE EXCEPTION 'FALLA 4'; END IF;
  RAISE EXCEPTION 'OK 1-4';
END $$;

ROLLBACK;
