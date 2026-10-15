-- Simulacro de 20261014002600 (concatenar después de la migración sin
-- BEGIN/COMMIT; termina en ROLLBACK).
--   0. Los gastos existentes quedan con su egreso.
--   1. Un gasto nuevo crea su egreso con medio y canal.
--   2. Editar el monto y el medio actualiza el mismo egreso.
--   3. Borrar el gasto borra su egreso.
DO $$
DECLARE v_user uuid; v_otro uuid; v_org uuid; g uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.expenses e WHERE e.org_id IS NOT NULL AND coalesce(e.amount_ars, 0) > 0
              AND NOT EXISTS (SELECT 1 FROM public.financial_movements m WHERE m.source_type = 'expense' AND m.source_id = e.id)) THEN
    RAISE EXCEPTION 'FALLA 0'; END IF;
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  SELECT id INTO v_otro FROM auth.users WHERE id <> v_user ORDER BY created_at LIMIT 1;
  INSERT INTO public.organizations (name, slug, owner_user_id) VALUES ('ZZ gastos', 'zz-ga-' || substr(md5(random()::text), 1, 8), v_user) RETURNING id INTO v_org;
  INSERT INTO public.memberships (org_id, user_id, role) VALUES (v_org, v_user, 'owner'), (v_org, v_otro, 'admin') ON CONFLICT DO NOTHING;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.expenses (org_id, user_id, amount_ars, category, description, date, payment_method)
  VALUES (v_org, v_otro, 1500, 'servicios', 'Luz', now(), 'transferencia') RETURNING id INTO g;
  RESET ROLE;
  IF (SELECT count(*) FROM public.financial_movements WHERE source_type = 'expense' AND source_id = g) <> 1
     OR (SELECT amount_ars || '|' || channel || '|' || direction FROM public.financial_movements WHERE source_id = g) <> '1500|bank|out' THEN
    RAISE EXCEPTION 'FALLA 1: %', (SELECT amount_ars || '|' || channel || '|' || direction FROM public.financial_movements WHERE source_id = g); END IF;
  UPDATE public.expenses SET amount_ars = 1800, payment_method = 'efectivo' WHERE id = g;
  IF (SELECT count(*) FROM public.financial_movements WHERE source_id = g) <> 1
     OR (SELECT amount_ars || '|' || channel FROM public.financial_movements WHERE source_id = g) <> '1800|cash' THEN RAISE EXCEPTION 'FALLA 2'; END IF;
  DELETE FROM public.expenses WHERE id = g;
  IF EXISTS (SELECT 1 FROM public.financial_movements WHERE source_id = g) THEN RAISE EXCEPTION 'FALLA 3'; END IF;
  RAISE EXCEPTION 'OK 0-3';
END $$;

ROLLBACK;
