-- Anticipos a rendir: desembolso, rendicion y devolucion sin reconocer gasto
-- antes de que exista un comprobante.

BEGIN;

CREATE TABLE public.finance_advances (
  request_id uuid PRIMARY KEY REFERENCES public.finance_expense_requests(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  disbursed_amount numeric(15,2) NOT NULL CHECK (disbursed_amount > 0),
  rendered_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (rendered_amount >= 0),
  returned_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (returned_amount >= 0),
  state text NOT NULL DEFAULT 'pending_disbursement' CHECK (state IN ('pending_disbursement', 'open', 'settled', 'overdue')),
  disbursement_entry_id uuid REFERENCES public.ledger_entries(id) ON DELETE RESTRICT,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (rendered_amount + returned_amount <= disbursed_amount)
);

CREATE TABLE public.finance_advance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_request_id uuid NOT NULL REFERENCES public.finance_advances(request_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_kind text NOT NULL CHECK (item_kind IN ('expense', 'return')),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  category text,
  evidence_reference text NOT NULL,
  expense_id uuid REFERENCES public.expenses(id) ON DELETE RESTRICT,
  ledger_entry_id uuid REFERENCES public.ledger_entries(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS advance_request_id uuid REFERENCES public.finance_advances(request_id) ON DELETE SET NULL;

CREATE INDEX finance_advances_org_state ON public.finance_advances(org_id, state, due_date);
CREATE INDEX finance_advance_items_request ON public.finance_advance_items(advance_request_id, created_at);
CREATE UNIQUE INDEX finance_advance_items_evidence_once
  ON public.finance_advance_items(advance_request_id, item_kind, evidence_reference);
CREATE INDEX expenses_advance_request ON public.expenses(advance_request_id) WHERE advance_request_id IS NOT NULL;

ALTER TABLE public.finance_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_advance_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_advances_org ON public.finance_advances
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));
CREATE POLICY finance_advance_items_org ON public.finance_advance_items
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));
REVOKE ALL ON public.finance_advances, public.finance_advance_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_advances, public.finance_advance_items TO authenticated;

