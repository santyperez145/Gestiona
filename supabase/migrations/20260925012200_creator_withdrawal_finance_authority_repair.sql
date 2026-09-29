-- Restaura la autoridad de liquidación después de que 012100 se aplicara en
-- paralelo con una definición anterior de resolve_creator_withdrawal.
CREATE OR REPLACE FUNCTION public.resolve_creator_withdrawal(
  p_request_id uuid,
  p_status text
)
RETURNS public.influencer_withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.influencer_withdrawal_requests;
  v_payout_exists boolean;
  v_is_brand boolean;
  v_is_service boolean;
  v_creator_name text;
  v_expense_user uuid;
BEGIN
  SELECT * INTO v_row
  FROM public.influencer_withdrawal_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_status NOT IN ('approved', 'rejected', 'paid') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT public.can_manage_influencers(v_row.org_id, 'edit') INTO v_is_brand;
  v_is_service := auth.jwt() ->> 'role' = 'service_role';
  IF NOT v_is_brand AND NOT v_is_service THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF v_is_service AND p_status <> 'paid' THEN
    RAISE EXCEPTION 'service_role_only_confirms_payments' USING ERRCODE = '42501';
  END IF;
  IF p_status IN ('approved', 'rejected') AND v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'already_processed' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'paid' AND v_row.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'already_processed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.influencer_withdrawal_requests
  SET status = p_status,
      processed_at = now(),
      processed_by = COALESCE(auth.uid(), processed_by)
  WHERE id = p_request_id
  RETURNING * INTO v_row;

  IF p_status = 'paid' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.influencer_payouts payout
      WHERE payout.influencer_id = v_row.influencer_id
        AND payout.notes = 'withdrawal:' || v_row.id::text
    ) INTO v_payout_exists;

    IF NOT v_payout_exists THEN
      INSERT INTO public.influencer_payouts (
        org_id, influencer_id, amount_ars, payment_method, notes, created_by
      ) VALUES (
        v_row.org_id, v_row.influencer_id, v_row.amount_ars,
        'transferencia', 'withdrawal:' || v_row.id::text, auth.uid()
      );
    END IF;

    SELECT influencer.name INTO v_creator_name
    FROM public.influencers influencer
    WHERE influencer.id = v_row.influencer_id;

    SELECT COALESCE(v_row.processed_by, (
      SELECT membership.user_id
      FROM public.org_members membership
      WHERE membership.org_id = v_row.org_id
        AND membership.user_id IS NOT NULL
      ORDER BY
        CASE WHEN membership.role IN ('owner', 'admin') THEN 0 ELSE 1 END,
        membership.joined_at NULLS LAST
      LIMIT 1
    )) INTO v_expense_user;
    IF v_expense_user IS NULL THEN
      RAISE EXCEPTION 'organization_has_no_expense_owner' USING ERRCODE = '23502';
    END IF;

    INSERT INTO public.expenses (
      org_id, user_id, description, amount_ars, category, date, vendor
    )
    SELECT
      v_row.org_id,
      v_expense_user,
      'Liquidación de comisiones — ' || COALESCE(v_creator_name, 'creador'),
      v_row.amount_ars,
      'marketing',
      CURRENT_DATE,
      'influencer_withdrawal:' || v_row.id::text
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.expenses expense
      WHERE expense.org_id = v_row.org_id
        AND expense.vendor = 'influencer_withdrawal:' || v_row.id::text
    );
  END IF;

  RETURN v_row;
END;
$fn$;

DROP POLICY IF EXISTS withdrawals_org_read
  ON public.influencer_withdrawal_requests;
REVOKE ALL ON FUNCTION public.resolve_creator_withdrawal(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_creator_withdrawal(uuid, text)
  TO authenticated, service_role;

-- Completa históricos que no hayan quedado asentados por ninguna de las dos
-- rutas. Si 012100 ya generó un movimiento directo, no duplica el costo.
INSERT INTO public.expenses (
  org_id, user_id, description, amount_ars, category, date, vendor
)
SELECT
  withdrawal.org_id,
  COALESCE(withdrawal.processed_by, member.user_id),
  'Liquidación de comisiones — ' || COALESCE(influencer.name, 'creador'),
  withdrawal.amount_ars,
  'marketing',
  COALESCE(withdrawal.processed_at, withdrawal.created_at, now()),
  'influencer_withdrawal:' || withdrawal.id::text
FROM public.influencer_withdrawal_requests withdrawal
LEFT JOIN public.influencers influencer ON influencer.id = withdrawal.influencer_id
LEFT JOIN LATERAL (
  SELECT membership.user_id
  FROM public.org_members membership
  WHERE membership.org_id = withdrawal.org_id
    AND membership.user_id IS NOT NULL
  ORDER BY
    CASE WHEN membership.role IN ('owner', 'admin') THEN 0 ELSE 1 END,
    membership.joined_at NULLS LAST
  LIMIT 1
) member ON true
WHERE withdrawal.status = 'paid'
  AND COALESCE(withdrawal.processed_by, member.user_id) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.expenses expense
    WHERE expense.org_id = withdrawal.org_id
      AND expense.vendor = 'influencer_withdrawal:' || withdrawal.id::text
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.financial_movements movement
    WHERE movement.org_id = withdrawal.org_id
      AND movement.source_type = 'influencer_payment'
      AND movement.metadata->>'payout' = 'withdrawal:' || withdrawal.id::text
  );

INSERT INTO public.security_function_contracts (
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT
  'resolve_creator_withdrawal',
  'p_request_id uuid, p_status text',
  'authenticated_delegate',
  'La marca decide y service_role confirma pagos; la liquidación crea el gasto canónico que alimenta Finance.',
  md5(pg_get_functiondef(procedure.oid)),
  DATE '2026-09-25'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'resolve_creator_withdrawal'
  AND pg_get_function_identity_arguments(procedure.oid) =
    'p_request_id uuid, p_status text'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
SET audience = EXCLUDED.audience,
    rationale = EXCLUDED.rationale,
    definition_hash = EXCLUDED.definition_hash,
    reviewed_on = EXCLUDED.reviewed_on;

DO $guard$
DECLARE
  definition text :=
    pg_get_functiondef('public.resolve_creator_withdrawal(uuid,text)'::regprocedure);
BEGIN
  IF position('service_role_only_confirms_payments' IN definition) = 0
     OR position('v_row.status NOT IN (''pending'', ''approved'')' IN definition) = 0
     OR position('INSERT INTO public.expenses' IN definition) = 0 THEN
    RAISE EXCEPTION 'resolve_creator_withdrawal no conserva la autoridad vigente';
  END IF;
END
$guard$;
