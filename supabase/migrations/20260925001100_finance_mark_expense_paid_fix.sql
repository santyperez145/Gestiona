-- Fix F5.2b: finance_mark_expense_paid insertaba 8 valores en 7 columnas.
--
-- El INSERT declaraba (org_id, user_id, description, amount_ars, category,
-- date, vendor) pero pasaba también COALESCE(cost_center, 'Finance') como
-- sexto valor: la tabla expenses no tiene columna cost_center, así que el
-- botón "Registrar pago" fallaba con 42601 para cualquier organización.
-- La trazabilidad por solicitud vive en vendor; el centro de costo de la
-- solicitud se conserva dentro de la descripción cuando existe.

CREATE OR REPLACE FUNCTION public.finance_mark_expense_paid(
  p_request_id uuid,
  p_payment_method text DEFAULT 'transferencia'
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req public.finance_expense_requests;
  v_role text;
  v_expense_id uuid;
  v_exists boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No tenes sesion activa' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req
  FROM public.finance_expense_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;

  SELECT membership.role::text INTO v_role
  FROM public.memberships membership
  WHERE membership.org_id = v_req.org_id AND membership.user_id = auth.uid();

  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    IF NOT public.has_permission(v_req.org_id, 'expenses', 'edit') THEN
      RAISE EXCEPTION 'No tenes permisos para registrar pagos en esta organizacion'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF v_req.status <> 'approved' THEN
    RAISE EXCEPTION 'Solo se pueden pagar solicitudes aprobadas (estado actual: %)', v_req.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotencia por solicitud: reintento no duplica el gasto.
  SELECT EXISTS (
    SELECT 1 FROM public.expenses
    WHERE org_id = v_req.org_id
      AND vendor = 'expense_request:' || v_req.id::text
  ) INTO v_exists;

  IF v_exists THEN
    UPDATE public.finance_expense_requests
    SET status = 'paid', updated_at = now()
    WHERE id = v_req.id;
    RETURN NULL;
  END IF;

  -- 7 columnas, 7 valores: el centro de costo de la solicitud (texto libre sin
  -- columna en expenses) se conserva dentro de la descripción.
  INSERT INTO public.expenses (
    org_id, user_id, description, amount_ars, category, date, vendor
  ) VALUES (
    v_req.org_id,
    auth.uid(),
    v_req.title
      || CASE WHEN v_req.cost_center IS NOT NULL THEN ' [' || v_req.cost_center || ']' ELSE '' END
      || CASE WHEN v_req.motive IS NOT NULL THEN ' — ' || v_req.motive ELSE '' END,
    v_req.amount,
    COALESCE(v_req.category, 'otros'),
    CURRENT_DATE,
    'expense_request:' || v_req.id::text
  )
  RETURNING id INTO v_expense_id;

  UPDATE public.finance_expense_requests
  SET status = 'paid', updated_at = now()
  WHERE id = v_req.id;

  IF v_req.user_id IS NOT NULL AND v_req.user_id <> auth.uid() THEN
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, entity_type, entity_id)
      VALUES (
        v_req.user_id,
        'Pago registrado',
        v_req.title || ' — el pago quedó registrado como gasto',
        'sistema', 'finance_expense_request', v_req.id::text
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'No se pudo notificar el pago de %: %', v_req.id, SQLERRM;
    END;
  END IF;

  RETURN v_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finance_mark_expense_paid(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_mark_expense_paid(uuid, text) TO authenticated;

DO $guard$
DECLARE
  v_def text := pg_get_functiondef('public.finance_mark_expense_paid(uuid,text)'::regprocedure);
BEGIN
  -- El INSERT a expenses debe declarar exactamente 7 columnas: sin cost_center.
  IF position('COALESCE(v_req.cost_center, ''Finance'')' IN v_def) > 0
     AND position('['' || v_req.cost_center || '']''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'finance_mark_expense_paid sigue insertando cost_center como valor';
  END IF;
  IF position('expense_request:'' || v_req.id::text' IN v_def) = 0 THEN
    RAISE EXCEPTION 'finance_mark_expense_paid perdió la trazabilidad por vendor';
  END IF;
END;
$guard$;