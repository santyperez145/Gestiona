-- Presupuestos recurrentes (paridad Mendel).
--
-- Medido 2026-09-25 (mendel.com/ar/producto/tarjetas-mendel/): los presupuestos
-- «pueden configurarse como de uso único o con recurrencia según las
-- necesidades de la empresa». Hoy cada mes de Nerqia se carga a mano:
-- set_expense_budget por categoría, mes a mes.
--
-- Traducción Nerqia: una RPC que copia el presupuesto del último mes con
-- datos hacia el mes destino. Idempotente (upsert), auditada, con permiso
-- expenses.edit — el mismo contrato que set_expense_budget. No inventamos un
-- scheduler: el comercio replica cuando quiere, y ve exactamente qué copió.

CREATE OR REPLACE FUNCTION public.copy_previous_expense_budgets(
  p_org_id uuid,
  p_year integer,
  p_month integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_source record;
  v_copied integer := 0;
  v_from_label text;
  v_total_source numeric := 0;
  v_total_target numeric := 0;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_org_member(p_org_id, auth.uid())
     OR NOT public.has_permission(p_org_id, 'expenses', 'edit') THEN
    RAISE EXCEPTION 'No tenés permiso para editar presupuestos'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_year NOT BETWEEN 2000 AND 2100 OR p_month NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;

  -- El último mes anterior al destino que tenga al menos un presupuesto.
  -- Busca hacia atrás hasta 12 meses: si nada, no hay nada que replicar.
  FOR v_source IN
    SELECT b.year AS src_year, b.month AS src_month,
           count(*) AS categories,
           sum(b.amount) AS total
    FROM public.budgets b
    JOIN public.budget_categories c ON c.id = b.category_id
    WHERE b.org_id = p_org_id
      AND c.type = 'expense'
      AND (b.year, b.month) < (p_year, p_month)
      AND (b.year, b.month) > (p_year - 1, p_month)
    GROUP BY b.year, b.month
    ORDER BY b.year DESC, b.month DESC
    LIMIT 1
  LOOP
    v_from_label := to_char(make_date(v_source.src_year, v_source.src_month, 1), 'YYYY-MM');
    v_total_source := v_source.total;

    INSERT INTO public.budgets (org_id, category_id, year, month, amount)
    SELECT b.org_id, b.category_id, p_year, p_month, b.amount
    FROM public.budgets b
    JOIN public.budget_categories c ON c.id = b.category_id
    WHERE b.org_id = p_org_id
      AND c.type = 'expense'
      AND b.year = v_source.src_year
      AND b.month = v_source.src_month
    ON CONFLICT (org_id, category_id, year, month)
    DO UPDATE SET amount = EXCLUDED.amount, updated_at = now();

    GET DIAGNOSTICS v_copied = ROW_COUNT;
  END LOOP;

  IF v_copied = 0 THEN
    RETURN jsonb_build_object('ok', false, 'copied', 0, 'reason', 'no_source_budgets');
  END IF;

  SELECT coalesce(sum(amount), 0) INTO v_total_target
  FROM public.budgets b
  JOIN public.budget_categories c ON c.id = b.category_id
  WHERE b.org_id = p_org_id AND c.type = 'expense'
    AND b.year = p_year AND b.month = p_month;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id, entity_label,
    old_values, new_values, details
  ) VALUES (
    auth.uid(), p_org_id, 'budget.recurring_copy', 'budget', NULL,
    'Presupuestos ' || to_char(make_date(p_year, p_month, 1), 'YYYY-MM'),
    jsonb_build_object('source', v_from_label, 'source_total', v_total_source),
    jsonb_build_object('copied_categories', v_copied, 'target_total', v_total_target),
    jsonb_build_object('reason', 'replicacion mensual de presupuestos')
  );

  RETURN jsonb_build_object(
    'ok', true,
    'copied', v_copied,
    'source_month', v_from_label,
    'source_total', v_total_source,
    'target_total', v_total_target
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.copy_previous_expense_budgets(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_previous_expense_budgets(uuid, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.copy_previous_expense_budgets(uuid, integer, integer) IS
  'Replica los presupuestos del ultimo mes con datos hacia el mes destino (upsert idempotente, auditado).';

-- Contrato versionado de seguridad.
INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT
  'copy_previous_expense_budgets', 'p_org_id uuid, p_year integer, p_month integer',
  'authenticated_delegate',
  'Replica presupuestos del mes anterior con permiso expenses.edit; upsert idempotente y audit_logs como set_expense_budget.',
  md5(pg_get_functiondef('public.copy_previous_expense_budgets(uuid,integer,integer)'::regprocedure)), DATE '2026-09-25'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash,
      reviewed_on = EXCLUDED.reviewed_on;
