-- Centro de costo y origen estructurados de punta a punta en Finance.
-- Dejan de viajar incrustados en description/vendor y llegan al ledger y al
-- lote contable como dimensiones consultables.

BEGIN;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS cost_center text CHECK (cost_center IS NULL OR char_length(cost_center) <= 120),
  ADD COLUMN IF NOT EXISTS payment_method text CHECK (payment_method IS NULL OR char_length(payment_method) <= 40),
  ADD COLUMN IF NOT EXISTS expense_request_id uuid REFERENCES public.finance_expense_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS expenses_request_once
  ON public.expenses(expense_request_id)
  WHERE expense_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS expenses_org_cost_center_date
  ON public.expenses(org_id, cost_center, date DESC)
  WHERE cost_center IS NOT NULL;

-- Recupera la relación de gastos generados antes de que existiera la FK.
UPDATE public.expenses expense
SET expense_request_id = request.id,
    cost_center = COALESCE(expense.cost_center, request.cost_center)
FROM public.finance_expense_requests request
WHERE expense.org_id = request.org_id
  AND expense.vendor = 'expense_request:' || request.id::text
  AND expense.expense_request_id IS NULL;

CREATE OR REPLACE FUNCTION public.ledger_asentar_gasto(p_expense_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_e public.expenses;
  v_existing uuid;
BEGIN
  SELECT * INTO v_e FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF v_e.id IS NULL THEN RAISE EXCEPTION 'El gasto no existe'; END IF;

  SELECT entry.id INTO v_existing
  FROM public.ledger_entries entry
  WHERE entry.org_id = v_e.org_id
    AND entry.referencia_tipo = 'gasto'
    AND entry.referencia_id = v_e.id
    AND entry.anulado_por IS NULL AND entry.anula_a IS NULL
  LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  IF COALESCE(v_e.amount_ars, 0) <= 0 THEN
    RAISE EXCEPTION 'El gasto % no tiene importe', v_e.id;
  END IF;

  RETURN public.ledger_asentar(
    p_org := v_e.org_id,
    p_descripcion := 'Gasto' || COALESCE(' - ' || v_e.description, ''),
    p_lineas := jsonb_build_array(
      jsonb_build_object(
        'cuenta', '5.9.01', 'debe', round(v_e.amount_ars, 2),
        'detalle', COALESCE(v_e.category, 'sin categoria'),
        'metadata', jsonb_strip_nulls(jsonb_build_object(
          'expense_id', v_e.id, 'category', v_e.category,
          'centro_costo', v_e.cost_center,
          'expense_request_id', v_e.expense_request_id,
          'payment_method', v_e.payment_method
        ))
      ),
      jsonb_build_object(
        'cuenta', '1.1.01', 'haber', round(v_e.amount_ars, 2),
        'detalle', 'Salida de caja',
        'metadata', jsonb_strip_nulls(jsonb_build_object(
          'expense_id', v_e.id, 'centro_costo', v_e.cost_center,
          'expense_request_id', v_e.expense_request_id,
          'payment_method', v_e.payment_method
        ))
      )
    ),
    p_fecha := COALESCE(v_e.date::date, v_e.created_at::date),
    p_ref_tipo := 'gasto',
    p_ref_id := v_e.id
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.ledger_asentar_gasto(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finance_mark_expense_paid(
  p_request_id uuid,
  p_payment_method text DEFAULT 'transferencia'
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_req public.finance_expense_requests;
  v_role text;
  v_expense_id uuid;
  v_method text := left(btrim(COALESCE(NULLIF(p_payment_method, ''), 'transferencia')), 40);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No tenes sesion activa' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_req FROM public.finance_expense_requests
  WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002'; END IF;

  SELECT membership.role::text INTO v_role
  FROM public.memberships membership
  WHERE membership.org_id = v_req.org_id AND membership.user_id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    IF NOT public.has_permission(v_req.org_id, 'expenses', 'edit') THEN
      RAISE EXCEPTION 'No tenes permisos para registrar pagos en esta organizacion'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_req.status <> 'approved' THEN
    RAISE EXCEPTION 'Solo se pueden pagar solicitudes aprobadas (estado actual: %)', v_req.status
      USING ERRCODE = '23514';
  END IF;

  SELECT id INTO v_expense_id FROM public.expenses
  WHERE expense_request_id = v_req.id OR (
    expense_request_id IS NULL AND org_id = v_req.org_id
    AND vendor = 'expense_request:' || v_req.id::text
  )
  ORDER BY created_at LIMIT 1;

  IF v_expense_id IS NULL THEN
    INSERT INTO public.expenses(
      org_id, user_id, description, amount_ars, category, cost_center,
      payment_method, expense_request_id, date, vendor
    ) VALUES (
      v_req.org_id, auth.uid(),
      v_req.title || CASE WHEN v_req.motive IS NOT NULL THEN ' - ' || v_req.motive ELSE '' END,
      v_req.amount, COALESCE(v_req.category, 'otros'), v_req.cost_center,
      v_method, v_req.id, CURRENT_DATE, 'expense_request:' || v_req.id::text
    ) RETURNING id INTO v_expense_id;
  END IF;

  UPDATE public.finance_expense_requests
  SET status = 'paid', updated_at = now()
  WHERE id = v_req.id;

  IF v_req.user_id IS NOT NULL AND v_req.user_id <> auth.uid() THEN
    BEGIN
      INSERT INTO public.notifications(user_id, title, message, type, entity_type, entity_id)
      VALUES (v_req.user_id, 'Pago registrado',
        v_req.title || ' - el pago quedo registrado como gasto',
        'sistema', 'finance_expense_request', v_req.id::text);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'No se pudo notificar el pago de %: %', v_req.id, SQLERRM;
    END;
  END IF;
  RETURN v_expense_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.finance_mark_expense_paid(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_mark_expense_paid(uuid, text) TO authenticated;

COMMIT;