CREATE OR REPLACE FUNCTION public.finance_ensure_advance_account(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  INSERT INTO public.ledger_accounts(org_id, codigo, nombre, tipo, imputable, descripcion)
  VALUES (p_org_id, '1.2.02', 'Anticipos a rendir', 'activo', true,
          'Fondos entregados pendientes de comprobantes o devolucion')
  ON CONFLICT (org_id, codigo) DO NOTHING;
END;
$fn$;
REVOKE ALL ON FUNCTION public.finance_ensure_advance_account(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finance_create_advance_request(
  p_org_id uuid, p_title text, p_amount numeric, p_currency text,
  p_category text, p_cost_center text, p_motive text,
  p_beneficiary_name text, p_provider_label text, p_destination_type text,
  p_identifier text, p_due_date date
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_request uuid;
  v_type text := lower(btrim(COALESCE(p_destination_type, '')));
  v_identifier text := btrim(COALESCE(p_identifier, ''));
  v_masked text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR char_length(btrim(COALESCE(p_title, ''))) < 3
     OR char_length(btrim(COALESCE(p_beneficiary_name, ''))) < 2 THEN
    RAISE EXCEPTION 'Completa titulo, beneficiario y monto' USING ERRCODE = '22023';
  END IF;
  IF upper(btrim(COALESCE(p_currency, 'ARS'))) <> 'ARS' THEN
    RAISE EXCEPTION 'Los anticipos operan en ARS hasta habilitar cuentas multimoneda' USING ERRCODE = '22023';
  END IF;
  IF p_due_date IS NULL OR p_due_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha de rendicion no puede estar vencida' USING ERRCODE = '22023';
  END IF;
  IF v_type NOT IN ('email', 'cbu', 'cvu', 'alias', 'wallet_handle') THEN
    RAISE EXCEPTION 'Tipo de destino no valido' USING ERRCODE = '22023';
  END IF;
  IF v_type IN ('cbu', 'cvu') AND v_identifier !~ '^[0-9]{22}$' THEN
    RAISE EXCEPTION 'El CBU o CVU debe tener 22 digitos' USING ERRCODE = '22023';
  ELSIF v_type = 'email' AND v_identifier !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'El email de cobro no es valido' USING ERRCODE = '22023';
  ELSIF v_type IN ('alias', 'wallet_handle') AND char_length(v_identifier) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'El alias o usuario de billetera no es valido' USING ERRCODE = '22023';
  END IF;
  v_masked := CASE
    WHEN v_type IN ('cbu', 'cvu') THEN '•••• •••• •••• •••• ••' || right(v_identifier, 4)
    WHEN v_type = 'email' THEN left(v_identifier, 2) || '••••@' || split_part(v_identifier, '@', 2)
    ELSE left(v_identifier, LEAST(3, char_length(v_identifier))) || '••••' || right(v_identifier, LEAST(3, char_length(v_identifier)))
  END;
  v_request := gen_random_uuid();
  INSERT INTO public.finance_expense_requests(
    id, org_id, user_id, title, amount, currency, category, cost_center, motive,
    status, request_kind, beneficiary_name, payout_provider_label,
    payout_destination_type, payout_identifier_masked
  ) VALUES (
    v_request, p_org_id, auth.uid(), btrim(p_title), round(p_amount, 2),
    COALESCE(NULLIF(upper(btrim(p_currency)), ''), 'ARS'), p_category, p_cost_center,
    p_motive, 'pending', 'advance', btrim(p_beneficiary_name), btrim(p_provider_label),
    v_type, v_masked
  );
  INSERT INTO public.finance_reimbursement_destinations(request_id, org_id, identifier_encrypted, created_by)
  VALUES (v_request, p_org_id, public.secret_encrypt(v_identifier), auth.uid());
  INSERT INTO public.finance_advances(request_id, org_id, due_date, disbursed_amount)
  VALUES (v_request, p_org_id, p_due_date, round(p_amount, 2));
  RETURN v_request;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_advance_settlement_details(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_request public.finance_expense_requests; v_identifier text; v_due date;
BEGIN
  SELECT * INTO v_request FROM public.finance_expense_requests WHERE id = p_request_id;
  IF v_request.id IS NULL OR v_request.request_kind <> 'advance' OR v_request.status <> 'approved' THEN
    RAISE EXCEPTION 'El anticipo no esta aprobado' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_permission(v_request.org_id, 'expenses', 'edit') THEN
    RAISE EXCEPTION 'Sin permiso para desembolsar anticipos' USING ERRCODE = '42501';
  END IF;
  SELECT public.secret_decrypt(destination.identifier_encrypted), advance.due_date
    INTO v_identifier, v_due
  FROM public.finance_reimbursement_destinations destination
  JOIN public.finance_advances advance ON advance.request_id = destination.request_id
  WHERE destination.request_id = p_request_id;
  RETURN jsonb_build_object('beneficiary_name', v_request.beneficiary_name,
    'provider_label', v_request.payout_provider_label, 'identifier', v_identifier,
    'masked', v_request.payout_identifier_masked, 'due_date', v_due);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_disburse_advance(
  p_request_id uuid, p_payment_reference text, p_payment_method text DEFAULT 'transferencia'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_request public.finance_expense_requests; v_advance public.finance_advances; v_entry uuid;
  v_reference text := left(btrim(COALESCE(p_payment_reference, '')), 160);
BEGIN
  SELECT * INTO v_request FROM public.finance_expense_requests WHERE id = p_request_id FOR UPDATE;
  SELECT * INTO v_advance FROM public.finance_advances WHERE request_id = p_request_id FOR UPDATE;
  IF v_request.id IS NULL OR v_request.request_kind <> 'advance' THEN
    RAISE EXCEPTION 'Anticipo no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.has_permission(v_request.org_id, 'expenses', 'edit') THEN
    RAISE EXCEPTION 'Sin permiso para desembolsar anticipos' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reference) < 3 THEN RAISE EXCEPTION 'Ingresa la referencia del pago' USING ERRCODE = '22023'; END IF;
  IF v_request.status = 'paid' THEN
    IF v_request.payment_reference IS DISTINCT FROM v_reference THEN
      RAISE EXCEPTION 'El anticipo ya fue desembolsado con otra referencia' USING ERRCODE = '22023';
    END IF;
    RETURN v_advance.disbursement_entry_id;
  END IF;
  IF v_request.status <> 'approved' THEN RAISE EXCEPTION 'Primero aproba el anticipo' USING ERRCODE = '22023'; END IF;
  PERFORM public.finance_ensure_advance_account(v_request.org_id);
  v_entry := public.ledger_asentar(v_request.org_id, 'Desembolso de anticipo - ' || v_request.title,
    jsonb_build_array(
      jsonb_build_object('cuenta','1.2.02','debe',v_request.amount,'detalle',v_request.beneficiary_name,
        'metadata',jsonb_build_object('advance_request_id',v_request.id,'payment_reference',v_reference)),
      jsonb_build_object('cuenta','1.1.02','haber',v_request.amount,'detalle','Salida bancaria por anticipo',
        'metadata',jsonb_build_object('advance_request_id',v_request.id,'payment_method',p_payment_method))
    ), CURRENT_DATE, 'anticipo_desembolso', v_request.id, v_request.currency);
  UPDATE public.finance_advances SET state = 'open', disbursement_entry_id = v_entry, updated_at = now()
    WHERE request_id = p_request_id;
  UPDATE public.finance_expense_requests SET status = 'paid', payment_reference = v_reference,
    payment_method = left(btrim(COALESCE(p_payment_method,'transferencia')),40), paid_at = now(), updated_at = now()
    WHERE id = p_request_id;
  RETURN v_entry;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ledger_asentar_gasto(p_expense_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_e public.expenses; v_existing uuid; v_credit_account text;
BEGIN
  SELECT * INTO v_e FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'El gasto no existe'; END IF;
  SELECT entry.id INTO v_existing FROM public.ledger_entries entry
   WHERE entry.org_id = v_e.org_id AND entry.referencia_tipo = 'gasto'
     AND entry.referencia_id = v_e.id AND entry.anulado_por IS NULL AND entry.anula_a IS NULL LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  IF COALESCE(v_e.amount_ars, 0) <= 0 THEN RAISE EXCEPTION 'El gasto % no tiene importe', v_e.id; END IF;
  v_credit_account := CASE WHEN v_e.advance_request_id IS NOT NULL THEN '1.2.02' ELSE '1.1.01' END;
  RETURN public.ledger_asentar(v_e.org_id, 'Gasto' || COALESCE(' - ' || v_e.description, ''),
    jsonb_build_array(
      jsonb_build_object('cuenta','5.9.01','debe',round(v_e.amount_ars,2),'detalle',COALESCE(v_e.category,'sin categoria'),
        'metadata',jsonb_strip_nulls(jsonb_build_object('expense_id',v_e.id,'category',v_e.category,'centro_costo',v_e.cost_center,'expense_request_id',v_e.expense_request_id,'advance_request_id',v_e.advance_request_id,'payment_method',v_e.payment_method))),
      jsonb_build_object('cuenta',v_credit_account,'haber',round(v_e.amount_ars,2),
        'detalle',CASE WHEN v_e.advance_request_id IS NOT NULL THEN 'Aplicacion del anticipo' ELSE 'Salida de caja' END,
        'metadata',jsonb_strip_nulls(jsonb_build_object('expense_id',v_e.id,'centro_costo',v_e.cost_center,'expense_request_id',v_e.expense_request_id,'advance_request_id',v_e.advance_request_id,'payment_method',v_e.payment_method)))
    ), COALESCE(v_e.date::date,v_e.created_at::date),'gasto',v_e.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ledger_asentar_gasto(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finance_render_advance_expense(
  p_request_id uuid, p_amount numeric, p_description text, p_category text,
  p_evidence_reference text, p_date date DEFAULT CURRENT_DATE
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_request public.finance_expense_requests; v_advance public.finance_advances; v_expense uuid; v_remaining numeric;
BEGIN
  SELECT * INTO v_request FROM public.finance_expense_requests WHERE id = p_request_id;
  SELECT * INTO v_advance FROM public.finance_advances WHERE request_id = p_request_id FOR UPDATE;
  IF v_request.id IS NULL OR v_request.request_kind <> 'advance' OR v_advance.state NOT IN ('open','overdue') THEN
    RAISE EXCEPTION 'El anticipo no esta abierto para rendicion' USING ERRCODE = '22023';
  END IF;
  IF auth.uid() <> v_request.user_id AND NOT public.has_permission(v_request.org_id,'expenses','edit') THEN
    RAISE EXCEPTION 'Sin permiso para rendir este anticipo' USING ERRCODE = '42501';
  END IF;
  SELECT item.expense_id INTO v_expense FROM public.finance_advance_items item
    WHERE item.advance_request_id=p_request_id AND item.item_kind='expense'
      AND item.evidence_reference=left(btrim(COALESCE(p_evidence_reference,'')),160);
  IF v_expense IS NOT NULL THEN RETURN v_expense; END IF;
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
  IF v_request.id IS NULL OR v_advance.state NOT IN ('open','overdue') THEN RAISE EXCEPTION 'Anticipo no disponible' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_permission(v_request.org_id,'expenses','edit') THEN RAISE EXCEPTION 'Sin permiso para confirmar fondos devueltos' USING ERRCODE = '42501'; END IF;
  SELECT item.ledger_entry_id INTO v_entry FROM public.finance_advance_items item
    WHERE item.advance_request_id=p_request_id AND item.item_kind='return'
      AND item.evidence_reference=left(btrim(COALESCE(p_return_reference,'')),160);
  IF v_entry IS NOT NULL THEN RETURN v_entry; END IF;
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

CREATE OR REPLACE FUNCTION public.finance_advance_summary(p_request_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT jsonb_build_object('request_id',advance.request_id,'due_date',advance.due_date,'state',
    CASE WHEN advance.state = 'open' AND advance.due_date < CURRENT_DATE THEN 'overdue' ELSE advance.state END,
    'disbursed_amount',advance.disbursed_amount,'rendered_amount',advance.rendered_amount,
    'returned_amount',advance.returned_amount,'remaining_amount',advance.disbursed_amount-advance.rendered_amount-advance.returned_amount)
  FROM public.finance_advances advance
  WHERE advance.request_id = p_request_id AND public.is_org_member(advance.org_id,auth.uid());
$fn$;

CREATE OR REPLACE FUNCTION public.finance_require_reimbursement_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.request_kind IN ('reimbursement','advance') AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.status = 'approved' AND NEW.approved_by = NEW.user_id
     AND EXISTS (SELECT 1 FROM public.memberships membership WHERE membership.org_id=NEW.org_id
       AND membership.user_id<>NEW.user_id AND membership.role IN ('owner','admin')) THEN
    RAISE EXCEPTION 'Otro responsable debe aprobar esta solicitud' USING ERRCODE = '42501';
  END IF;
  IF NEW.request_kind IN ('reimbursement','advance') AND NEW.status='paid'
     AND (NEW.payment_reference IS NULL OR NEW.paid_at IS NULL) THEN
    RAISE EXCEPTION 'El pago requiere referencia y fecha' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.finance_create_advance_request(uuid,text,numeric,text,text,text,text,text,text,text,text,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finance_advance_settlement_details(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finance_disburse_advance(uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finance_render_advance_expense(uuid,numeric,text,text,text,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finance_return_advance_balance(uuid,numeric,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finance_advance_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_create_advance_request(uuid,text,numeric,text,text,text,text,text,text,text,text,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_advance_settlement_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_disburse_advance(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_render_advance_expense(uuid,numeric,text,text,text,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_return_advance_balance(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_advance_summary(uuid) TO authenticated;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT contract.function_name, contract.identity_arguments, 'authenticated_delegate',
       contract.rationale, md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-29'
FROM (VALUES
  ('finance_create_advance_request', 'p_org_id uuid, p_title text, p_amount numeric, p_currency text, p_category text, p_cost_center text, p_motive text, p_beneficiary_name text, p_provider_label text, p_destination_type text, p_identifier text, p_due_date date', 'El solicitante crea un anticipo con destino cifrado y fecha de rendicion.'),
  ('finance_advance_settlement_details', 'p_request_id uuid', 'Solo un pagador autorizado revela el destino de un anticipo aprobado.'),
  ('finance_disburse_advance', 'p_request_id uuid, p_payment_reference text, p_payment_method text', 'Desembolsa contra referencia y reconoce un activo pendiente de rendicion.'),
  ('finance_render_advance_expense', 'p_request_id uuid, p_amount numeric, p_description text, p_category text, p_evidence_reference text, p_date date', 'Reclasifica una parte del anticipo a gasto contra evidencia.'),
  ('finance_return_advance_balance', 'p_request_id uuid, p_amount numeric, p_return_reference text', 'Registra fondos devueltos y reduce el activo pendiente.'),
  ('finance_advance_summary', 'p_request_id uuid', 'Expone el saldo del anticipo solo a miembros de la organizacion.')
) AS contract(function_name, identity_arguments, rationale)
JOIN pg_proc procedure ON procedure.proname = contract.function_name
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace AND namespace.nspname = 'public'
WHERE pg_get_function_identity_arguments(procedure.oid) = contract.identity_arguments
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  rationale = EXCLUDED.rationale, definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
