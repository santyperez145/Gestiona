-- Finance budgets belong to the organization, not to one browser profile.

ALTER TABLE public.budget_categories
  ADD COLUMN IF NOT EXISTS source_key text;

WITH candidates AS (
  SELECT id, org_id, type, created_at,
    CASE lower(trim(name))
      WHEN 'alquiler' THEN 'alquiler'
      WHEN 'servicios' THEN 'servicios'
      WHEN 'marketing' THEN 'marketing'
      WHEN 'sueldos' THEN 'sueldos'
      WHEN 'logística' THEN 'logistica'
      WHEN 'logistica' THEN 'logistica'
      WHEN 'impuestos' THEN 'impuestos'
      WHEN 'otros' THEN 'otros'
      ELSE NULL
    END AS candidate_key
  FROM public.budget_categories
  WHERE type = 'expense' AND source_key IS NULL
), ranked AS (
  SELECT *, row_number() OVER (
    PARTITION BY org_id, type, candidate_key ORDER BY created_at, id
  ) AS position
  FROM candidates
  WHERE candidate_key IS NOT NULL
)
UPDATE public.budget_categories category
SET source_key = ranked.candidate_key
FROM ranked
WHERE category.id = ranked.id AND ranked.position = 1;

CREATE UNIQUE INDEX IF NOT EXISTS budget_categories_source_key_unique
  ON public.budget_categories(org_id, type, source_key)
  WHERE source_key IS NOT NULL;

DROP POLICY IF EXISTS "org_budget_cats" ON public.budget_categories;
DROP POLICY IF EXISTS "org_budgets" ON public.budgets;
DROP POLICY IF EXISTS budget_categories_read ON public.budget_categories;
DROP POLICY IF EXISTS budgets_read ON public.budgets;

CREATE POLICY budget_categories_read
  ON public.budget_categories
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

CREATE POLICY budgets_read
  ON public.budgets
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.budget_categories FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.budgets FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_budget_categories(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_expense_budgets(
  p_org_id uuid,
  p_year integer,
  p_month integer
)
RETURNS TABLE (
  budget_id uuid,
  category_key text,
  category_name text,
  amount numeric,
  notes text,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(p_org_id, 'expenses', 'view') THEN
    RAISE EXCEPTION 'No tenés permiso para ver presupuestos'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_year NOT BETWEEN 2000 AND 2100 OR p_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT b.id, c.source_key, c.name, b.amount, b.notes, b.updated_at
  FROM public.budgets b
  JOIN public.budget_categories c
    ON c.id = b.category_id AND c.org_id = b.org_id
  WHERE b.org_id = p_org_id
    AND b.year = p_year
    AND b.month = p_month
    AND c.type = 'expense'
    AND c.active
    AND c.source_key IS NOT NULL
  ORDER BY c.sort_order, c.name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_expense_budget(
  p_org_id uuid,
  p_category_key text,
  p_category_name text,
  p_year integer,
  p_month integer,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_key text := lower(trim(COALESCE(p_category_key, '')));
  v_name text := left(trim(COALESCE(p_category_name, '')), 120);
  v_category_id uuid;
  v_budget_id uuid;
  v_previous_amount numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(p_org_id, 'expenses', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para editar presupuestos'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_key = '' OR length(v_key) > 120 OR v_name = '' THEN
    RAISE EXCEPTION 'Categoría inválida' USING ERRCODE = '22023';
  END IF;
  IF p_year NOT BETWEEN 2000 AND 2100 OR p_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 999999999999.99 THEN
    RAISE EXCEPTION 'Monto de presupuesto inválido' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.budget_categories (
    org_id, name, type, source_key, color, icon, active
  ) VALUES (
    p_org_id, v_name, 'expense', v_key, '#64748b', 'receipt', true
  )
  ON CONFLICT (org_id, type, source_key) WHERE source_key IS NOT NULL
  DO UPDATE SET name = EXCLUDED.name, active = true
  RETURNING id INTO v_category_id;

  SELECT b.amount INTO v_previous_amount
  FROM public.budgets b
  WHERE b.org_id = p_org_id
    AND b.category_id = v_category_id
    AND b.year = p_year
    AND b.month = p_month;

  INSERT INTO public.budgets (org_id, category_id, year, month, amount)
  VALUES (p_org_id, v_category_id, p_year, p_month, round(p_amount, 2))
  ON CONFLICT (org_id, category_id, year, month)
  DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()
  RETURNING id INTO v_budget_id;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id, entity_label,
    old_values, new_values, details
  ) VALUES (
    auth.uid(), p_org_id, 'budget.updated', 'budget', v_budget_id, v_name,
    jsonb_build_object('amount', v_previous_amount, 'year', p_year, 'month', p_month),
    jsonb_build_object('amount', round(p_amount, 2), 'year', p_year, 'month', p_month),
    jsonb_build_object('category_key', v_key)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'budget_id', v_budget_id,
    'category_key', v_key,
    'amount', round(p_amount, 2)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_expense_budgets(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_expense_budget(uuid, text, text, integer, integer, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_expense_budgets(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_expense_budget(uuid, text, text, integer, integer, numeric) TO authenticated;
