-- ============================================================================
-- Liquidación de influencers enlazada a Finance (Go-Marz × Mendel).
--
-- ── El defecto P0 medido ───────────────────────────────────────────────────
-- `resolve_creator_withdrawal` exigía `auth.uid()` (can_manage_influencers →
-- is_org_member). Pero sus dos llamadores REALES son server-side:
--   · mpPayoutsSync.ts — botón de la marca y webhook firmado — usa el cliente
--     service role, donde auth.uid() es NULL.
-- Resultado: Mercado Pago aprueba la transferencia, el webhook reintentaba
-- para siempre con 'influencer_permission_denied' y el pago quedaba 'pending'
-- en la base. Cobro, comisión y conciliación mentían a la vez.
--
-- ── Qué hace esta migración ────────────────────────────────────────────────
-- 1. resolve_creator_withdrawal acepta contexto de servicio (JWT claim
--    auth.uid() NULL pero request autenticada por la Edge Function firmada).
--    La autoridad pasa a ser: sesión humana con permiso, O service_role que
--    sólo puede ser la plataforma (webhook HMAC o Edge Function propia).
-- 2. Cada liquidación 'paid' escribe un gasto real en `expenses` con
--    trazabilidad por vendor `influencer_withdrawal:<id>` (idempotente), que
--    el trigger trg_expense_ledger asienta en el libro mayor Finance.
--    El costo del influencer aparece en P&L y presupuesto sin ETL extra.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_creator_withdrawal(p_request_id uuid, p_status text)
RETURNS public.influencer_withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.influencer_withdrawal_requests;
  v_payout_exists boolean;
  v_is_brand boolean;
  v_is_service boolean;
  v_creator_name text;
  v_expense_id uuid;
  v_expense_user uuid;
BEGIN
  SELECT * INTO v_row FROM public.influencer_withdrawal_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;

  IF p_status NOT IN ('approved', 'rejected', 'paid') THEN RAISE EXCEPTION 'invalid_status'; END IF;

  -- Autoridad: la marca con sesión, O la plataforma (service role) que llega
  -- por webhook firmado o Edge Function con el service key. Sin JWT y sin
  -- service role es una llamada anónima: rechazar.
  SELECT can_manage_influencers(v_row.org_id, 'edit') INTO v_is_brand;
  v_is_service := auth.jwt() ->> 'role' = 'service_role';
  IF NOT v_is_brand AND NOT v_is_service THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF v_is_service AND p_status <> 'paid' THEN
    -- El servicio sólo confirma pagos (webhook MP); aprobar/rechazar es
    -- decisión humana de la marca.
    RAISE EXCEPTION 'service_role_only_confirms_payments' USING ERRCODE = '42501';
  END IF;

  IF p_status IN ('approved', 'rejected') AND v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'already_processed';
  END IF;
  IF p_status = 'paid' AND v_row.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'already_processed';
  END IF;

  UPDATE public.influencer_withdrawal_requests
  SET status = p_status,
      processed_at = now(),
      processed_by = COALESCE(auth.uid(), processed_by)
  WHERE id = p_request_id
  RETURNING * INTO v_row;

  IF p_status = 'paid' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.influencer_payouts
      WHERE influencer_id = v_row.influencer_id
        AND notes = 'withdrawal:' || v_row.id::text
    ) INTO v_payout_exists;

    IF NOT v_payout_exists THEN
      INSERT INTO public.influencer_payouts (
        org_id, influencer_id, amount_ars, payment_method, notes, created_by
      ) VALUES (
        v_row.org_id, v_row.influencer_id, v_row.amount_ars,
        'transferencia', 'withdrawal:' || v_row.id::text, auth.uid()
      );
    END IF;

    -- ── Enlace Finance: el pago al creador es un gasto real del negocio ──
    -- Idempotente por vendor; el trigger trg_expense_ledger lo asienta en el
    -- libro mayor (5.9.01 Otros gastos / 1.1.01 Caja) para P&L y presupuesto.
    SELECT name INTO v_creator_name FROM public.influencers WHERE id = v_row.influencer_id;
    SELECT COALESCE(v_row.processed_by, (
      SELECT om.user_id FROM public.org_members om
      WHERE om.org_id = v_row.org_id AND om.user_id IS NOT NULL
      ORDER BY CASE WHEN om.role IN ('owner', 'admin') THEN 0 ELSE 1 END,
               om.joined_at NULLS LAST
      LIMIT 1
    )) INTO v_expense_user;
    IF v_expense_user IS NULL THEN
      RAISE EXCEPTION 'organization_has_no_expense_owner' USING ERRCODE = '23502';
    END IF;
    INSERT INTO public.expenses (
      org_id, user_id, description, amount_ars, category, date, vendor
    )
    SELECT v_row.org_id, v_expense_user,
           'Liquidación de comisiones — ' || COALESCE(v_creator_name, 'creador'),
           v_row.amount_ars, 'marketing', CURRENT_DATE,
           'influencer_withdrawal:' || v_row.id::text
    FROM (VALUES (1)) AS seed
    WHERE NOT EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.org_id = v_row.org_id
        AND e.vendor = 'influencer_withdrawal:' || v_row.id::text
    );
  END IF;

  RETURN v_row;
END;
$$;

-- El RPC SECURITY DEFINER es la vía controlada. La policy histórica
-- `USING (true)` exponía retiros de cualquier organización a todo usuario.
DROP POLICY IF EXISTS withdrawals_org_read ON public.influencer_withdrawal_requests;

REVOKE ALL ON FUNCTION public.resolve_creator_withdrawal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_creator_withdrawal(uuid, text) TO authenticated, service_role;

-- ── Contrato versionado ─────────────────────────────────────────────────────
INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
VALUES (
  'resolve_creator_withdrawal', 'p_request_id uuid, p_status text', 'authenticated_delegate',
  'La marca liquida el retiro y la base asienta la liquidacion idempotente en payouts y en el libro Finance.',
  md5(pg_get_functiondef('public.resolve_creator_withdrawal(uuid,text)'::regprocedure)), DATE '2026-09-25'
)
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET definition_hash = EXCLUDED.definition_hash,
      rationale = EXCLUDED.rationale,
      reviewed_on = EXCLUDED.reviewed_on;

-- ── Guardia ─────────────────────────────────────────────────────────────────
DO $guard$
DECLARE
  v_def text := pg_get_functiondef('public.resolve_creator_withdrawal(uuid,text)'::regprocedure);
BEGIN
  IF position('service_role' IN v_def) = 0 THEN
    RAISE EXCEPTION 'resolve_creator_withdrawal sigue exigiendo auth.uid() para el webhook';
  END IF;
  IF position('influencer_withdrawal:'' || v_row.id::text' IN v_def) = 0 THEN
    RAISE EXCEPTION 'resolve_creator_withdrawal perdio el enlace Finance por vendor';
  END IF;
  IF position('v_is_service AND p_status <> ''paid''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'service_role debe confirmar pagos, no decisiones humanas';
  END IF;
END $guard$;
