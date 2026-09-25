-- F5.2b: presupuesto como movimientos — comprometido visible y liberable.
--
-- Hasta ahora Budget Pulse mostraba asignado y ejecutado (gasto real). Las
-- aprobaciones F5.2 comprometen saldo, pero ese compromiso era invisible: el
-- dueño veía "Disponible" como si las aprobadas no existieran hasta pagarse.
--
-- 1. finance_core_snapshot incorpora monthly_committed_ars (solicitudes
--    aprobadas no pagadas del mes) y over_committed_categories (categorías
--    donde ejecutado + comprometido supera lo asignado).
-- 2. finance_cancel_expense_request libera: pending/approved -> cancelled con
--    traza (cancelled_by/cancelled_at/cancel_reason). Cancelar una aprobada
--    devuelve el saldo comprometido al presupuesto al instante (el snapshot es
--    vivo). Una pagada o rechazada no se cancela: ya tiene destino.
-- 3. El constraint de estados incorpora 'cancelled' sin tocar los demás.

ALTER TABLE public.finance_expense_requests DROP CONSTRAINT IF EXISTS finance_expense_requests_status_check;
ALTER TABLE public.finance_expense_requests
  ADD CONSTRAINT finance_expense_requests_status_check
  CHECK (status IN ('pending', 'under_review', 'approved', 'rejected', 'paid', 'cancelled'));

ALTER TABLE public.finance_expense_requests
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

DROP FUNCTION IF EXISTS public.finance_core_snapshot(uuid);

