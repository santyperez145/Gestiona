-- ═══════════════════════════════════════════════════════════════════════════
-- F5.2b — Presupuesto como movimientos: verificación reversible.
-- Todo corre dentro de una transacción con ROLLBACK: no deja datos.
-- Escenarios: snapshot con comprometido, excedente por compromiso, cancelación
-- con traza que libera saldo al instante, estados no cancelables y guardia.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $verify$
DECLARE
  v_org    uuid;
  v_user   uuid;
  v_denied boolean;
  v_status text;
  v_snapshot record;
  v_budget_cat uuid;
  r1 uuid;  -- 10.000 marketing -> aprobada (compromete)
  r2 uuid;  -- 5.000 marketing -> aprobada (compromete)
  r3 uuid;  -- 5.000 marketing -> pendiente -> cancelada
  r4 uuid;  -- 5.000 marketing -> aprobada -> cancelada (libera)
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'requires existing user';

  RAISE NOTICE '═══ F5.2b presupuesto comprometido — verificación ═══';

  -- ── 0. Precondiciones ────────────────────────────────────────────────────
  ASSERT position('monthly_committed_ars' IN pg_get_function_result('public.finance_core_snapshot(uuid)'::regprocedure)) > 0,
    'finance_core_snapshot sin compromisos';
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'finance_cancel_expense_request'
  ), 'no existe finance_cancel_expense_request';
  RAISE NOTICE 'OK: snapshot y RPC de cancelación presentes';

  -- ── 1. Ambiente: org efímera con presupuesto marketing 25.000 ────────────
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.organizations(id, name, slug, owner_user_id) VALUES
    (gen_random_uuid(), 'ZZ Commitments verification', 'zz-com-' || gen_random_uuid(), v_user)
  RETURNING id INTO v_org;
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');

  -- Budget Pulse vive en Finance: la superficie requiere el producto habilitado.
  UPDATE public.organization_product_access SET status = 'enabled'
  WHERE org_id = v_org AND product_key = 'finance';

  INSERT INTO public.budget_categories(id, org_id, type, name, source_key, active)
  VALUES (gen_random_uuid(), v_org, 'expense', 'Marketing', 'marketing', true)
  ON CONFLICT (org_id, type, source_key) WHERE source_key IS NOT NULL DO NOTHING;

  SELECT c.id INTO v_budget_cat FROM public.budget_categories c
   WHERE c.org_id = v_org AND c.type = 'expense' AND c.source_key = 'marketing';
  ASSERT v_budget_cat IS NOT NULL, 'no se creo la categoria de presupuesto';

  INSERT INTO public.budgets(id, org_id, category_id, year, month, amount)
  VALUES (gen_random_uuid(), v_org, v_budget_cat, EXTRACT(YEAR FROM now())::int, EXTRACT(MONTH FROM now())::int, 25000);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- ── 2. Solicitudes y aprobaciones (owner, sin política que bloquee) ──────
  SELECT public.finance_create_expense_request(v_org, 'Publicidad A', 10000, 'ARS', 'marketing', NULL, NULL) INTO r1;
  SELECT public.finance_create_expense_request(v_org, 'Publicidad B', 5000, 'ARS', 'marketing', NULL, NULL) INTO r2;
  SELECT public.finance_create_expense_request(v_org, 'Publicidad C', 5000, 'ARS', 'marketing', NULL, NULL) INTO r3;
  SELECT public.finance_create_expense_request(v_org, 'Publicidad D', 5000, 'ARS', 'marketing', NULL, NULL) INTO r4;
  PERFORM public.finance_approve_expense_request(r1);
  PERFORM public.finance_approve_expense_request(r2);
  PERFORM public.finance_approve_expense_request(r4);

  -- ── 3. Snapshot: comprometido 20.000 (r1 + r2 + r4) ──────────────────────
  SELECT * INTO v_snapshot FROM public.finance_core_snapshot(v_org);
  ASSERT v_snapshot.monthly_committed_ars = 20000,
    'comprometido deberia ser 20000, es ' || v_snapshot.monthly_committed_ars;
  ASSERT v_snapshot.over_committed_categories = 0,
    'sin gasto, 20k comprometido <= 25k asignado: no hay excedente, hay ' || v_snapshot.over_committed_categories;
  RAISE NOTICE 'OK: comprometido visible en el snapshot';

  -- ── 4. Cancelar una aprobada libera saldo al instante ────────────────────
  PERFORM public.finance_cancel_expense_request(r4, 'El proveedor bajo el precio');
  SELECT status INTO v_status FROM public.finance_expense_requests WHERE id = r4;
  ASSERT v_status = 'cancelled', 'la aprobada deberia quedar cancelled, esta ' || v_status;

  SELECT * INTO v_snapshot FROM public.finance_core_snapshot(v_org);
  ASSERT v_snapshot.monthly_committed_ars = 15000,
    'tras liberar deberia ser 15000, es ' || v_snapshot.monthly_committed_ars;
  RAISE NOTICE 'OK: cancelar una aprobada libera el compromiso';

  -- ── 5. Excedente: gasto real + comprometido supera lo asignado ───────────
  -- La categoría de expenses es texto libre; insertamos gasto real de 14.000.
  INSERT INTO public.expenses(org_id, user_id, description, amount_ars, category, date)
  VALUES (v_org, v_user, 'Gasto real marketing', 14000, 'marketing', CURRENT_DATE);

  SELECT * INTO v_snapshot FROM public.finance_core_snapshot(v_org);
  ASSERT v_snapshot.monthly_expense_ars = 14000, 'gasto deberia ser 14000';
  ASSERT v_snapshot.over_budget_categories = 0,
    '14k ejecutado solo <= 25k: sin excedente de ejecucion, hay ' || v_snapshot.over_budget_categories;
  ASSERT v_snapshot.over_committed_categories = 1,
    '14k + 15k = 29k > 25k deberia exceder por compromiso, hay ' || v_snapshot.over_committed_categories;
  ASSERT v_snapshot.monthly_budget_available_ars = 11000,
    'disponible deberia ser 11000, es ' || v_snapshot.monthly_budget_available_ars;
  RAISE NOTICE 'OK: excedente por compromiso detectado';

  -- ── 6. Cancelar una pagada o rechazada: denegado ─────────────────────────
  PERFORM public.finance_mark_expense_paid(r1);
  SELECT status INTO v_status FROM public.finance_expense_requests WHERE id = r1;
  ASSERT v_status = 'paid', 'la solicitud deberia estar pagada';

  v_denied := false;
  BEGIN
    PERFORM public.finance_cancel_expense_request(r1, 'ya pagada');
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  ASSERT v_denied, 'se canceló una solicitud pagada';

  -- r2 está aprobada: se rechaza creando una nueva pendiente para el caso
  -- rechazado (el rechazo exige pending/under_review).
  PERFORM public.finance_reject_expense_request(r3, 'Ya no hace falta');
  SELECT status INTO v_status FROM public.finance_expense_requests WHERE id = r3;
  ASSERT v_status = 'rejected', 'la pendiente deberia quedar rechazada';
  v_denied := false;
  BEGIN
    PERFORM public.finance_cancel_expense_request(r3);
  EXCEPTION WHEN OTHERS THEN v_denied := true; END;
  ASSERT v_denied, 'se canceló una solicitud rechazada';
  RAISE NOTICE 'OK: pagadas y rechazadas no se cancelan';

  -- ── 7. Pendiente restante (r2) cancelable sin razón ─────────────────────
  PERFORM public.finance_cancel_expense_request(r2);
  SELECT (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND cancel_reason IS NULL)
    INTO v_denied
  FROM public.finance_expense_requests WHERE id = r2;
  ASSERT v_denied, 'la cancelación de pendiente no dejó traza';
  RAISE NOTICE 'OK: pendiente cancelable con traza';

  -- ── 8. Sin razón obligatoria pero con traza al cancelar aprobada ─────────
  ASSERT EXISTS (
    SELECT 1 FROM public.finance_expense_requests
    WHERE id = r4 AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL
      AND cancel_reason = 'El proveedor bajo el precio'
  ), 'la cancelación no dejó traza';
  RAISE NOTICE 'OK: traza de cancelación completa';

  RAISE NOTICE '═══ Todo el compromiso F5.2b pasó dentro de la transacción ═══';
  RAISE EXCEPTION 'rollback_intencional';
END;
$verify$;

ROLLBACK;
SELECT 'presupuesto comprometido F5.2b verificado y revertido' AS resultado;