-- Reembolsos Finance con segregacion de funciones y destino privado.
-- Solicitar, aprobar y liquidar son transiciones distintas. El pago exige una
-- referencia externa y crea gasto + ledger en la misma transaccion.

BEGIN;

ALTER TABLE public.finance_expense_requests
  ADD COLUMN IF NOT EXISTS request_kind text NOT NULL DEFAULT 'expense'
    CHECK (request_kind IN ('expense', 'reimbursement', 'advance')),
  ADD COLUMN IF NOT EXISTS beneficiary_name text,
  ADD COLUMN IF NOT EXISTS payout_provider_label text,
  ADD COLUMN IF NOT EXISTS payout_destination_type text,
  ADD COLUMN IF NOT EXISTS payout_identifier_masked text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

CREATE TABLE IF NOT EXISTS public.finance_reimbursement_destinations (
  request_id uuid PRIMARY KEY REFERENCES public.finance_expense_requests(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  identifier_encrypted text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.finance_reimbursement_destinations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.finance_reimbursement_destinations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finance_create_reimbursement_request(
  p_org_id uuid,
  p_title text,
  p_amount numeric,
  p_currency text,
  p_category text,
  p_cost_center text,
  p_motive text,
  p_beneficiary_name text,
  p_provider_label text,
  p_destination_type text,
  p_identifier text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id uuid := gen_random_uuid();
  v_type text := lower(btrim(COALESCE(p_destination_type, '')));
  v_identifier text := btrim(COALESCE(p_identifier, ''));
  v_masked text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero' USING ERRCODE = '23514';
  END IF;
  IF char_length(btrim(COALESCE(p_title, ''))) < 3
     OR char_length(btrim(COALESCE(p_beneficiary_name, ''))) < 2
     OR char_length(btrim(COALESCE(p_provider_label, ''))) < 2 THEN
    RAISE EXCEPTION 'Completa titulo, beneficiario y proveedor de cobro' USING ERRCODE = '22023';
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

  INSERT INTO public.finance_expense_requests(
    id, org_id, user_id, title, amount, currency, category, cost_center,
    motive, status, request_kind, beneficiary_name, payout_provider_label,
    payout_destination_type, payout_identifier_masked, created_at, updated_at
  ) VALUES (
    v_id, p_org_id, auth.uid(), btrim(p_title), round(p_amount, 2),
    COALESCE(NULLIF(upper(btrim(p_currency)), ''), 'ARS'), p_category, p_cost_center,
    p_motive, 'pending', 'reimbursement', btrim(p_beneficiary_name),
    btrim(p_provider_label), v_type, v_masked, now(), now()
  );

  INSERT INTO public.finance_reimbursement_destinations(
    request_id, org_id, identifier_encrypted, created_by
  ) VALUES (v_id, p_org_id, public.secret_encrypt(v_identifier), auth.uid());

  BEGIN
    PERFORM public.finance_notify_approvers(
      p_org_id, 'Nuevo reembolso', btrim(p_title) || ' - esperando aprobacion',
      v_id, auth.uid()
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'No se pudo notificar el reembolso %: %', v_id, SQLERRM;
  END;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_reimbursement_settlement_details(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_request public.finance_expense_requests;
  v_encrypted text;
BEGIN
  SELECT * INTO v_request FROM public.finance_expense_requests WHERE id = p_request_id;
  IF v_request.id IS NULL OR v_request.request_kind <> 'reimbursement' THEN
    RAISE EXCEPTION 'Reembolso no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.has_permission(v_request.org_id, 'expenses', 'edit') THEN
    RAISE EXCEPTION 'Sin permiso para liquidar reembolsos' USING ERRCODE = '42501';
  END IF;
  IF v_request.status <> 'approved' THEN
    RAISE EXCEPTION 'El reembolso todavia no esta aprobado' USING ERRCODE = '22023';
  END IF;
  SELECT identifier_encrypted INTO v_encrypted
  FROM public.finance_reimbursement_destinations WHERE request_id = p_request_id;
  RETURN jsonb_build_object(
    'beneficiary_name', v_request.beneficiary_name,
    'provider_label', v_request.payout_provider_label,
    'destination_type', v_request.payout_destination_type,
    'identifier', public.secret_decrypt(v_encrypted),
    'masked', v_request.payout_identifier_masked
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_settle_reimbursement(
  p_request_id uuid,
  p_payment_reference text,
  p_payment_method text DEFAULT 'transferencia'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_request public.finance_expense_requests;
  v_expense_id uuid;
  v_reference text := btrim(COALESCE(p_payment_reference, ''));
  v_method text := left(btrim(COALESCE(NULLIF(p_payment_method, ''), 'transferencia')), 40);
BEGIN
  SELECT * INTO v_request FROM public.finance_expense_requests
  WHERE id = p_request_id FOR UPDATE;
  IF v_request.id IS NULL OR v_request.request_kind <> 'reimbursement' THEN
    RAISE EXCEPTION 'Reembolso no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.has_permission(v_request.org_id, 'expenses', 'edit') THEN
    RAISE EXCEPTION 'Sin permiso para liquidar reembolsos' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reference) < 3 THEN
    RAISE EXCEPTION 'Ingresa la referencia de la transferencia' USING ERRCODE = '22023';
  END IF;
  IF v_request.status = 'paid' AND v_request.payment_reference IS DISTINCT FROM left(v_reference, 160) THEN
    RAISE EXCEPTION 'El reembolso ya fue liquidado con otra referencia' USING ERRCODE = '22023';
  END IF;
  IF v_request.status NOT IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'Primero aproba el reembolso' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_expense_id FROM public.expenses
  WHERE expense_request_id = v_request.id LIMIT 1;
  IF v_expense_id IS NULL THEN
    INSERT INTO public.expenses(
      org_id, user_id, description, amount_ars, category, cost_center,
      payment_method, expense_request_id, date, vendor
    ) VALUES (
      v_request.org_id, auth.uid(),
      'Reembolso - ' || v_request.title || COALESCE(' - ' || v_request.motive, ''),
      v_request.amount, COALESCE(v_request.category, 'reembolsos'),
      v_request.cost_center, v_method, v_request.id, CURRENT_DATE,
      COALESCE(v_request.beneficiary_name, 'Beneficiario')
    ) RETURNING id INTO v_expense_id;
  END IF;

  UPDATE public.finance_expense_requests SET
    status = 'paid', payment_reference = left(v_reference, 160),
    payment_method = v_method, paid_at = COALESCE(paid_at, now()), updated_at = now()
  WHERE id = p_request_id;
  RETURN v_expense_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.finance_require_reimbursement_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  IF NEW.request_kind = 'reimbursement' AND NEW.status = 'paid'
     AND (NEW.payment_reference IS NULL OR NEW.paid_at IS NULL) THEN
    RAISE EXCEPTION 'Un reembolso requiere referencia y fecha de pago' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_finance_reimbursement_evidence ON public.finance_expense_requests;
CREATE TRIGGER trg_finance_reimbursement_evidence
  BEFORE INSERT OR UPDATE OF status, payment_reference, paid_at
  ON public.finance_expense_requests
  FOR EACH ROW EXECUTE FUNCTION public.finance_require_reimbursement_evidence();

REVOKE ALL ON FUNCTION public.finance_create_reimbursement_request(uuid,text,numeric,text,text,text,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finance_reimbursement_settlement_details(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finance_settle_reimbursement(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_create_reimbursement_request(uuid,text,numeric,text,text,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_reimbursement_settlement_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_settle_reimbursement(uuid,text,text) TO authenticated;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT contract.function_name, contract.identity_arguments, 'authenticated_delegate',
       contract.rationale, md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-29'
FROM (VALUES
  ('finance_create_reimbursement_request', 'p_org_id uuid, p_title text, p_amount numeric, p_currency text, p_category text, p_cost_center text, p_motive text, p_beneficiary_name text, p_provider_label text, p_destination_type text, p_identifier text', 'El solicitante crea un reembolso y el servidor cifra el destino.'),
  ('finance_reimbursement_settlement_details', 'p_request_id uuid', 'Solo un pagador autorizado revela el destino de un reembolso aprobado.'),
  ('finance_settle_reimbursement', 'p_request_id uuid, p_payment_reference text, p_payment_method text', 'La referencia externa confirma el reembolso y crea el gasto contable idempotente.')
) AS contract(function_name, identity_arguments, rationale)
JOIN pg_proc procedure ON procedure.proname = contract.function_name
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace AND namespace.nspname = 'public'
WHERE pg_get_function_identity_arguments(procedure.oid) = contract.identity_arguments
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  rationale = EXCLUDED.rationale, definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