CREATE FUNCTION public.finance_core_snapshot(p_org_id uuid)
RETURNS TABLE (
  suppliers_count bigint,
  open_purchase_orders bigint,
  open_payables_count bigint,
  open_payables_ars numeric,
  ledger_entries_count bigint,
  precursor_ocr_documents bigint,
  monthly_budget_ars numeric,
  monthly_expense_ars numeric,
  monthly_budget_available_ars numeric,
  over_budget_categories bigint,
  monthly_committed_ars numeric,
  over_committed_categories bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_access record;
  v_month_start date := date_trunc('month', current_date)::date;
  v_next_month date := (date_trunc('month', current_date) + interval '1 month')::date;
  v_year integer := extract(year FROM current_date)::integer;
  v_month integer := extract(month FROM current_date)::integer;
BEGIN
  SELECT * INTO v_access
  FROM public.product_surface_access(p_org_id, 'finance');

  IF NOT COALESCE(v_access.allowed, false) THEN
    RAISE EXCEPTION 'Finance no está habilitado para esta sesión'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH category_spend AS (
    SELECT e.category AS category_key, COALESCE(sum(e.amount_ars), 0) AS spent
    FROM public.expenses e
    WHERE e.org_id = p_org_id
      AND e.date >= v_month_start
      AND e.date < v_next_month
    GROUP BY e.category
  ), category_committed AS (
    -- Compromiso del mes: aprobadas no pagadas por categoría. El compromiso
    -- pertenece al mes en que se aprobó (cuando se reservó el saldo).
    SELECT lower(trim(coalesce(r.category, ''))) AS category_key,
           COALESCE(sum(r.amount), 0) AS committed
    FROM public.finance_expense_requests r
    WHERE r.org_id = p_org_id
      AND r.status = 'approved'
      AND coalesce(r.approved_at, r.created_at) >= v_month_start
      AND coalesce(r.approved_at, r.created_at) < v_next_month
    GROUP BY 1
  ), budget_pulse AS (
    SELECT
      COALESCE(sum(b.amount), 0) AS assigned,
      count(*) FILTER (
        WHERE b.amount > 0 AND COALESCE(spend.spent, 0) > b.amount
      ) AS categories_over,
      count(*) FILTER (
        WHERE b.amount > 0
          AND COALESCE(spend.spent, 0) + COALESCE(committed.committed, 0) > b.amount
      ) AS categories_over_committed
    FROM public.budgets b
    JOIN public.budget_categories category
      ON category.id = b.category_id
      AND category.org_id = b.org_id
      AND category.type = 'expense'
      AND category.active
      AND category.source_key IS NOT NULL
    LEFT JOIN category_spend spend ON spend.category_key = category.source_key
    LEFT JOIN category_committed committed ON committed.category_key = lower(category.source_key)
    WHERE b.org_id = p_org_id
      AND b.year = v_year
      AND b.month = v_month
  ), expense_pulse AS (
    SELECT COALESCE(sum(e.amount_ars), 0) AS spent
    FROM public.expenses e
    WHERE e.org_id = p_org_id
      AND e.date >= v_month_start
      AND e.date < v_next_month
  ), committed_pulse AS (
    SELECT COALESCE(sum(r.amount), 0) AS committed
    FROM public.finance_expense_requests r
    WHERE r.org_id = p_org_id
      AND r.status = 'approved'
      AND coalesce(r.approved_at, r.created_at) >= v_month_start
      AND coalesce(r.approved_at, r.created_at) < v_next_month
  )
  SELECT
    (SELECT count(*) FROM public.suppliers supplier WHERE supplier.org_id = p_org_id AND supplier.active),
    (SELECT count(*) FROM public.purchase_orders purchase_order WHERE purchase_order.org_id = p_org_id AND purchase_order.status NOT IN ('received', 'cancelled')),
    (SELECT count(*) FROM public.supplier_debts debt WHERE debt.org_id = p_org_id AND debt.status IN ('pending', 'partial')),
    (SELECT COALESCE(sum(debt.remaining_ars), 0) FROM public.supplier_debts debt WHERE debt.org_id = p_org_id AND debt.status IN ('pending', 'partial')),
    (SELECT count(*) FROM public.ledger_entries entry WHERE entry.org_id = p_org_id),
    (SELECT count(*) FROM public.finance_documents document WHERE document.org_id = p_org_id AND document.status IS DISTINCT FROM 'approved'),
    budget_pulse.assigned,
    expense_pulse.spent,
    budget_pulse.assigned - expense_pulse.spent,
    budget_pulse.categories_over,
    committed_pulse.committed,
    budget_pulse.categories_over_committed
  FROM budget_pulse CROSS JOIN expense_pulse CROSS JOIN committed_pulse;
END;
$function$;

REVOKE ALL ON FUNCTION public.finance_core_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_core_snapshot(uuid) TO authenticated;

COMMENT ON FUNCTION public.finance_core_snapshot(uuid) IS
  'Snapshot agregado del Core, documentos F3 y presupuesto operativo del mes con compromisos F5.2 (aprobadas no pagadas). No crea entidades Finance paralelas.';

-- Cancelar una solicitud pendiente o aprobada: libera el compromiso con traza.
CREATE OR REPLACE FUNCTION public.finance_cancel_expense_request(
  p_request_id uuid,
  p_reason text DEFAULT NULL
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
    RAISE EXCEPTION 'No tenés sesión activa' USING ERRCODE = 'invalid_text_representation';
  END IF;

  SELECT * INTO v_req
  FROM public.finance_expense_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT membership.role::text INTO v_role
  FROM public.memberships membership
  WHERE membership.org_id = v_req.org_id AND membership.user_id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    IF NOT public.has_permission(v_req.org_id, 'expenses', 'edit') THEN
      RAISE EXCEPTION 'No tenés permisos para cancelar solicitudes en esta organización'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF v_req.status NOT IN ('pending', 'under_review', 'approved') THEN
    RAISE EXCEPTION 'Sólo se cancelan solicitudes pendientes o aprobadas (estado actual: %)', v_req.status
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.finance_expense_requests
  SET status = 'cancelled',
      cancelled_by = auth.uid(),
      cancelled_at = now(),
      cancel_reason = NULLIF(btrim(p_reason), ''),
      updated_at = now()
  WHERE id = p_request_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.finance_cancel_expense_request TO authenticated;

DO $guard$
BEGIN
  IF position('finance_expense_requests' IN pg_get_functiondef('public.finance_core_snapshot(uuid)'::regprocedure)) = 0
     OR position('monthly_committed_ars' IN pg_get_function_result('public.finance_core_snapshot(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'finance_core_snapshot no incorporó los compromisos F5.2';
  END IF;
  IF position('cancelled_by' IN pg_get_functiondef('public.finance_cancel_expense_request(uuid,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'finance_cancel_expense_request sin traza de cancelación';
  END IF;
  IF has_function_privilege('anon', 'public.finance_core_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Finance Pulse quedó expuesto a anon';
  END IF;
END;
$guard$;