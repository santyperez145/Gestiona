-- Finance Pulse incorpora el presupuesto operativo sin duplicar gastos ni Core.

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
  over_budget_categories bigint
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
  ), budget_pulse AS (
    SELECT
      COALESCE(sum(b.amount), 0) AS assigned,
      count(*) FILTER (
        WHERE b.amount > 0 AND COALESCE(spend.spent, 0) > b.amount
      ) AS categories_over
    FROM public.budgets b
    JOIN public.budget_categories category
      ON category.id = b.category_id
      AND category.org_id = b.org_id
      AND category.type = 'expense'
      AND category.active
      AND category.source_key IS NOT NULL
    LEFT JOIN category_spend spend ON spend.category_key = category.source_key
    WHERE b.org_id = p_org_id
      AND b.year = v_year
      AND b.month = v_month
  ), expense_pulse AS (
    SELECT COALESCE(sum(e.amount_ars), 0) AS spent
    FROM public.expenses e
    WHERE e.org_id = p_org_id
      AND e.date >= v_month_start
      AND e.date < v_next_month
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
    budget_pulse.categories_over
  FROM budget_pulse CROSS JOIN expense_pulse;
END;
$function$;

REVOKE ALL ON FUNCTION public.finance_core_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_core_snapshot(uuid) TO authenticated;

COMMENT ON FUNCTION public.finance_core_snapshot(uuid) IS
  'Snapshot agregado del Core, documentos F3 y presupuesto operativo del mes. No crea entidades Finance paralelas.';

DO $guard$
BEGIN
  IF position('budget_categories' IN pg_get_functiondef('public.finance_core_snapshot(uuid)'::regprocedure)) = 0
     OR position('monthly_budget_available_ars' IN pg_get_function_result('public.finance_core_snapshot(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'finance_core_snapshot no incorporó Budget Pulse';
  END IF;
  IF has_function_privilege('anon', 'public.finance_core_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Finance Pulse quedó expuesto a anon';
  END IF;
END;
$guard$;
