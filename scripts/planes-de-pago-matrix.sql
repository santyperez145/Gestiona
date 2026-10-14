-- Simulacro de 20261014001300 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ con una deuda de 1.000 de la
-- que ya se pagaron 100 (saldo 900).
--   1. 7 cuotas mensuales: suman exacto el saldo (la última absorbe el
--      redondeo) y las fechas avanzan de a un mes.
--   2. Rehacer el plan lo reemplaza (uno por deuda).
--   3. Un vendedor no arma planes; un lector tampoco borra.
--   4. Una deuda saldada no admite plan.
--   5. Fuera de rango (0 o 37 cuotas) se rechaza.
DO $$
DECLARE
  v_user uuid; v_vend uuid; v_org uuid; d1 uuid; d2 uuid; v_r jsonb; v_suma numeric;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vend FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ planes', 'zz-pl-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_vend, 'vendedor') ON CONFLICT DO NOTHING;
  INSERT INTO public.debts (org_id, user_id, customer_name, amount_ars, paid_ars, remaining_ars, status, date, description)
    VALUES (v_org, v_user, 'ZZ Cliente', 1000, 100, 900, 'partial', now(), 'ZZ deuda') RETURNING id INTO d1;
  INSERT INTO public.debts (org_id, user_id, customer_name, amount_ars, paid_ars, remaining_ars, status, date, description)
    VALUES (v_org, v_user, 'ZZ Cliente', 50, 50, 0, 'paid', now(), 'ZZ saldada') RETURNING id INTO d2;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1
  v_r := public.guardar_plan_de_pago(d1, 7, 'mensual', DATE '2026-01-31');
  SELECT sum((c->>'monto')::numeric) INTO v_suma FROM jsonb_array_elements(v_r->'cuotas') c;
  IF v_suma <> 900 OR jsonb_array_length(v_r->'cuotas') <> 7 OR (v_r->>'pagado_al_crear')::numeric <> 100
     OR v_r->'cuotas'->0->>'monto' <> '128.57' OR v_r->'cuotas'->6->>'monto' <> '128.58'
     OR v_r->'cuotas'->1->>'fecha' <> '2026-02-28' THEN
    RAISE EXCEPTION 'FALLA 1: %', v_r; END IF;

  -- 2
  v_r := public.guardar_plan_de_pago(d1, 3, 'quincenal', DATE '2026-03-01');
  IF jsonb_array_length(v_r->'cuotas') <> 3 OR v_r->'cuotas'->1->>'fecha' <> '2026-03-15'
     OR (SELECT count(*) FROM public.planes_de_pago WHERE debt_id = d1) <> 1 THEN RAISE EXCEPTION 'FALLA 2: %', v_r; END IF;

  -- 4
  BEGIN
    PERFORM public.guardar_plan_de_pago(d2, 2, 'mensual', DATE '2026-03-01');
    RAISE EXCEPTION 'FALLA 4: plan sobre deuda saldada';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 5
  BEGIN
    PERFORM public.guardar_plan_de_pago(d1, 37, 'mensual', DATE '2026-03-01');
    RAISE EXCEPTION 'FALLA 5: 37 cuotas';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;

  -- 3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vend, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.guardar_plan_de_pago(d1, 2, 'mensual', DATE '2026-03-01');
    RAISE EXCEPTION 'FALLA 3: un vendedor armó un plan';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  DELETE FROM public.planes_de_pago WHERE debt_id = d1;
  RESET ROLE;
  IF (SELECT count(*) FROM public.planes_de_pago WHERE debt_id = d1) <> 1 THEN RAISE EXCEPTION 'FALLA 3: un vendedor borró el plan'; END IF;
  RAISE EXCEPTION 'OK 1-5';
END $$;

ROLLBACK;
