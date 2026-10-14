-- Simulacro de 20261014000700 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ con un cliente que debe 300 y
-- una caja abierta.
--    1. Pagar de más sin pedir excedente se sigue rechazando.
--    2. Pagar 500 con excedente: salda los 300, deja 200 a favor y la caja suma 500.
--    3. Repetir el mismo pedido no vuelve a acreditar.
--    4. Anticipo sin deudas: 100 más a favor (saldo 300).
--    5. Pagar una deuda nueva de 250 con saldo a favor: la salda, saldo 50, la caja no cambia.
--    6. Usar más saldo del que hay se rechaza.
--    7. Excedente sin cliente elegido (sólo nombre) se rechaza.
--    8. Un cliente de otro negocio se rechaza.
--    9. No se puede borrar un cliente con saldo.
--   10. Borrar el negocio entero funciona igual.
DO $$
DECLARE
  v_user uuid; v_org uuid; v_org2 uuid; v_cli uuid; v_cli_otro uuid; d1 uuid; d2 uuid; v_r jsonb; v_n int; v_caja numeric;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ saldo a favor', 'zz-saf-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ otro negocio', 'zz-saf2-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org2, v_user, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.customers (org_id, user_id, name) VALUES (v_org, v_user, 'ZZ Cliente') RETURNING id INTO v_cli;
  INSERT INTO public.customers (org_id, user_id, name) VALUES (v_org2, v_user, 'ZZ Ajeno') RETURNING id INTO v_cli_otro;
  INSERT INTO public.debts (org_id, user_id, customer_id, customer_name, amount_ars, paid_ars, remaining_ars, status, date, description)
    VALUES (v_org, v_user, v_cli, 'ZZ Cliente', 300, 0, 300, 'pending', now() - interval '10 days', 'ZZ uno') RETURNING id INTO d1;
  INSERT INTO public.cash_sessions (org_id, opened_by, status) VALUES (v_org, v_user, 'open');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  BEGIN
    PERFORM public.cobrar_cuenta_corriente(v_org, 500, 'efectivo', 'zz-saf-0001', v_cli);
    RAISE EXCEPTION 'FALLA 1: aceptó pagar de más sin excedente';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 2
  v_r := public.cobrar_cuenta_corriente(v_org, 500, 'efectivo', 'zz-saf-0002', v_cli, NULL, NULL, NULL, true);
  IF (v_r->>'a_favor')::numeric <> 200 OR (v_r->>'saldo_a_favor')::numeric <> 200 OR (v_r->>'saldo_pendiente')::numeric <> 0 THEN
    RAISE EXCEPTION 'FALLA 2: %', v_r; END IF;
  IF (SELECT status FROM public.debts WHERE id = d1) <> 'paid' THEN RAISE EXCEPTION 'FALLA 2: la deuda no quedó saldada'; END IF;
  IF public.saldo_a_favor(v_org, v_cli) <> 200 THEN RAISE EXCEPTION 'FALLA 2: saldo %', public.saldo_a_favor(v_org, v_cli); END IF;

  -- 3
  v_r := public.cobrar_cuenta_corriente(v_org, 500, 'efectivo', 'zz-saf-0002', v_cli, NULL, NULL, NULL, true);
  IF NOT (v_r->>'repetido')::boolean OR public.saldo_a_favor(v_org, v_cli) <> 200 THEN RAISE EXCEPTION 'FALLA 3: %', v_r; END IF;

  -- 4
  v_r := public.cobrar_cuenta_corriente(v_org, 100, 'transferencia', 'zz-saf-0004', v_cli, NULL, NULL, NULL, true);
  IF (v_r->>'a_favor')::numeric <> 100 OR public.saldo_a_favor(v_org, v_cli) <> 300 THEN RAISE EXCEPTION 'FALLA 4: %', v_r; END IF;

  -- 5
  RESET ROLE;
  INSERT INTO public.debts (org_id, user_id, customer_id, customer_name, amount_ars, paid_ars, remaining_ars, status, date, description)
    VALUES (v_org, v_user, v_cli, 'ZZ Cliente', 250, 0, 250, 'pending', now(), 'ZZ dos') RETURNING id INTO d2;
  SELECT sum(amount_ars) INTO v_caja FROM public.cash_entries WHERE org_id = v_org;
  SET LOCAL ROLE authenticated;
  v_r := public.cobrar_cuenta_corriente(v_org, 250, 'saldo_a_favor', 'zz-saf-0005', v_cli);
  RESET ROLE;
  IF (SELECT status FROM public.debts WHERE id = d2) <> 'paid' OR public.saldo_a_favor(v_org, v_cli) <> 50
     OR (v_r->>'en_caja')::boolean OR (SELECT sum(amount_ars) FROM public.cash_entries WHERE org_id = v_org) <> v_caja OR v_caja <> 600 THEN
    RAISE EXCEPTION 'FALLA 5: % caja=%', v_r, v_caja; END IF;
  SET LOCAL ROLE authenticated;

  -- 6
  RESET ROLE;
  INSERT INTO public.debts (org_id, user_id, customer_id, customer_name, amount_ars, paid_ars, remaining_ars, status, date, description)
    VALUES (v_org, v_user, v_cli, 'ZZ Cliente', 400, 0, 400, 'pending', now(), 'ZZ tres');
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.cobrar_cuenta_corriente(v_org, 100, 'saldo_a_favor', 'zz-saf-0006', v_cli);
    RAISE EXCEPTION 'FALLA 6: usó más saldo del que hay';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 7
  BEGIN
    PERFORM public.cobrar_cuenta_corriente(v_org, 1000, 'efectivo', 'zz-saf-0007', NULL, 'ZZ Cliente', NULL, NULL, true);
    RAISE EXCEPTION 'FALLA 7: excedente sin cliente';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 8
  BEGIN
    PERFORM public.cobrar_cuenta_corriente(v_org, 10, 'efectivo', 'zz-saf-0008', v_cli_otro, NULL, NULL, NULL, true);
    RAISE EXCEPTION 'FALLA 8: aceptó un cliente de otro negocio';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;

  -- 9
  BEGIN
    DELETE FROM public.customers WHERE id = v_cli;
    RAISE EXCEPTION 'FALLA 9: borró un cliente con saldo';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;

  -- 10
  DELETE FROM public.organizations WHERE id = v_org;
  SELECT count(*) INTO v_n FROM public.saldo_a_favor_movimientos WHERE org_id = v_org;
  IF v_n <> 0 OR EXISTS (SELECT 1 FROM public.customers WHERE id = v_cli) THEN RAISE EXCEPTION 'FALLA 10: quedaron % movimientos', v_n; END IF;
  RAISE EXCEPTION 'OK 1-10';
END $$;

ROLLBACK;
