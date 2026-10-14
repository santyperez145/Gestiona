-- Simulacro de 20261014000500 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ con tres deudas de un
-- cliente (100, 200 y 300, vencen en ese orden) y una caja abierta.
--   1. Cobrar 250 a cuenta: salda la de 100 y deja la de 200 en 50.
--   2. El mismo pedido repetido devuelve el recibo sin volver a cobrar.
--   3. Cobrar más de lo que se debe se rechaza con lo pendiente.
--   4. Cobrar una deuda puntual (la de 300) la salda.
--   5. El cobro entra en la caja abierta (250 + 300).
--   6. Un vendedor no puede cobrar deudas.
DO $$
DECLARE
  v_user uuid; v_org uuid; v_cli uuid; d1 uuid; d2 uuid; d3 uuid; v_r jsonb; v_n int; v_caja numeric;
  v_vendedor uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vendedor FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ cuenta corriente', 'zz-cc-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_vendedor, 'vendedor') ON CONFLICT DO NOTHING;
  INSERT INTO public.customers (org_id, user_id, name) VALUES (v_org, v_user, 'ZZ Cliente') RETURNING id INTO v_cli;
  INSERT INTO public.debts (org_id, user_id, customer_id, customer_name, amount_ars, paid_ars, remaining_ars, status, date, due_date, description)
    VALUES (v_org, v_user, v_cli, 'ZZ Cliente', 100, 0, 100, 'pending', now() - interval '30 days', now() - interval '20 days', 'ZZ uno') RETURNING id INTO d1;
  INSERT INTO public.debts (org_id, user_id, customer_id, customer_name, amount_ars, paid_ars, remaining_ars, status, date, due_date, description)
    VALUES (v_org, v_user, v_cli, 'ZZ Cliente', 200, 0, 200, 'pending', now() - interval '20 days', now() - interval '10 days', 'ZZ dos') RETURNING id INTO d2;
  INSERT INTO public.debts (org_id, user_id, customer_id, customer_name, amount_ars, paid_ars, remaining_ars, status, date, due_date, description)
    VALUES (v_org, v_user, v_cli, 'ZZ Cliente', 300, 0, 300, 'pending', now() - interval '10 days', now(), 'ZZ tres') RETURNING id INTO d3;
  INSERT INTO public.cash_sessions (org_id, opened_by, status) VALUES (v_org, v_user, 'open');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_r := public.cobrar_cuenta_corriente(v_org, 250, 'efectivo', 'zz-clave-0001', v_cli);
  IF jsonb_array_length(v_r->'imputaciones') <> 2 OR (v_r->>'saldo_pendiente')::numeric <> 350 THEN RAISE EXCEPTION 'FALLA 1: %', v_r; END IF;
  RESET ROLE;
  IF (SELECT status FROM public.debts WHERE id = d1) <> 'paid' OR (SELECT remaining_ars FROM public.debts WHERE id = d2) <> 50 THEN
    RAISE EXCEPTION 'FALLA 1: imputación FIFO'; END IF;
  SET LOCAL ROLE authenticated;

  v_r := public.cobrar_cuenta_corriente(v_org, 250, 'efectivo', 'zz-clave-0001', v_cli);
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.debt_payments WHERE org_id = v_org;
  IF NOT (v_r->>'repetido')::boolean OR v_n <> 2 THEN RAISE EXCEPTION 'FALLA 2: repetido=% pagos=%', v_r->>'repetido', v_n; END IF;
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.cobrar_cuenta_corriente(v_org, 999, 'efectivo', 'zz-clave-0002', v_cli);
    RAISE EXCEPTION 'FALLA 3: aceptó cobrar de más';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  v_r := public.cobrar_cuenta_corriente(v_org, 300, 'transferencia', 'zz-clave-0003', NULL, NULL, d3);
  RESET ROLE;
  IF (SELECT status FROM public.debts WHERE id = d3) <> 'paid' OR (SELECT remaining_ars FROM public.debts WHERE id = d2) <> 50 THEN
    RAISE EXCEPTION 'FALLA 4: deuda puntual'; END IF;

  SELECT sum(amount_ars) INTO v_caja FROM public.cash_entries WHERE org_id = v_org AND entry_type = 'debt_payment';
  IF v_caja <> 550 THEN RAISE EXCEPTION 'FALLA 5: caja %', v_caja; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vendedor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.cobrar_cuenta_corriente(v_org, 10, 'efectivo', 'zz-clave-0004', v_cli);
    RAISE EXCEPTION 'FALLA 6: un vendedor cobró';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  RAISE EXCEPTION 'OK 1-6';
END $$;

ROLLBACK;
