-- Comisiones del equipo: calculo server-side, una liquidacion por periodo y
-- confirmacion de pago enlazada atomically a gasto + asiento de Finance.

BEGIN;

ALTER TABLE public.seller_payouts
  ADD COLUMN IF NOT EXISTS calculation_key text,
  ADD COLUMN IF NOT EXISTS generated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS expense_id uuid REFERENCES public.expenses(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS ledger_entry_id uuid REFERENCES public.ledger_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS seller_payouts_calculation_key_unique
  ON public.seller_payouts(calculation_key)
  WHERE calculation_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS seller_payouts_payment_reference_unique
  ON public.seller_payouts(org_id, payment_reference)
  WHERE payment_reference IS NOT NULL;

DROP POLICY IF EXISTS "seller_payouts_org_access" ON public.seller_payouts;
DROP POLICY IF EXISTS seller_payouts_org_read ON public.seller_payouts;
CREATE POLICY seller_payouts_org_read ON public.seller_payouts
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));

REVOKE ALL ON TABLE public.seller_payouts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.seller_payouts TO authenticated;

CREATE OR REPLACE FUNCTION public.configure_seller_commission(
  p_org_id uuid,
  p_user_id uuid,
  p_enabled boolean,
  p_percent numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_role text;
BEGIN
  SELECT membership.role::text INTO v_role
  FROM public.memberships membership
  WHERE membership.org_id = p_org_id AND membership.user_id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Solo propietarios y administradores pueden configurar comisiones'
      USING ERRCODE = '42501';
  END IF;
  IF p_percent IS NULL OR p_percent < 0 OR p_percent > 100 THEN
    RAISE EXCEPTION 'El porcentaje debe estar entre 0 y 100' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships membership
    WHERE membership.org_id = p_org_id AND membership.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'El vendedor no pertenece a la organizacion' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.memberships
  SET commission_enabled = COALESCE(p_enabled, false),
      commission_percent = round(p_percent, 4)
  WHERE org_id = p_org_id AND user_id = p_user_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.generate_seller_commission(
  p_org_id uuid,
  p_user_id uuid,
  p_period_start date,
  p_period_end date
) RETURNS public.seller_payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor_role text;
  v_member public.memberships;
  v_name text;
  v_sales numeric := 0;
  v_commission numeric := 0;
  v_key text;
  v_row public.seller_payouts;
BEGIN
  SELECT membership.role::text INTO v_actor_role
  FROM public.memberships membership
  WHERE membership.org_id = p_org_id AND membership.user_id = auth.uid();
  IF v_actor_role IS NULL OR v_actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Solo propietarios y administradores pueden liquidar comisiones'
      USING ERRCODE = '42501';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL
     OR p_period_start <> date_trunc('month', p_period_start)::date
     OR p_period_end <> (date_trunc('month', p_period_start) + interval '1 month - 1 day')::date THEN
    RAISE EXCEPTION 'El periodo debe abarcar un mes calendario completo' USING ERRCODE = '22023';
  END IF;
  IF p_period_start > date_trunc('month', CURRENT_DATE)::date THEN
    RAISE EXCEPTION 'No se puede liquidar un periodo futuro' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_member
  FROM public.memberships membership
  WHERE membership.org_id = p_org_id AND membership.user_id = p_user_id
  FOR UPDATE;
  IF v_member.user_id IS NULL THEN
    RAISE EXCEPTION 'El vendedor no pertenece a la organizacion' USING ERRCODE = 'P0002';
  END IF;
  IF NOT COALESCE(v_member.commission_enabled, false)
     OR COALESCE(v_member.commission_percent, 0) <= 0 THEN
    RAISE EXCEPTION 'El vendedor no tiene una comision activa' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(profile.display_name, 'Vendedor') INTO v_name
  FROM public.profiles profile WHERE profile.user_id = p_user_id;
  v_name := COALESCE(v_name, 'Vendedor');

  SELECT COALESCE(round(sum(
    CASE
      WHEN sale.paid AND COALESCE(sale.quantity, 0) > 0 THEN
        sale.total_ars * greatest(sale.quantity - COALESCE(sale.returned_quantity, 0), 0) / sale.quantity
      ELSE 0
    END
  ), 2), 0)
  INTO v_sales
  FROM public.sales sale
  WHERE sale.org_id = p_org_id
    AND sale.user_id = p_user_id
    AND sale.date >= p_period_start::timestamptz
    AND sale.date < (p_period_end + 1)::timestamptz;

  IF v_sales <= 0 THEN
    RAISE EXCEPTION 'No hay ventas cobradas y no devueltas en el periodo'
      USING ERRCODE = '23514';
  END IF;
  v_commission := round(v_sales * v_member.commission_percent / 100, 2);
  v_key := p_org_id::text || ':' || p_user_id::text || ':' || p_period_start::text || ':' || p_period_end::text;

  SELECT * INTO v_row FROM public.seller_payouts
  WHERE calculation_key = v_key FOR UPDATE;
  IF v_row.id IS NOT NULL AND v_row.status = 'paid' THEN
    RETURN v_row;
  END IF;

  INSERT INTO public.seller_payouts(
    org_id, user_id, seller_name, period_start, period_end,
    sales_total_ars, commission_percent, commission_ars, status,
    calculation_key, generated_by, updated_at
  ) VALUES (
    p_org_id, p_user_id, v_name, p_period_start, p_period_end,
    v_sales, v_member.commission_percent, v_commission, 'pending',
    v_key, auth.uid(), now()
  )
  ON CONFLICT (calculation_key) WHERE calculation_key IS NOT NULL DO UPDATE SET
    seller_name = EXCLUDED.seller_name,
    sales_total_ars = EXCLUDED.sales_total_ars,
    commission_percent = EXCLUDED.commission_percent,
    commission_ars = EXCLUDED.commission_ars,
    generated_by = EXCLUDED.generated_by,
    updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.settle_seller_commission(
  p_payout_id uuid,
  p_payment_reference text,
  p_payment_method text DEFAULT 'transferencia'
) RETURNS public.seller_payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.seller_payouts;
  v_role text;
  v_reference text := left(btrim(COALESCE(p_payment_reference, '')), 160);
  v_method text := left(btrim(COALESCE(NULLIF(p_payment_method, ''), 'transferencia')), 40);
  v_expense uuid;
  v_ledger uuid;
BEGIN
  SELECT * INTO v_row FROM public.seller_payouts
  WHERE id = p_payout_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Liquidacion no encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT membership.role::text INTO v_role
  FROM public.memberships membership
  WHERE membership.org_id = v_row.org_id AND membership.user_id = auth.uid();
  IF v_role IS NULL OR (
    v_role NOT IN ('owner', 'admin')
    AND NOT public.has_permission(v_row.org_id, 'expenses', 'edit')
  ) THEN
    RAISE EXCEPTION 'No tenes permiso para registrar este pago' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reference) < 3 THEN
    RAISE EXCEPTION 'Ingresa la referencia de la transferencia' USING ERRCODE = '22023';
  END IF;
  IF v_row.status = 'paid' THEN
    IF v_row.payment_reference IS DISTINCT FROM v_reference THEN
      RAISE EXCEPTION 'La liquidacion ya fue pagada con otra referencia' USING ERRCODE = '22023';
    END IF;
    RETURN v_row;
  END IF;
  IF v_row.status <> 'pending' OR v_row.commission_ars <= 0 THEN
    RAISE EXCEPTION 'La liquidacion no esta disponible para pagar' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.expenses(
    org_id, user_id, description, amount_ars, category, date, vendor,
    cost_center, payment_method
  ) VALUES (
    v_row.org_id, auth.uid(),
    'Comision de ventas - ' || v_row.seller_name || ' - ' || to_char(v_row.period_start, 'MM/YYYY'),
    v_row.commission_ars, 'personal', CURRENT_DATE,
    'seller_payout:' || v_row.id::text, 'Equipo comercial', v_method
  ) RETURNING id INTO v_expense;

  v_ledger := public.ledger_asentar_gasto(v_expense);
  IF v_ledger IS NULL THEN
    RAISE EXCEPTION 'No se pudo registrar el asiento contable del pago' USING ERRCODE = '23514';
  END IF;

  UPDATE public.seller_payouts
  SET status = 'paid', paid_at = now(), paid_by = auth.uid(),
      payment_reference = v_reference, payment_method = v_method,
      expense_id = v_expense, ledger_entry_id = v_ledger, updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.configure_seller_commission(uuid, uuid, boolean, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_seller_commission(uuid, uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_seller_commission(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configure_seller_commission(uuid, uuid, boolean, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_seller_commission(uuid, uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_seller_commission(uuid, text, text) TO authenticated;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT contract.function_name, contract.identity_arguments, 'authenticated_delegate',
       contract.rationale, md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-29'
FROM (VALUES
  ('configure_seller_commission', 'p_org_id uuid, p_user_id uuid, p_enabled boolean, p_percent numeric',
   'Configura la remuneracion variable solo con autoridad administrativa.'),
  ('generate_seller_commission', 'p_org_id uuid, p_user_id uuid, p_period_start date, p_period_end date',
   'Calcula ventas netas cobradas en servidor y mantiene una liquidacion por periodo.'),
  ('settle_seller_commission', 'p_payout_id uuid, p_payment_reference text, p_payment_method text',
   'Confirma dinero con referencia y crea gasto y asiento Finance atomicamente.')
) AS contract(function_name, identity_arguments, rationale)
JOIN pg_proc procedure ON procedure.proname = contract.function_name
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace AND namespace.nspname = 'public'
WHERE pg_get_function_identity_arguments(procedure.oid) = contract.identity_arguments
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
