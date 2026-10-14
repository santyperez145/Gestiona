BEGIN;
-- Permisos de la caja por rol (regresión). Las funciones de caja son SECURITY
-- DEFINER y exigen el permiso de caja con `exigir_permiso` (desde
-- 20260829000044; cierre 20261011002100; movimientos 20261011002200).
-- Correr tal cual: termina en ROLLBACK. Negocio ZZ con dueño, vendedor y lector.
--   1. El lector no puede abrir la caja.
--   2. El vendedor la abre.
--   3. El lector no puede retirar efectivo.
--   4. El vendedor hace un ingreso.
--   5. El lector no puede cerrarla.
--   6. El vendedor la cierra.
DO $$
DECLARE
  v_user uuid; v_vendedor uuid; v_lector uuid; v_org uuid; v_suc uuid; v_caja uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_vendedor FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  SELECT id INTO v_lector FROM auth.users WHERE id NOT IN (v_user, v_vendedor) ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ caja permiso', 'zz-cp-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES
    (v_org, v_user, 'owner'), (v_org, v_vendedor, 'vendedor'), (v_org, v_lector, 'viewer')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.locations (org_id, name, is_main) VALUES (v_org, 'ZZ local', true) RETURNING id INTO v_suc;

  -- 1
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lector, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.pos_cash_session_open(v_org, v_suc, 1000, NULL);
    RAISE EXCEPTION 'FALLA 1: el lector abrió la caja';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  -- 2
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vendedor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.pos_cash_session_open(v_org, v_suc, 1000, NULL);
  RESET ROLE;
  SELECT id INTO v_caja FROM public.cash_sessions WHERE org_id = v_org AND status = 'open';
  IF v_caja IS NULL THEN RAISE EXCEPTION 'FALLA 2: el vendedor no abrió'; END IF;

  -- 3
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lector, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.pos_cash_movement(v_caja, 'manual_out', 500, 'ZZ retiro');
    RAISE EXCEPTION 'FALLA 3: el lector retiró efectivo';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  -- 4
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vendedor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.pos_cash_movement(v_caja, 'manual_in', 200, 'ZZ cambio');
  RESET ROLE;

  -- 5
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_lector, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.pos_cash_session_close(v_caja, 1200, NULL);
    RAISE EXCEPTION 'FALLA 5: el lector cerró la caja';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  -- 6
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vendedor, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.pos_cash_session_close(v_caja, 1200, NULL);
  RESET ROLE;
  IF (SELECT status FROM public.cash_sessions WHERE id = v_caja) <> 'closed' THEN RAISE EXCEPTION 'FALLA 6: no cerró'; END IF;
  RAISE EXCEPTION 'OK 1-6';
END $$;

ROLLBACK;
