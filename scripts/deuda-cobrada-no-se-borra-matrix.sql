-- Simulacro de 20261014002500 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Una deuda manual sin cobros se borra.
--   2. Una deuda con un cobro no se borra (y el cobro sigue).
--   3. Una deuda de una venta fiada no se borra.
DO $$
DECLARE v_user uuid; v_org uuid; d1 uuid; d2 uuid; d3 uuid; s1 uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ deudas', 'zz-db-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.debts (org_id, user_id, customer_name, amount_ars, remaining_ars, status) VALUES (v_org, v_user, 'ZZ A', 100, 100, 'pending') RETURNING id INTO d1;
  INSERT INTO public.debts (org_id, user_id, customer_name, amount_ars, remaining_ars, status) VALUES (v_org, v_user, 'ZZ B', 100, 100, 'pending') RETURNING id INTO d2;
  INSERT INTO public.debt_payments (org_id, user_id, debt_id, amount_ars) VALUES (v_org, v_user, d2, 40);
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid) VALUES (v_org, v_user, 'ZZ', 1, 100, 100, false) RETURNING id INTO s1;
  INSERT INTO public.debts (org_id, user_id, customer_name, amount_ars, remaining_ars, status, sale_id) VALUES (v_org, v_user, 'ZZ C', 100, 100, 'pending', s1) RETURNING id INTO d3;

  DELETE FROM public.debts WHERE id = d1;
  IF EXISTS (SELECT 1 FROM public.debts WHERE id = d1) THEN RAISE EXCEPTION 'FALLA 1'; END IF;
  BEGIN DELETE FROM public.debts WHERE id = d2; RAISE EXCEPTION 'FALLA 2: borró con cobros';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF NOT EXISTS (SELECT 1 FROM public.debt_payments WHERE debt_id = d2) THEN RAISE EXCEPTION 'FALLA 2: se fue el cobro'; END IF;
  BEGIN DELETE FROM public.debts WHERE id = d3; RAISE EXCEPTION 'FALLA 3: borró la de una venta';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE EXCEPTION 'OK 1-3';
END $$;

ROLLBACK;
