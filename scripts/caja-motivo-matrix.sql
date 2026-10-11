-- Matriz reversible de 20261011002100 (cerrar caja con diferencia exige motivo).
--   node scripts/db.mjs --file scripts/caja-motivo-matrix.sql
-- Dueño de una organización ZZ: cerrar con faltante sin motivo se rechaza
-- (con el monto en el mensaje); con motivo cierra y la auditoría lo guarda;
-- cerrar justo en lo esperado no pide motivo. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_cm (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_cm TO authenticated;
DO $d$
DECLARE v_owner uuid; v_org uuid; v_s1 uuid; v_s2 uuid; v_esperado numeric; v_r jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ caja', 'zz-caja-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.cash_sessions (org_id, opened_by, opening_amount, status) VALUES (v_org, v_owner, 1000, 'open') RETURNING id INTO v_s1;

  v_esperado := public.cash_session_expected_cash(v_s1);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.pos_cash_session_close(v_s1, v_esperado - 100, NULL);
    INSERT INTO zz_cm VALUES ('faltante de $100 sin motivo', 'cerró (mal)');
  EXCEPTION WHEN check_violation THEN INSERT INTO zz_cm VALUES ('faltante de $100 sin motivo', 'rechazado: ' || left(SQLERRM, 60)); END;
  v_r := public.pos_cash_session_close(v_s1, v_esperado - 100, 'Vuelto mal dado a la tarde');
  INSERT INTO zz_cm VALUES ('con motivo cierra (diferencia)', (v_r->>'difference'));
  RESET ROLE;
  INSERT INTO zz_cm SELECT 'auditoría guarda el motivo', details->>'motivo' FROM public.audit_logs
    WHERE entity_id = v_s1::text AND entity_type = 'cash_session' ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.cash_sessions (org_id, opened_by, opening_amount, status) VALUES (v_org, v_owner, 500, 'open') RETURNING id INTO v_s2;
  v_esperado := public.cash_session_expected_cash(v_s2);
  SET LOCAL ROLE authenticated;
  v_r := public.pos_cash_session_close(v_s2, v_esperado, NULL);
  INSERT INTO zz_cm VALUES ('sin diferencia no pide motivo', v_r->>'status');
  RESET ROLE;
END $d$;
SELECT * FROM zz_cm;
ROLLBACK;
