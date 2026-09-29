-- Reversas auditables de liquidaciones de creadores.
-- Nunca se borra el pago original: se agregan ajustes negativos y un
-- contraasiento, preservando la evidencia del proveedor y del libro.

ALTER TABLE public.influencer_withdrawal_requests
  DROP CONSTRAINT IF EXISTS influencer_withdrawal_requests_status_check;
ALTER TABLE public.influencer_withdrawal_requests
  ADD CONSTRAINT influencer_withdrawal_requests_status_check
  CHECK (status IN ('pending', 'approved', 'paid', 'rejected', 'reversed'));
ALTER TABLE public.influencer_withdrawal_requests
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reference text,
  ADD COLUMN IF NOT EXISTS reversal_reason text;

ALTER TABLE public.influencer_payout_batches
  DROP CONSTRAINT IF EXISTS influencer_payout_batches_status_check;
ALTER TABLE public.influencer_payout_batches
  ADD CONSTRAINT influencer_payout_batches_status_check
  CHECK (status IN (
    'processing', 'awaiting_confirmation', 'completed', 'failed',
    'partially_completed', 'reversed', 'partially_reversed'
  ));

ALTER TABLE public.influencer_payout_batch_items
  DROP CONSTRAINT IF EXISTS influencer_payout_batch_items_status_check;
ALTER TABLE public.influencer_payout_batch_items
  ADD CONSTRAINT influencer_payout_batch_items_status_check
  CHECK (status IN ('pending', 'processing', 'approved', 'rejected', 'cancelled', 'failed', 'reversed'));

CREATE TABLE IF NOT EXISTS public.influencer_payout_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  withdrawal_id uuid NOT NULL UNIQUE REFERENCES public.influencer_withdrawal_requests(id) ON DELETE RESTRICT,
  payout_id uuid NOT NULL REFERENCES public.influencer_payouts(id) ON DELETE RESTRICT,
  adjustment_payout_id uuid NOT NULL UNIQUE REFERENCES public.influencer_payouts(id) ON DELETE RESTRICT,
  expense_id uuid REFERENCES public.expenses(id) ON DELETE RESTRICT,
  adjustment_expense_id uuid REFERENCES public.expenses(id) ON DELETE RESTRICT,
  ledger_reversal_entry_id uuid REFERENCES public.ledger_entries(id) ON DELETE RESTRICT,
  provider_reference text NOT NULL,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS influencer_payout_reversals_org
  ON public.influencer_payout_reversals(org_id, created_at DESC);
ALTER TABLE public.influencer_payout_reversals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS influencer_payout_reversals_org_read ON public.influencer_payout_reversals;
CREATE POLICY influencer_payout_reversals_org_read
  ON public.influencer_payout_reversals FOR SELECT TO authenticated
  USING (public.can_manage_influencers(org_id, 'view'));
REVOKE ALL ON TABLE public.influencer_payout_reversals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.influencer_payout_reversals TO authenticated;

