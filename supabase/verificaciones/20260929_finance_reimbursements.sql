-- Verificación reversible del circuito completo de reembolso.
BEGIN;

DO $verify$
DECLARE
  v_org uuid := gen_random_uuid();
  v_user uuid;
  v_request uuid;
  v_expense uuid;
  v_details jsonb;
  v_count integer;
  v_denied boolean;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships
  WHERE role = 'owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'requires an existing owner';
  INSERT INTO public.organizations(id, name, slug, owner_user_id)
  VALUES (v_org, 'ZZ Finance reimbursement', 'zz-finance-refund-' || v_org, v_user);
  INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');
  PERFORM public.ledger_plan_default(v_org);

  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_request := public.finance_create_reimbursement_request(
    v_org, 'ZZ reintegro viatico', 2500, 'ARS', 'viajes', 'Ventas',
    'Traslado a cliente', 'ZZ Colaborador', 'Mercado Pago', 'email',
    'zz-reembolso@invalid.test'
  );
  RESET ROLE;

  ASSERT (SELECT identifier_encrypted <> 'zz-reembolso@invalid.test'
    FROM public.finance_reimbursement_destinations WHERE request_id = v_request),
    'destination was stored in plain text';
  ASSERT (SELECT payout_identifier_masked NOT LIKE 'zz-reembolso%'
    FROM public.finance_expense_requests WHERE id = v_request),
    'public request exposes the destination';

  SET LOCAL ROLE authenticated;
  PERFORM public.finance_approve_expense_request(v_request);
  v_details := public.finance_reimbursement_settlement_details(v_request);
  ASSERT v_details->>'identifier' = 'zz-reembolso@invalid.test',
    'authorized payer cannot reveal destination';

  v_denied := false;
  BEGIN
    UPDATE public.finance_expense_requests SET status = 'paid' WHERE id = v_request;
  EXCEPTION WHEN check_violation THEN v_denied := true;
  END;
  ASSERT v_denied, 'direct paid transition bypassed settlement evidence';

  v_expense := public.finance_settle_reimbursement(
    v_request, 'MP-ZZ-REEMBOLSO', 'mercadopago'
  );
  ASSERT v_expense IS NOT NULL, 'settlement did not create expense';
  ASSERT (SELECT status = 'paid' AND payment_reference = 'MP-ZZ-REEMBOLSO'
    FROM public.finance_expense_requests WHERE id = v_request),
    'request does not retain payment evidence';
  PERFORM public.finance_settle_reimbursement(v_request, 'MP-ZZ-REEMBOLSO', 'mercadopago');
  RESET ROLE;

  SELECT count(*) INTO v_count FROM public.expenses
  WHERE expense_request_id = v_request AND cost_center = 'Ventas'
    AND payment_method = 'mercadopago';
  ASSERT v_count = 1, 'settlement duplicated expense or lost dimensions';
  SELECT count(*) INTO v_count FROM public.ledger_entries
  WHERE referencia_tipo = 'gasto' AND referencia_id = v_expense;
  ASSERT v_count = 1, 'reimbursement did not reach ledger exactly once';

  RAISE NOTICE 'PASS: encrypted request, approval, settlement, idempotency and ledger';
END
$verify$;

ROLLBACK;
SELECT count(*) AS remaining_test_organizations
FROM public.organizations WHERE name = 'ZZ Finance reimbursement';
