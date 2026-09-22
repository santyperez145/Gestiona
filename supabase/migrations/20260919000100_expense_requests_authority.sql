-- Finance Expense Requests Authority - F5.2: Politicas y presupuesto
-- Flujo: solicitud -> politica -> presupuesto -> aprobacion -> gasto/deuda

CREATE TABLE IF NOT EXISTS public.finance_expense_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'ARS' CHECK (currency IN ('ARS', 'USD')),
  category TEXT,
  cost_center TEXT,
  motive TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'approved', 'rejected')),
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_expense_requests_org_status
  ON public.finance_expense_requests(org_id, status);

ALTER TABLE public.finance_expense_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance_expense_requests_org"
  ON public.finance_expense_requests
  FOR ALL
  USING (public.is_org_member(org_id, auth.uid()))
  WITH CHECK (public.is_org_member(org_id, auth.uid()));

-- Presentar una solicitud de gasto
CREATE OR REPLACE FUNCTION public.finance_create_expense_request(
  p_org_id UUID,
  p_title TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_category TEXT DEFAULT NULL,
  p_cost_center TEXT DEFAULT NULL,
  p_motive TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No tenes sesion activa'
      USING ERRCODE = 'invalid_text_representation';
  END IF;

  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero'
      USING ERRCODE = 'check_violation';
  END IF;

  v_id := gen_random_uuid();

  INSERT INTO public.finance_expense_requests (
    id, org_id, user_id, title, amount, currency, category, cost_center, motive, status, created_at, updated_at
  ) VALUES (
    v_id, p_org_id, auth.uid(), p_title, p_amount, COALESCE(p_currency, 'ARS'), p_category, p_cost_center, p_motive, 'pending', now(), now()
  );

  RETURN v_id;
END;
$function$;

-- Alias de compatibilidad
CREATE OR REPLACE FUNCTION public.finance_submit_expense_request(
  p_org_id UUID,
  p_title TEXT,
  p_amount NUMERIC,
  p_currency TEXT,
  p_category TEXT DEFAULT NULL,
  p_cost_center TEXT DEFAULT NULL,
  p_motive TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No perteneces a esta organizacion'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN public.finance_create_expense_request(p_org_id, p_title, p_amount, p_currency, p_category, p_cost_center, p_motive);
END;
$function$;

-- Aprobar solicitud de gasto (compromete presupuesto)
CREATE OR REPLACE FUNCTION public.finance_approve_expense_request(
  p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_req public.finance_expense_requests;
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No tenes sesion activa'
      USING ERRCODE = 'invalid_text_representation';
  END IF;

  SELECT * INTO v_req
  FROM public.finance_expense_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT membership.role::text INTO v_role
  FROM public.memberships membership
  WHERE membership.org_id = v_req.org_id AND membership.user_id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    IF NOT public.has_permission(v_req.org_id, 'expenses', 'edit') THEN
      RAISE EXCEPTION 'No tenes permisos para aprobar solicitudes en esta organizacion'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF v_req.status <> 'pending' AND v_req.status <> 'under_review' THEN
    RAISE EXCEPTION 'Solo se pueden aprobar solicitudes pendientes'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.finance_expense_requests
  SET status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now()
  WHERE id = p_request_id;
END;
$function$;

-- Rechazar solicitud de gasto
CREATE OR REPLACE FUNCTION public.finance_reject_expense_request(
  p_request_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_req public.finance_expense_requests;
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No tenes sesion activa'
      USING ERRCODE = 'invalid_text_representation';
  END IF;

  SELECT * INTO v_req
  FROM public.finance_expense_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT membership.role::text INTO v_role
  FROM public.memberships membership
  WHERE membership.org_id = v_req.org_id AND membership.user_id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    IF NOT public.has_permission(v_req.org_id, 'expenses', 'edit') THEN
      RAISE EXCEPTION 'No tenes permisos para rechazar solicitudes en esta organizacion'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF v_req.status <> 'pending' AND v_req.status <> 'under_review' THEN
    RAISE EXCEPTION 'Solo se pueden rechazar solicitudes pendientes'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.finance_expense_requests
  SET status = 'rejected',
      rejection_reason = p_reason,
      updated_at = now()
  WHERE id = p_request_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.finance_submit_expense_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_approve_expense_request TO authenticated;
GRANT EXECUTE ON FUNCTION public.finance_reject_expense_request TO authenticated;
