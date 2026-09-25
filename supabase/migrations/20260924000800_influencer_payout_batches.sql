-- ============================================================================
-- Lotes de pago automático a influencers vía Mercado Pago Payouts (Go-Marz).
--
-- ── Contrato verificado en docs oficiales MP (24/09/2026) ──────────────────
-- POST https://api.mercadopago.com/v1/payouts
--   Headers: Authorization Bearer, X-Idempotency-Key (obligatorio)
--   Body: external_reference (único, ≤64 chars), description (≤100),
--         config.notification_url, transactions[] con:
--           type: "account",
--           account: { email } (cuenta MP) — vía banco requiere homologación,
--           amount: { currency: "ARS", value: number },
--           external_reference único por transacción
--   Testing: header X-test-token: true
--
-- ── Qué hace esta migración ────────────────────────────────────────────────
-- 1. `influencer_payout_batches`: un lote por ejecución (idempotente por
--    external_reference `nerqia-payout-batch-<id>`).
-- 2. `influencer_payout_batch_items`: una fila por retiro incluido, con el
--    estado que reporta MP por transacción.
-- 3. `resolve_creator_withdrawal` NO se toca: el flujo queda
--    marca aprueba → lote MP → webhook confirma → resolve 'paid' asienta
--    la liquidación (ya idempotente).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.influencer_payout_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  external_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed', 'partially_completed')),
  mp_payout_id TEXT,
  description TEXT,
  total_ars NUMERIC(14,2) NOT NULL DEFAULT 0,
  items_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_payout_batches_org ON public.influencer_payout_batches(org_id);
CREATE INDEX IF NOT EXISTS idx_payout_batches_status ON public.influencer_payout_batches(status);

CREATE TABLE IF NOT EXISTS public.influencer_payout_batch_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.influencer_payout_batches(id) ON DELETE CASCADE,
  withdrawal_id UUID NOT NULL REFERENCES public.influencer_withdrawal_requests(id) ON DELETE CASCADE,
  influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  amount_ars NUMERIC(14,2) NOT NULL,
  mp_transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'approved', 'rejected', 'cancelled')),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, withdrawal_id)
);

CREATE INDEX IF NOT EXISTS idx_payout_items_batch ON public.influencer_payout_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_payout_items_withdrawal ON public.influencer_payout_batch_items(withdrawal_id);

ALTER TABLE public.influencer_payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_payout_batch_items ENABLE ROW LEVEL SECURITY;

-- La marca gestiona sus lotes.
DROP POLICY IF EXISTS payout_batches_org_manage ON public.influencer_payout_batches;
CREATE POLICY payout_batches_org_manage ON public.influencer_payout_batches FOR ALL TO authenticated
  USING (can_manage_influencers(org_id, 'edit'))
  WITH CHECK (can_manage_influencers(org_id, 'edit'));

DROP POLICY IF EXISTS payout_items_org_read ON public.influencer_payout_batch_items;
CREATE POLICY payout_items_org_read ON public.influencer_payout_batch_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.influencer_payout_batches b
    WHERE b.id = batch_id AND can_manage_influencers(b.org_id, 'edit')
  ));

REVOKE ALL ON TABLE public.influencer_payout_batches FROM anon;
REVOKE ALL ON TABLE public.influencer_payout_batch_items FROM anon;
GRANT SELECT ON TABLE public.influencer_payout_batches TO authenticated;
GRANT SELECT ON TABLE public.influencer_payout_batch_items TO authenticated;

-- ── RPC: crear lote pendiente de envío (la marca arma el lote; MP manda) ───
-- El asiento del pago (status 'paid' del retiro + fila en influencer_payouts)
-- sigue siendo de resolve_creator_withdrawal: esta RPC sólo registra el lote.
CREATE OR REPLACE FUNCTION public.create_payout_batch(
  p_withdrawal_ids uuid[]
) RETURNS public.influencer_payout_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.influencer_payout_batches;
  v_org uuid;
  v_count integer;
  v_total numeric := 0;
  v_id uuid;
  w record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501'; END IF;
  IF p_withdrawal_ids IS NULL OR array_length(p_withdrawal_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Sin retiros para pagar' USING ERRCODE = '22023';
  END IF;

  -- Todos los retiros deben ser de la misma org y estar aprobados.
  SELECT org_id, count(*) INTO v_org, v_count
  FROM public.influencer_withdrawal_requests
  WHERE id = ANY(p_withdrawal_ids)
    AND status = 'approved';
  IF v_count <> array_length(p_withdrawal_ids, 1) THEN
    RAISE EXCEPTION 'Todos los retiros deben estar aprobados y pertenecer a tu organización'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT public.can_manage_influencers(v_org, 'edit') THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(amount_ars), 0) INTO v_total
  FROM public.influencer_withdrawal_requests
  WHERE id = ANY(p_withdrawal_ids);

  INSERT INTO public.influencer_payout_batches (
    org_id, external_reference, status, description, total_ars, items_count, created_by
  ) VALUES (
    v_org,
    'nerqia-payout-batch-' || gen_random_uuid()::text,
    'processing',
    'Pago automático de comisiones a creadores',
    v_total,
    array_length(p_withdrawal_ids, 1),
    auth.uid()
  ) RETURNING * INTO v_row;

  FOR w IN
    SELECT id, influencer_id, amount_ars
    FROM public.influencer_withdrawal_requests
    WHERE id = ANY(p_withdrawal_ids)
  LOOP
    INSERT INTO public.influencer_payout_batch_items (batch_id, withdrawal_id, influencer_id, amount_ars)
    VALUES (v_row.id, w.id, w.influencer_id, w.amount_ars);
  END LOOP;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_payout_batch(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_payout_batch(uuid[]) TO authenticated;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT
  'create_payout_batch', 'p_withdrawal_ids uuid[]', 'authenticated_delegate',
  'La marca arma el lote de pagos aprobados; el asiento del pago queda en resolve_creator_withdrawal.',
  md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-24'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'create_payout_batch'
  AND pg_get_function_identity_arguments(procedure.oid) = 'p_withdrawal_ids uuid[]'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260924000800', 'influencer_payout_batches')
ON CONFLICT DO NOTHING;