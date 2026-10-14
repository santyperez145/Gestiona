-- Simulacro de 20261014001400 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK). Negocio ZZ, como dueño.
--   1. Recibido: pendiente → depositado (pone la fecha) → acreditado.
--   2. Un acreditado no vuelve a pendiente.
--   3. Un depositado puede rebotar.
--   4. Un emitido no se «deposita»; sí se debita.
--   5. Un cancelado no se reabre, y un cheque en curso no cambia de monto.
--   6. Número repetido (mismo banco y tipo) y monto cero se rechazan.
--   7. Un cheque nuevo no entra acreditado.
DO $$
DECLARE
  v_user uuid; v_org uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ cheques', 'zz-ch-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner') ON CONFLICT DO NOTHING;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.cheques (org_id, type, bank_name, check_number, amount_ars, due_date, status) VALUES (v_org, 'received', 'Galicia', '001', 1000, current_date, 'pending') RETURNING id INTO c1;
  INSERT INTO public.cheques (org_id, type, bank_name, check_number, amount_ars, due_date, status) VALUES (v_org, 'received', 'Galicia', '002', 1000, current_date, 'pending') RETURNING id INTO c2;
  INSERT INTO public.cheques (org_id, type, bank_name, check_number, amount_ars, due_date, status) VALUES (v_org, 'issued', 'Nación', '100', 500, current_date, 'pending') RETURNING id INTO c3;
  INSERT INTO public.cheques (org_id, type, bank_name, check_number, amount_ars, due_date, status) VALUES (v_org, 'received', 'Macro', '777', 300, current_date, 'pending') RETURNING id INTO c4;

  -- 1
  UPDATE public.cheques SET status = 'deposited' WHERE id = c1;
  IF (SELECT deposited_at FROM public.cheques WHERE id = c1) IS NULL THEN RAISE EXCEPTION 'FALLA 1: sin fecha de depósito'; END IF;
  UPDATE public.cheques SET status = 'cleared' WHERE id = c1;

  -- 2
  BEGIN
    UPDATE public.cheques SET status = 'pending' WHERE id = c1;
    RAISE EXCEPTION 'FALLA 2: un acreditado volvió a pendiente';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;

  -- 3
  UPDATE public.cheques SET status = 'deposited' WHERE id = c2;
  UPDATE public.cheques SET status = 'bounced' WHERE id = c2;

  -- 4
  BEGIN
    UPDATE public.cheques SET status = 'deposited' WHERE id = c3;
    RAISE EXCEPTION 'FALLA 4: se depositó un emitido';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  UPDATE public.cheques SET status = 'cleared' WHERE id = c3;

  -- 5
  UPDATE public.cheques SET status = 'cancelled' WHERE id = c4;
  BEGIN
    UPDATE public.cheques SET status = 'deposited' WHERE id = c4;
    RAISE EXCEPTION 'FALLA 5: se reabrió un cancelado';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  BEGIN
    UPDATE public.cheques SET amount_ars = 1 WHERE id = c1;
    RAISE EXCEPTION 'FALLA 5: cambió el monto de un acreditado';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;

  -- 6
  BEGIN
    INSERT INTO public.cheques (org_id, type, bank_name, check_number, amount_ars, due_date, status) VALUES (v_org, 'received', ' galicia ', '001', 10, current_date, 'pending');
    RAISE EXCEPTION 'FALLA 6: número repetido';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.cheques (org_id, type, bank_name, check_number, amount_ars, due_date, status) VALUES (v_org, 'received', 'Galicia', '009', 0, current_date, 'pending');
    RAISE EXCEPTION 'FALLA 6: monto cero';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 7
  BEGIN
    INSERT INTO public.cheques (org_id, type, bank_name, check_number, amount_ars, due_date, status) VALUES (v_org, 'received', 'Galicia', '010', 10, current_date, 'cleared');
    RAISE EXCEPTION 'FALLA 7: entró acreditado';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RESET ROLE;
  RAISE EXCEPTION 'OK 1-7';
END $$;

ROLLBACK;
