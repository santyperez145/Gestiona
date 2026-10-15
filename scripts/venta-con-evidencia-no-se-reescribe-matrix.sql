-- Simulacro de 20261014002900 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   1. Una venta cargada a mano sin evidencia se edita (cantidad y total).
--   2. Una fiada no cambia de total; sí de cliente.
--   3. Una facturada no pasa a «no cobrada».
--   4. Marcar cobrada una fiada ya saldada sigue funcionando.
DO $$
DECLARE v_user uuid; v_org uuid; s1 uuid; s2 uuid; s3 uuid; d2 uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ editar', 'zz-ed-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid) VALUES (v_org, v_user, 'ZZ', 1, 100, 100, true) RETURNING id INTO s1;
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid) VALUES (v_org, v_user, 'ZZ 2', 1, 100, 100, false) RETURNING id INTO s2;
  INSERT INTO public.sales (org_id, user_id, product_name, quantity, unit_price_ars, total_ars, paid) VALUES (v_org, v_user, 'ZZ 3', 1, 100, 100, true) RETURNING id INTO s3;
  INSERT INTO public.debts (org_id, user_id, customer_name, amount_ars, remaining_ars, sale_id, status) VALUES (v_org, v_user, 'ZZ', 100, 100, s2, 'pending') RETURNING id INTO d2;
  INSERT INTO public.invoices (org_id, sale_id, cae, number, customer_name) VALUES (v_org, s3, '12345678901234', 'ZZ-1', 'ZZ');

  UPDATE public.sales SET quantity = 2, total_ars = 200 WHERE id = s1;
  IF (SELECT total_ars FROM public.sales WHERE id = s1) <> 200 THEN RAISE EXCEPTION 'FALLA 1'; END IF;
  BEGIN UPDATE public.sales SET total_ars = 80 WHERE id = s2; RAISE EXCEPTION 'FALLA 2: cambió el total de una fiada';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.sales SET customer_name = 'Ana' WHERE id = s2;
  BEGIN UPDATE public.sales SET paid = false WHERE id = s3; RAISE EXCEPTION 'FALLA 3';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.debts SET paid_ars = 100, remaining_ars = 0, status = 'paid' WHERE id = d2;
  UPDATE public.sales SET paid = true WHERE id = s2;
  IF NOT (SELECT paid FROM public.sales WHERE id = s2) THEN RAISE EXCEPTION 'FALLA 4'; END IF;
  RAISE EXCEPTION 'OK 1-4';
END $$;

ROLLBACK;
