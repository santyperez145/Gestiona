-- Verificacion reversible: anticipo -> desembolso -> rendicion -> devolucion.
BEGIN;

DO $verify$
DECLARE
  v_org uuid := gen_random_uuid();
  v_user uuid;
  v_request uuid;
  v_disbursement uuid;
  v_expense uuid;
  v_return uuid;
  v_count integer;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships WHERE role='owner' ORDER BY joined_at LIMIT 1;
  ASSERT v_user IS NOT NULL, 'requires an existing owner';
  INSERT INTO public.organizations(id,name,slug,owner_user_id)
    VALUES(v_org,'ZZ Finance advance','zz-finance-advance-'||v_org,v_user);
  INSERT INTO public.memberships(org_id,user_id,role) VALUES(v_org,v_user,'owner');
  PERFORM public.ledger_plan_default(v_org);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);

  SET LOCAL ROLE authenticated;
  v_request := public.finance_create_advance_request(
    v_org,'ZZ viaje comercial',1000,'ARS','viajes','Ventas','Visita a cliente',
    'ZZ Colaborador','Banco prueba','alias','zz.anticipo',CURRENT_DATE+7
  );
  PERFORM public.finance_approve_expense_request(v_request);
  v_disbursement := public.finance_disburse_advance(v_request,'TR-ZZ-ADVANCE','transferencia');
  ASSERT v_disbursement IS NOT NULL, 'advance was not disbursed';
  ASSERT (SELECT state='open' FROM public.finance_advances WHERE request_id=v_request), 'advance is not open';

  v_expense := public.finance_render_advance_expense(v_request,600,'Hotel cliente','viajes','FC-ZZ-001',CURRENT_DATE);
  PERFORM public.finance_render_advance_expense(v_request,600,'Hotel cliente','viajes','FC-ZZ-001',CURRENT_DATE);
  v_return := public.finance_return_advance_balance(v_request,400,'TR-ZZ-RETURN');
  PERFORM public.finance_return_advance_balance(v_request,400,'TR-ZZ-RETURN');
  RESET ROLE;

  ASSERT v_expense IS NOT NULL AND v_return IS NOT NULL, 'rendition or return was not recorded';
  ASSERT (SELECT state='settled' AND rendered_amount=600 AND returned_amount=400
    FROM public.finance_advances WHERE request_id=v_request), 'advance did not settle at zero';
  SELECT count(*) INTO v_count FROM public.finance_advance_items WHERE advance_request_id=v_request;
  ASSERT v_count=2, 'idempotent retries duplicated advance items';
  SELECT count(*) INTO v_count FROM public.expenses WHERE advance_request_id=v_request;
  ASSERT v_count=1, 'advance rendition did not create exactly one expense';
  SELECT count(*) INTO v_count FROM public.ledger_entries
    WHERE (referencia_tipo='anticipo_desembolso' AND referencia_id=v_request)
       OR (referencia_tipo='gasto' AND referencia_id=v_expense)
       OR id=v_return;
  ASSERT v_count=3, 'advance lifecycle did not create exactly three ledger entries';
  RAISE NOTICE 'PASS: advance asset, rendition, return, idempotency and ledger';
END
$verify$;

ROLLBACK;
SELECT count(*) AS remaining_test_organizations FROM public.organizations WHERE name='ZZ Finance advance';
