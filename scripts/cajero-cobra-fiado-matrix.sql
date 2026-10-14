-- Simulacro de 20261014000600 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Dos negocios ZZ: el primero con caja
-- abierta por el dueño, el segundo sin caja. Un vendedor y un lector en ambos.
--   1. El vendedor cobra con la caja abierta y el cobro entra en esa caja.
--   2. Si el vendedor abrió su propia caja, el cobro va a la suya.
--   3. Sin caja abierta, el vendedor no puede cobrar (55000).
--   4. El mismo pedido repetido devuelve el recibo aunque ya no haya caja.
--   5. El dueño cobra sin caja.
--   6. Un lector no puede cobrar (42501).
DO $$
DECLARE
  v_user uuid; v_vendedor uuid; v_lector uuid; v_org uuid; v_org2 uuid; v_cli uuid; v_cli2 uuid;
  v_caja_duenio uuid; v_caja_vendedor uuid; v_sucursal uuid; v_r jsonb; v_n int;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vendedor FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  SELECT id INTO v_lector FROM auth.users WHERE id NOT IN (v_user, v_vendedor) ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ cajero cobra', 'zz-cc6-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ sin caja', 'zz-cc6b-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org2;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES
    (v_org, v_user, 'owner'), (v_org, v_vendedor, 'vendedor'), (v_org, v_lector, 'viewer'),
    (v_org2, v_user, 'owner'), (v_org2, v_vendedor, 'vendedor')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.customers (org_id, user_id, name) VALUES (v_org, v_user, 'ZZ Cliente') RETURNING id INTO v_cli;
  INSERT INTO public.customers (org_id, user_id, name) VALUES (v_org2, v_user, 'ZZ Cliente 2') RETURNING id INTO v_cli2;
  INSERT INTO public.debts (org_id, user_id, customer_id, customer_name, amount_ars, paid_ars, remaining_ars, status, date, description)
    VALUES (v_org, v_user, v_cli, 'ZZ Cliente', 500, 0, 500, 'pending', now() - interval '5 days', 'ZZ deuda');
  INSERT INTO public.debts (org_id, user_id, customer_id, customer_name, amount_ars, paid_ars, remaining_ars, status, date, description)
    VALUES (v_org2, v_user, v_cli2, 'ZZ Cliente 2', 400, 0, 400, 'pending', now() - interval '5 days', 'ZZ deuda 2');
  INSERT INTO public.cash_sessions (org_id, opened_by, status, opened_at) VALUES (v_org, v_user, 'open', now() - interval '2 hours') RETURNING id INTO v_caja_duenio;

  -- 1. Vendedor con la caja del dueño abierta.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vendedor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_r := public.cobrar_cuenta_corriente(v_org, 100, 'efectivo', 'zz-c6-0001', v_cli);
  RESET ROLE;
  IF NOT (v_r->>'en_caja')::boolean OR (SELECT session_id FROM public.cash_entries WHERE reference_id = (v_r->>'cobro_id')::uuid) <> v_caja_duenio THEN
    RAISE EXCEPTION 'FALLA 1: %', v_r; END IF;

  -- 2. El vendedor abre su caja: el cobro va a la suya.
  -- (otra sucursal: hay una caja abierta por sucursal como máximo)
  INSERT INTO public.locations (org_id, name) VALUES (v_org, 'ZZ mostrador 2') RETURNING id INTO v_sucursal;
  INSERT INTO public.cash_sessions (org_id, opened_by, status, opened_at, location_id) VALUES (v_org, v_vendedor, 'open', now() - interval '3 hours', v_sucursal) RETURNING id INTO v_caja_vendedor;
  SET LOCAL ROLE authenticated;
  v_r := public.cobrar_cuenta_corriente(v_org, 50, 'efectivo', 'zz-c6-0002', v_cli);
  RESET ROLE;
  IF (SELECT session_id FROM public.cash_entries WHERE reference_id = (v_r->>'cobro_id')::uuid) <> v_caja_vendedor THEN
    RAISE EXCEPTION 'FALLA 2: fue a otra caja'; END IF;

  -- 3. Sin caja, el vendedor no cobra.
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.cobrar_cuenta_corriente(v_org2, 10, 'efectivo', 'zz-c6-0003', v_cli2);
    RAISE EXCEPTION 'FALLA 3: cobró sin caja';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;

  RESET ROLE;
  -- 4. Se cierran las cajas; repetir un cobro ya hecho devuelve el recibo igual.
  UPDATE public.cash_sessions SET status = 'closed', closed_at = now(), closed_by = v_user WHERE org_id = v_org;
  SET LOCAL ROLE authenticated;
  v_r := public.cobrar_cuenta_corriente(v_org, 100, 'efectivo', 'zz-c6-0001', v_cli);
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.debt_payments WHERE org_id = v_org;
  IF NOT (v_r->>'repetido')::boolean OR v_n <> 2 THEN RAISE EXCEPTION 'FALLA 4: repetido=% pagos=%', v_r->>'repetido', v_n; END IF;

  -- 5. El dueño cobra sin caja.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_r := public.cobrar_cuenta_corriente(v_org2, 400, 'transferencia', 'zz-c6-0005', v_cli2);
  RESET ROLE;
  IF (v_r->>'en_caja')::boolean OR (v_r->>'saldo_pendiente')::numeric <> 0 THEN RAISE EXCEPTION 'FALLA 5: %', v_r; END IF;

  -- 6. Un lector no cobra.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lector, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.cobrar_cuenta_corriente(v_org, 10, 'efectivo', 'zz-c6-0006', v_cli);
    RAISE EXCEPTION 'FALLA 6: un lector cobró';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  RAISE EXCEPTION 'OK 1-6';
END $$;

ROLLBACK;