DROP FUNCTION IF EXISTS public.creator_my_withdrawals();
CREATE FUNCTION public.creator_my_withdrawals()
RETURNS TABLE (
  id uuid, amount_ars numeric, status text, created_at timestamptz,
  processed_at timestamptz, payout_provider_label text,
  payout_identifier_masked text, payment_reference text, paid_at timestamptz,
  reversed_at timestamptz, reversal_reference text, reversal_reason text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT withdrawal.id, withdrawal.amount_ars, withdrawal.status,
         withdrawal.created_at, withdrawal.processed_at,
         withdrawal.payout_provider_label, withdrawal.payout_identifier_masked,
         withdrawal.payment_reference, withdrawal.paid_at,
         withdrawal.reversed_at, withdrawal.reversal_reference,
         withdrawal.reversal_reason
  FROM public.influencer_withdrawal_requests withdrawal
  JOIN public.influencers influencer ON influencer.id = withdrawal.influencer_id
  JOIN public.creator_accounts account ON account.user_id = auth.uid()
  WHERE lower(influencer.email) = lower(account.email)
  ORDER BY withdrawal.created_at DESC
  LIMIT 50;
$fn$;
REVOKE ALL ON FUNCTION public.creator_my_withdrawals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.creator_my_withdrawals() TO authenticated;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT 'creator_my_withdrawals', '', 'authenticated_delegate',
       'El creador ve sus retiros y evidencia enmascarada, incluidas reversas.',
       md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-29'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public' AND procedure.proname = 'creator_my_withdrawals'
  AND pg_get_function_identity_arguments(procedure.oid) = ''
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

CREATE OR REPLACE FUNCTION public.reverse_creator_withdrawal(
  p_request_id uuid,
  p_provider_reference text,
  p_reason text
) RETURNS public.influencer_withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.influencer_withdrawal_requests;
  v_is_service boolean := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
  v_actor uuid;
  v_reference text := left(btrim(COALESCE(p_provider_reference, '')), 160);
  v_reason text := left(btrim(COALESCE(p_reason, '')), 500);
  v_payout public.influencer_payouts;
  v_adjustment_payout uuid;
  v_expense public.expenses;
  v_adjustment_expense uuid;
  v_ledger_entry uuid;
  v_ledger_reversal uuid;
  v_batch uuid;
  v_total integer;
  v_reversed integer;
BEGIN
  SELECT * INTO v_row
  FROM public.influencer_withdrawal_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_manage_influencers(v_row.org_id, 'edit') AND NOT v_is_service THEN
    RAISE EXCEPTION 'Sin permiso para revertir retiros' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reference) < 3 OR char_length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Ingresá la referencia y el motivo de la reversa' USING ERRCODE = '22023';
  END IF;

  IF v_row.status = 'reversed' THEN
    IF v_row.reversal_reference IS DISTINCT FROM v_reference THEN
      RAISE EXCEPTION 'El retiro ya fue revertido con otra referencia' USING ERRCODE = '22023';
    END IF;
    RETURN v_row;
  END IF;
  IF v_row.status <> 'paid' THEN
    RAISE EXCEPTION 'Sólo se puede revertir un retiro pagado' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    auth.uid(), v_row.processed_by, organization.owner_user_id,
    (SELECT membership.user_id FROM public.memberships membership
      WHERE membership.org_id = v_row.org_id
      ORDER BY CASE WHEN membership.role IN ('owner', 'admin') THEN 0 ELSE 1 END,
               membership.joined_at NULLS LAST LIMIT 1)
  ) INTO v_actor
  FROM public.organizations organization
  WHERE organization.id = v_row.org_id;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'La organización no tiene responsable para registrar la reversa' USING ERRCODE = '23502';
  END IF;

  SELECT * INTO v_payout
  FROM public.influencer_payouts payout
  WHERE payout.org_id = v_row.org_id
    AND payout.influencer_id = v_row.influencer_id
    AND payout.notes = 'withdrawal:' || v_row.id::text
  FOR UPDATE;
  IF v_payout.id IS NULL THEN
    RAISE EXCEPTION 'El retiro pagado no tiene payout asociado' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.influencer_payouts(
    org_id, influencer_id, amount_ars, payment_method, notes, created_by
  ) VALUES (
    v_row.org_id, v_row.influencer_id, -v_row.amount_ars, 'reversa',
    'reversal:withdrawal:' || v_row.id::text, v_actor
  ) RETURNING id INTO v_adjustment_payout;

  SELECT * INTO v_expense
  FROM public.expenses expense
  WHERE expense.org_id = v_row.org_id
    AND expense.vendor = 'influencer_withdrawal:' || v_row.id::text
  FOR UPDATE;

  IF v_expense.id IS NOT NULL THEN
    SELECT entry.id INTO v_ledger_entry
    FROM public.ledger_entries entry
    WHERE entry.org_id = v_row.org_id
      AND entry.referencia_tipo = 'gasto'
      AND entry.referencia_id = v_expense.id
      AND entry.anulado_por IS NULL AND entry.anula_a IS NULL
    LIMIT 1;
    IF v_ledger_entry IS NOT NULL THEN
      v_ledger_reversal := public.ledger_contraasentar(v_ledger_entry, v_reason);
    END IF;

    INSERT INTO public.expenses(
      org_id, user_id, description, amount_ars, category, date, vendor,
      cost_center, payment_method
    ) VALUES (
      v_row.org_id, v_actor, 'Reversa - ' || v_expense.description,
      -v_row.amount_ars, v_expense.category, CURRENT_DATE,
      'influencer_withdrawal_reversal:' || v_row.id::text,
      v_expense.cost_center, 'reversa'
    ) RETURNING id INTO v_adjustment_expense;
  END IF;

  INSERT INTO public.influencer_payout_reversals(
    org_id, withdrawal_id, payout_id, adjustment_payout_id,
    expense_id, adjustment_expense_id, ledger_reversal_entry_id,
    provider_reference, reason, created_by
  ) VALUES (
    v_row.org_id, v_row.id, v_payout.id, v_adjustment_payout,
    v_expense.id, v_adjustment_expense, v_ledger_reversal,
    v_reference, v_reason, v_actor
  );

  UPDATE public.influencer_withdrawal_requests
  SET status = 'reversed', reversed_at = now(), reversed_by = v_actor,
      reversal_reference = v_reference, reversal_reason = v_reason
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  FOR v_batch IN
    UPDATE public.influencer_payout_batch_items
    SET status = 'reversed', failure_reason = v_reason, updated_at = now()
    WHERE withdrawal_id = v_row.id
    RETURNING batch_id
  LOOP
    SELECT count(*), count(*) FILTER (WHERE status = 'reversed')
      INTO v_total, v_reversed
    FROM public.influencer_payout_batch_items
    WHERE batch_id = v_batch;
    UPDATE public.influencer_payout_batches
    SET status = CASE WHEN v_reversed = v_total THEN 'reversed' ELSE 'partially_reversed' END,
        updated_at = now()
    WHERE id = v_batch;
  END LOOP;

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.reverse_creator_withdrawal(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_creator_withdrawal(uuid, text, text)
  TO authenticated, service_role;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT 'reverse_creator_withdrawal',
       'p_request_id uuid, p_provider_reference text, p_reason text',
       'authenticated_delegate',
       'Marca o proveedor registran una reversa comprobada; ajustes y contraasiento son atómicos e idempotentes.',
       md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-29'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'reverse_creator_withdrawal'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;
