-- Un reintento con la misma evidencia debe devolver el resultado original aun
-- cuando ese primer movimiento haya cerrado el anticipo.

CREATE OR REPLACE FUNCTION public.finance_render_advance_expense(
  p_request_id uuid, p_amount numeric, p_description text, p_category text,
  p_evidence_reference text, p_date date DEFAULT CURRENT_DATE
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_request public.finance_expense_requests; v_advance public.finance_advances; v_expense uuid; v_remaining numeric;
BEGIN
  SELECT * INTO v_request FROM public.finance_expense_requests WHERE id = p_request_id;
  SELECT * INTO v_advance FROM public.finance_advances WHERE request_id = p_request_id FOR UPDATE;
  IF v_request.id IS NULL OR v_request.request_kind <> 'advance' THEN
    RAISE EXCEPTION 'Anticipo no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() <> v_request.user_id AND NOT public.has_permission(v_request.org_id,'expenses','edit') THEN
    RAISE EXCEPTION 'Sin permiso para rendir este anticipo' USING ERRCODE = '42501';
  END IF;
  SELECT item.expense_id INTO v_expense FROM public.finance_advance_items item
    WHERE item.advance_request_id=p_request_id AND item.item_kind='expense'
      AND item.evidence_reference=left(btrim(COALESCE(p_evidence_reference,'')),160);
  IF v_expense IS NOT NULL THEN RETURN v_expense; END IF;
  IF v_advance.state NOT IN ('open','overdue') THEN
    RAISE EXCEPTION 'El anticipo no esta abierto para rendicion' USING ERRCODE = '22023';
  END IF;
  v_remaining := v_advance.disbursed_amount - v_advance.rendered_amount - v_advance.returned_amount;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > v_remaining THEN
    RAISE EXCEPTION 'El importe supera el saldo pendiente de %', v_remaining USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(COALESCE(p_description,''))) < 3 OR char_length(btrim(COALESCE(p_evidence_reference,''))) < 3 THEN
    RAISE EXCEPTION 'Completa descripcion y referencia del comprobante' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.expenses(org_id,user_id,description,amount_ars,category,cost_center,payment_method,advance_request_id,date,vendor)
  VALUES(v_request.org_id,auth.uid(),btrim(p_description),round(p_amount,2),COALESCE(p_category,v_request.category,'otros'),
    v_request.cost_center,'anticipo_rendido',p_request_id,COALESCE(p_date,CURRENT_DATE),COALESCE(v_request.beneficiary_name,'Anticipo'))
  RETURNING id INTO v_expense;
  INSERT INTO public.finance_advance_items(advance_request_id,org_id,item_kind,amount,description,category,evidence_reference,expense_id,created_by)
  VALUES(p_request_id,v_request.org_id,'expense',round(p_amount,2),btrim(p_description),COALESCE(p_category,v_request.category),left(btrim(p_evidence_reference),160),v_expense,auth.uid());
  UPDATE public.finance_advances SET rendered_amount = rendered_amount + round(p_amount,2),
    state = CASE WHEN rendered_amount + returned_amount + round(p_amount,2) = disbursed_amount THEN 'settled' ELSE state END,
    closed_at = CASE WHEN rendered_amount + returned_amount + round(p_amount,2) = disbursed_amount THEN now() ELSE closed_at END,
    updated_at = now() WHERE request_id = p_request_id;
  RETURN v_expense;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_return_advance_balance(
  p_request_id uuid, p_amount numeric, p_return_reference text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_request public.finance_expense_requests; v_advance public.finance_advances; v_remaining numeric; v_entry uuid;
BEGIN
  SELECT * INTO v_request FROM public.finance_expense_requests WHERE id = p_request_id;
  SELECT * INTO v_advance FROM public.finance_advances WHERE request_id = p_request_id FOR UPDATE;
  IF v_request.id IS NULL OR v_request.request_kind <> 'advance' THEN
    RAISE EXCEPTION 'Anticipo no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.has_permission(v_request.org_id,'expenses','edit') THEN
    RAISE EXCEPTION 'Sin permiso para confirmar fondos devueltos' USING ERRCODE = '42501';
  END IF;
  SELECT item.ledger_entry_id INTO v_entry FROM public.finance_advance_items item
    WHERE item.advance_request_id=p_request_id AND item.item_kind='return'
      AND item.evidence_reference=left(btrim(COALESCE(p_return_reference,'')),160);
  IF v_entry IS NOT NULL THEN RETURN v_entry; END IF;
  IF v_advance.state NOT IN ('open','overdue') THEN
    RAISE EXCEPTION 'Anticipo no disponible' USING ERRCODE = '22023';
  END IF;
  v_remaining := v_advance.disbursed_amount - v_advance.rendered_amount - v_advance.returned_amount;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > v_remaining OR char_length(btrim(COALESCE(p_return_reference,''))) < 3 THEN
    RAISE EXCEPTION 'Importe o referencia de devolucion invalida' USING ERRCODE = '22023';
  END IF;
  v_entry := public.ledger_asentar(v_request.org_id,'Devolucion de anticipo - ' || v_request.title,
    jsonb_build_array(
      jsonb_build_object('cuenta','1.1.02','debe',round(p_amount,2),'detalle','Fondos devueltos'),
      jsonb_build_object('cuenta','1.2.02','haber',round(p_amount,2),'detalle','Cancelacion del anticipo')
    ),CURRENT_DATE,'anticipo_devolucion',gen_random_uuid(),v_request.currency);
  INSERT INTO public.finance_advance_items(advance_request_id,org_id,item_kind,amount,description,evidence_reference,ledger_entry_id,created_by)
  VALUES(p_request_id,v_request.org_id,'return',round(p_amount,2),'Devolucion de saldo',left(btrim(p_return_reference),160),v_entry,auth.uid());
  UPDATE public.finance_advances SET returned_amount = returned_amount + round(p_amount,2),
    state = CASE WHEN rendered_amount + returned_amount + round(p_amount,2) = disbursed_amount THEN 'settled' ELSE state END,
    closed_at = CASE WHEN rendered_amount + returned_amount + round(p_amount,2) = disbursed_amount THEN now() ELSE closed_at END,
    updated_at = now() WHERE request_id = p_request_id;
  RETURN v_entry;
END;
$fn$;

UPDATE public.security_function_contracts contract SET
  definition_hash = md5(pg_get_functiondef(procedure.oid)), reviewed_on = DATE '2026-09-29'
FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
WHERE namespace.nspname='public' AND procedure.proname=contract.function_name
  AND pg_get_function_identity_arguments(procedure.oid)=contract.identity_arguments
  AND contract.function_name IN ('finance_render_advance_expense','finance_return_advance_balance');
