-- ============================================================================
-- Liquidaciones históricas de creadores alineadas con Finance.
--
-- El flujo vigente ya inserta un gasto con vendor influencer_withdrawal:<id>
-- desde resolve_creator_withdrawal. El trigger trg_expense_ledger convierte
-- ese gasto en financial_movements. Esta migración no duplica esa autoridad:
-- completa retiros pagados antes de ese enlace y blinda su idempotencia.
-- ============================================================================

DO $guard$
BEGIN
  IF to_regprocedure('public.resolve_creator_withdrawal(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'resolve_creator_withdrawal no existe';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_expense_ledger'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_expense_ledger no existe';
  END IF;
END
$guard$;

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
    SELECT 1
    FROM public.expenses expense
    WHERE expense.org_id = withdrawal.org_id
      AND expense.vendor = 'influencer_withdrawal:' || withdrawal.id::text
  );

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.influencer_withdrawal_requests withdrawal
    WHERE withdrawal.status = 'paid'
      AND EXISTS (
        SELECT 1 FROM public.org_members membership
        WHERE membership.org_id = withdrawal.org_id
          AND membership.user_id IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.expenses expense
        WHERE expense.org_id = withdrawal.org_id
          AND expense.vendor = 'influencer_withdrawal:' || withdrawal.id::text
      )
  ) THEN
    RAISE EXCEPTION 'hay liquidaciones pagadas sin gasto Finance';
  END IF;
END
$guard$;
