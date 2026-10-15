-- Simulacro de 20261015000100 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Una venta cobrada en efectivo entra una vez, por ticket.
--   2. Una venta fiada no entra como venta; entra su cobro de cuenta corriente.
--   3. Un gasto sale (desde financial_movements).
--   4. Un usuario de otro negocio no ve nada.
DO $$
DECLARE v_user uuid; v_otro uuid; v_org uuid; v_org2 uuid; s2 uuid; d2 uuid; v_in numeric; v_out numeric; v_n int;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_otro FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ dinero', 'zz-di-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid, payment_method)
  VALUES (v_org, v_user, 'ZZ A', 1, 100, 100, true, 'efectivo'), (v_org, v_user, 'ZZ B', 1, 50, 50, true, 'efectivo');
  PERFORM set_config('gestiona.sale_transaction_id', '', true);
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid, payment_method)
  VALUES (v_org, v_user, 'ZZ Fiado', 1, 300, 300, false, 'fiado') RETURNING id INTO s2;
  INSERT INTO public.debts (org_id, user_id, customer_name, amount_ars, remaining_ars, sale_id, status) VALUES (v_org, v_user, 'ZZ Cliente', 300, 300, s2, 'pending') RETURNING id INTO d2;
  INSERT INTO public.debt_payments (org_id, user_id, debt_id, amount_ars, payment_method) VALUES (v_org, v_user, d2, 300, 'transferencia');
  UPDATE public.debts SET paid_ars = 300, remaining_ars = 0, status = 'paid' WHERE id = d2;
  UPDATE public.sales SET paid = true WHERE id = s2;
  INSERT INTO public.expenses (org_id, user_id, amount_ars, category, description, date, payment_method) VALUES (v_org, v_user, 40, 'otros', 'ZZ gasto', now(), 'efectivo');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT coalesce(sum(amount_ars) FILTER (WHERE direction = 'in'), 0), coalesce(sum(amount_ars) FILTER (WHERE direction = 'out'), 0), count(*)
    INTO v_in, v_out, v_n FROM public.movimientos_de_dinero WHERE org_id = v_org;
  RESET ROLE;
  IF v_in <> 450 OR v_out <> 40 OR v_n <> 3 THEN RAISE EXCEPTION 'FALLA 1-3: in % out % filas %', v_in, v_out, v_n; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.movimientos_de_dinero WHERE org_id = v_org;
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALLA 4: otro negocio ve % filas', v_n; END IF;
  RAISE EXCEPTION 'OK 1-4';
END $$;

ROLLBACK;
