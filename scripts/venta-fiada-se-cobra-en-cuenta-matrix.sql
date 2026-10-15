-- Simulacro de 20261014002800 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Marcar cobrada a mano una venta fiada con saldo se rechaza.
--   2. Una venta sin deuda se marca cobrada.
--   3. Saldar la deuda y después marcar la venta (como el cobro) funciona.
DO $$
DECLARE v_user uuid; v_org uuid; s1 uuid; s2 uuid; d1 uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ fiado', 'zz-fi-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid) VALUES (v_org, v_user, 'ZZ', 1, 100, 100, false) RETURNING id INTO s1;
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid) VALUES (v_org, v_user, 'ZZ 2', 1, 50, 50, false) RETURNING id INTO s2;
  INSERT INTO public.debts (org_id, user_id, customer_name, amount_ars, remaining_ars, sale_id, status) VALUES (v_org, v_user, 'ZZ Cliente', 100, 100, s1, 'pending') RETURNING id INTO d1;

  BEGIN UPDATE public.sales SET paid = true WHERE id = s1; RAISE EXCEPTION 'FALLA 1';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.sales SET paid = true WHERE id = s2;
  IF NOT (SELECT paid FROM public.sales WHERE id = s2) THEN RAISE EXCEPTION 'FALLA 2'; END IF;
  UPDATE public.debts SET paid_ars = 100, remaining_ars = 0, status = 'paid' WHERE id = d1;
  UPDATE public.sales SET paid = true WHERE id = s1;
  IF NOT (SELECT paid FROM public.sales WHERE id = s1) THEN RAISE EXCEPTION 'FALLA 3'; END IF;
  RAISE EXCEPTION 'OK 1-3';
END $$;

ROLLBACK;
