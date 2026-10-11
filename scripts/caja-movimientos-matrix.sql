-- Matriz reversible de 20261011002200 (ingresos y retiros de caja).
--   node scripts/db.mjs --file scripts/caja-movimientos-matrix.sql
-- Caja ZZ con $1.000: un viewer no puede; el dueño ingresa $500 (esperado
-- 1.500) y retira $300 (1.200); retirar más de lo que hay, sin motivo o con
-- monto cero se rechaza; con la caja cerrada también. Todo se revierte.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE zz_mv (caso text, valor text) ON COMMIT DROP;
GRANT ALL ON zz_mv TO authenticated;
DO $d$
DECLARE v_owner uuid; v_view uuid; v_org uuid; v_s uuid; v_r jsonb;
BEGIN
  SELECT id INTO v_owner FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_view FROM auth.users WHERE id <> v_owner ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ movimientos', 'zz-mov-' || substr(md5(random()::text), 1, 8), v_owner) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_owner, 'owner'), (v_org, v_view, 'viewer') ON CONFLICT DO NOTHING;
  INSERT INTO public.cash_sessions (org_id, opened_by, opening_amount, status) VALUES (v_org, v_owner, 1000, 'open') RETURNING id INTO v_s;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_view, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.pos_cash_movement(v_s, 'manual_in', 100, 'cambio');
    INSERT INTO zz_mv VALUES ('viewer ingresa', 'PUDO (mal)');
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO zz_mv VALUES ('viewer ingresa', 'rechazado'); END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_r := public.pos_cash_movement(v_s, 'manual_in', 500, 'Cambio traído del banco');
  INSERT INTO zz_mv VALUES ('ingresa 500 → esperado 1500', v_r->>'esperado');
  v_r := public.pos_cash_movement(v_s, 'manual_out', 300, 'Pago de flete');
  INSERT INTO zz_mv VALUES ('retira 300 → esperado 1200', v_r->>'esperado');
  BEGIN PERFORM public.pos_cash_movement(v_s, 'manual_out', 5000, 'demasiado');
    INSERT INTO zz_mv VALUES ('retira más de lo que hay', 'PUDO (mal)');
  EXCEPTION WHEN check_violation THEN INSERT INTO zz_mv VALUES ('retira más de lo que hay', SQLERRM); END;
  BEGIN PERFORM public.pos_cash_movement(v_s, 'manual_in', 10, '  ');
    INSERT INTO zz_mv VALUES ('sin motivo', 'PUDO (mal)');
  EXCEPTION WHEN check_violation THEN INSERT INTO zz_mv VALUES ('sin motivo', SQLERRM); END;
  BEGIN PERFORM public.pos_cash_movement(v_s, 'manual_in', 0, 'cero');
    INSERT INTO zz_mv VALUES ('monto cero', 'PUDO (mal)');
  EXCEPTION WHEN invalid_parameter_value THEN INSERT INTO zz_mv VALUES ('monto cero', SQLERRM); END;
  RESET ROLE;
  UPDATE public.cash_sessions SET status = 'closed' WHERE id = v_s;
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.pos_cash_movement(v_s, 'manual_in', 10, 'tarde');
    INSERT INTO zz_mv VALUES ('caja cerrada', 'PUDO (mal)');
  EXCEPTION WHEN object_not_in_prerequisite_state THEN INSERT INTO zz_mv VALUES ('caja cerrada', SQLERRM); END;
  RESET ROLE;
  INSERT INTO zz_mv SELECT 'auditoría con motivo', count(*)::text FROM public.audit_logs WHERE entity_type = 'cash_entry' AND details->>'session_id' = v_s::text AND details ? 'motivo';
END $d$;
SELECT * FROM zz_mv;
ROLLBACK;
