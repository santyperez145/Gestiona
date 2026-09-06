-- Pago a proveedor: una sola autoridad transaccional e idempotente.
-- Antes el navegador insertaba supplier_payments y luego actualizaba la deuda:
-- una caída entre ambas escrituras dejaba historial y saldo en desacuerdo.

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_payments_org_idempotency_uq
  ON public.supplier_payments(org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_debt_id uuid,
  p_amount numeric,
  p_method text,
  p_idempotency_key text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_debt public.supplier_debts%ROWTYPE;
  v_payment public.supplier_payments%ROWTYPE;
  v_amount numeric;
  v_method text;
  v_new_paid numeric;
  v_status text;
BEGIN
  IF p_idempotency_key IS NULL
     OR length(trim(p_idempotency_key)) < 8
     OR length(trim(p_idempotency_key)) > 128 THEN
    RAISE EXCEPTION 'Clave de idempotencia inválida' USING ERRCODE = '22023';
  END IF;

  v_amount := round(COALESCE(p_amount, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'El importe debe ser mayor a cero' USING ERRCODE = '22023';
  END IF;

  v_method := lower(trim(COALESCE(p_method, '')));
  IF v_method NOT IN ('efectivo', 'transferencia', 'cheque', 'debito', 'credito', 'otro') THEN
    RAISE EXCEPTION 'Método de pago inválido' USING ERRCODE = '22023';
  END IF;

  SELECT debt.*
  INTO v_debt
  FROM public.supplier_debts debt
  WHERE debt.id = p_debt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deuda no encontrada' USING ERRCODE = 'P0002';
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.memberships membership
      WHERE membership.org_id = v_debt.org_id
        AND membership.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'No pertenecés a esta organización' USING ERRCODE = '42501';
    END IF;

    IF NOT public.has_permission(v_debt.org_id, 'purchases', 'edit') THEN
      RAISE EXCEPTION 'No tenés permiso para registrar pagos a proveedores'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT payment.*
  INTO v_payment
  FROM public.supplier_payments payment
  WHERE payment.org_id = v_debt.org_id
    AND payment.idempotency_key = trim(p_idempotency_key);

  IF FOUND THEN
    IF v_payment.supplier_debt_id IS DISTINCT FROM p_debt_id
       OR round(v_payment.amount_ars, 2) IS DISTINCT FROM v_amount
       OR lower(v_payment.method) IS DISTINCT FROM v_method THEN
      RAISE EXCEPTION 'La clave de idempotencia ya se usó para otro pago'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'payment_id', v_payment.id,
      'debt_id', v_debt.id,
      'paid_ars', v_debt.paid_ars,
      'remaining_ars', v_debt.remaining_ars,
      'status', v_debt.status,
      'idempotent_replay', true
    );
  END IF;

  IF v_debt.status = 'paid' OR v_debt.remaining_ars <= 0 THEN
    RAISE EXCEPTION 'La deuda ya está pagada' USING ERRCODE = '22023';
  END IF;
  IF v_amount > v_debt.remaining_ars THEN
    RAISE EXCEPTION 'El importe supera el saldo pendiente' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.supplier_payments(
    org_id, supplier_debt_id, amount_ars, method, note, idempotency_key
  ) VALUES (
    v_debt.org_id, v_debt.id, v_amount, v_method,
    NULLIF(trim(COALESCE(p_note, '')), ''), trim(p_idempotency_key)
  )
  RETURNING * INTO v_payment;

  v_new_paid := round(v_debt.paid_ars + v_amount, 2);
  v_status := CASE
    WHEN v_new_paid >= v_debt.amount_ars THEN 'paid'
    ELSE 'partial'
  END;

  UPDATE public.supplier_debts
  SET paid_ars = v_new_paid,
      status = v_status,
      updated_at = now()
  WHERE id = v_debt.id;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'debt_id', v_debt.id,
    'paid_ars', v_new_paid,
    'remaining_ars', GREATEST(v_debt.amount_ars - v_new_paid, 0),
    'status', v_status,
    'idempotent_replay', false
  );
END;
$function$;

COMMENT ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, text) IS
  'Registra pago e impacta deuda bajo row lock, permiso funcional e idempotencia.';

REVOKE ALL ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, text)
  TO authenticated, service_role;
