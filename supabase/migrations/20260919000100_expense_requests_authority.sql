-- Finance Expense Requests Authority — F5.2: Políticas y presupuesto
-- Cierra el flujo de solicitud → política → presupuesto → aprobación → gasto/deuda

-- Tabla nueva para el flujo de solicitudes de gastos
CREATE TABLE IF NOT EXISTS public.finance_expense_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ARS',
  category TEXT,
  cost_center TEXT,
  motive TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'approved', 'rejected')),
  attachments TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.finance_expense_requests ENABLE ROW LEVEL SECURITY;

-- RLS: solo miembros de la organización pueden operar
CREATE POLICY "finance_expense_requests_org"
  ON public.finance_expense_requests
  FOR ALL USING (public.is_org_member(org_id, auth.uid()))
  WITH CHECK (public.is_org_member(org_id, auth.uid()));

-- Función: crear solicitud de gasto
CREATE OR REPLACE FUNCTION public.finance_create_expense_request(
  p_org_id UUID,
  p_title TEXT,
  p_amount NUMERIC(14,2),
  p_currency TEXT,
  p_category TEXT,
  p_cost_center TEXT,
  p_motive TEXT
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(p_org_id, auth.uid()) THEN
    RAISE EXCEPTION 'No tenés permiso para crear solicitudes de gasto'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_id := gen_random_uuid();

  INSERT INTO public.finance_expense_requests (
    id, org_id, user_id, title, amount, currency, category, cost_center, motive, status, created_at, updated_at
  ) VALUES (
    v_id, p_org_id, auth.uid(), p_title, p_amount, p_currency, p_category, p_cost_center, p_motive, 'pending', now(), now()
  );

  RETURN v_id;
END;
$function$;

-- Función: aprobar solicitud de gasto (compromete presupuesto)
CREATE OR REPLACE FUNCTION public.finance_approve_expense_request(
  p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No tenés sesión activa'
      USING ERRCODE = 'invalid_text_representation';
  END IF;

  -- Verificar que la solicitud existe y está pendiente
  IF NOT EXISTS (
    SELECT 1 FROM public.finance_expense_requests
    WHERE id = p_request_id AND org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Solicitud no encontrada o no pertenecés a tu organización';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.finance_expense_requests
    WHERE id = p_request_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Solo se pueden aprobar solicitudes con estado "pendiente"';
  END IF;

  -- Actualizar estado a aprobado
  UPDATE public.finance_expense_requests
  SET status = 'approved', updated_at = now()
  WHERE id = p_request_id;
END;
$function$;

-- Función: rechazar solicitud de gasto
CREATE OR REPLACE FUNCTION public.finance_reject_expense_request(
  p_request_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No tenés sesión activa'
      USING ERRCODE = 'invalid_text_representation';
  END IF;

  -- Verificar que la solicitud existe y pertenece a la organización
  IF NOT EXISTS (
    SELECT 1 FROM public.finance_expense_requests
    WHERE id = p_request_id AND org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Solicitud no encontrada o no pertenecés a tu organización';
  END IF;

  -- Actualizar estado a rechazado
  UPDATE public.finance_expense_requests
  SET status = 'rejected', updated_at = now()
  WHERE id = p_request_id;
END;
$function$;
