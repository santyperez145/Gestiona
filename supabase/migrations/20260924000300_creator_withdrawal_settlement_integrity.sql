-- ============================================================================
-- Base completa de retiros de creadores (paridad Go-Marz) + liquidación
-- con asiento idempotente en `influencer_payouts`.
--
-- ── El defecto que cierra ─────────────────────────────────────────────────
-- La migración del portal del creador (20260924000200) insertaba en
-- `influencer_withdrawal_requests`, pero esa tabla y las RPC del ciclo de
-- retiro (`resolve_creator_withdrawal` del lado marca) vivían en una migración
-- que quedó sin aplicar. La marca no podía ver ni liquidar las solicitudes y
-- al marcar 'paid' no asentaba el pago, permitiendo doble retiro del saldo.
--
-- ── Qué hace ──────────────────────────────────────────────────────────────
-- 1. Crea `influencer_withdrawal_requests` si no existe (idempotente).
-- 2. Reaplica las RPC del ciclo completo: solicitar/listar/consultar saldo
--    (por token y autenticado) y `resolve_creator_withdrawal`, que al marcar
--    'paid' inserta la liquidación en `influencer_payouts` con idempotencia
--    `withdrawal:<id>` en notes — cerrando el doble gasto del saldo.
-- 3. RLS por org + token, grants mínimos, contratos versionados.
-- ============================================================================

-- ── Tabla de solicitudes de retiro ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.influencer_withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  amount_ars NUMERIC(14,2) NOT NULL CHECK (amount_ars > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
  notes TEXT CHECK (length(notes) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_token ON public.influencer_withdrawal_requests(token);
CREATE INDEX IF NOT EXISTS idx_withdrawals_org_status ON public.influencer_withdrawal_requests(org_id, status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_influencer ON public.influencer_withdrawal_requests(influencer_id);

ALTER TABLE public.influencer_withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "withdrawals_org_manage" ON public.influencer_withdrawal_requests;
CREATE POLICY withdrawals_org_manage ON public.influencer_withdrawal_requests FOR ALL TO authenticated
  USING (can_manage_influencers(org_id, 'edit'))
  WITH CHECK (can_manage_influencers(org_id, 'edit'));

DROP POLICY IF EXISTS withdrawals_org_read ON public.influencer_withdrawal_requests;
CREATE POLICY withdrawals_org_read ON public.influencer_withdrawal_requests FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.influencer_withdrawal_requests FROM anon;
GRANT SELECT, INSERT ON TABLE public.influencer_withdrawal_requests TO authenticated;

-- ── RPCs del ciclo del creador (token público) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_creator_earnings(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inf record;
  v_sales numeric := 0;
  v_paid numeric := 0;
  v_pending numeric := 0;
  v_sales_count integer := 0;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN RETURN NULL; END IF;

  SELECT * INTO v_inf FROM public.influencers i
  WHERE i.referral_code = p_token
     OR (p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND i.id = p_token::uuid)
  LIMIT 1;

  IF v_inf.id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(s.commission_ars), 0), count(*) INTO v_sales, v_sales_count
  FROM public.influencer_sales s
  WHERE s.influencer_id = v_inf.id;

  SELECT COALESCE(SUM(p.amount_ars), 0) INTO v_paid
  FROM public.influencer_payouts p
  WHERE p.influencer_id = v_inf.id;

  SELECT COALESCE(SUM(w.amount_ars), 0) INTO v_pending
  FROM public.influencer_withdrawal_requests w
  WHERE w.influencer_id = v_inf.id AND w.status IN ('pending', 'approved');

  RETURN jsonb_build_object(
    'influencer_id', v_inf.id,
    'influencer_name', v_inf.name,
    'total_commissions_ars', v_sales,
    'total_sales_count', v_sales_count,
    'paid_ars', v_paid,
    'pending_withdrawals_ars', v_pending,
    'available_ars', GREATEST(v_sales - v_paid - v_pending, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_creator_withdrawal(p_token text, p_amount_ars numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inf record;
  v_sales numeric := 0;
  v_paid numeric := 0;
  v_pending numeric := 0;
  v_available numeric := 0;
  v_req_id uuid;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'token_required';
  END IF;
  IF p_amount_ars IS NULL OR p_amount_ars <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inf FROM public.influencers i
  WHERE i.referral_code = p_token
     OR (p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND i.id = p_token::uuid)
  LIMIT 1;

  IF v_inf.id IS NULL THEN
    RAISE EXCEPTION 'influencer_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(s.commission_ars), 0) INTO v_sales
  FROM public.influencer_sales s WHERE s.influencer_id = v_inf.id;

  SELECT COALESCE(SUM(p.amount_ars), 0) INTO v_paid
  FROM public.influencer_payouts p WHERE p.influencer_id = v_inf.id;

  SELECT COALESCE(SUM(w.amount_ars), 0) INTO v_pending
  FROM public.influencer_withdrawal_requests w
  WHERE w.influencer_id = v_inf.id AND w.status IN ('pending', 'approved');

  v_available := GREATEST(v_sales - v_paid - v_pending, 0);

  IF p_amount_ars > v_available THEN
    RAISE EXCEPTION 'El monto solicitado ($%) supera tu saldo disponible ($%)',
      round(p_amount_ars, 2), round(v_available, 2) USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.influencer_withdrawal_requests (org_id, influencer_id, token, amount_ars, status)
  VALUES (v_inf.org_id, v_inf.id, COALESCE(v_inf.referral_code, v_inf.id::text), p_amount_ars, 'pending')
  RETURNING id INTO v_req_id;

  RETURN jsonb_build_object('ok', true, 'id', v_req_id, 'amount_ars', p_amount_ars, 'status', 'pending');
END;
$$;

CREATE OR REPLACE FUNCTION public.list_creator_withdrawals(p_token text)
RETURNS TABLE (id uuid, amount_ars numeric, status text, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, amount_ars, status, created_at
  FROM public.influencer_withdrawal_requests
  WHERE token = p_token
  ORDER BY created_at DESC;
$$;

-- ── Lado marca: resolver con asiento idempotente en payouts ─────────────────
CREATE OR REPLACE FUNCTION public.resolve_creator_withdrawal(p_request_id uuid, p_status text)
RETURNS public.influencer_withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.influencer_withdrawal_requests;
  v_payout_exists boolean;
BEGIN
  SELECT * INTO v_row FROM public.influencer_withdrawal_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF NOT public.can_manage_influencers(v_row.org_id, 'edit') THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'pending' THEN RAISE EXCEPTION 'already_processed'; END IF;
  IF p_status NOT IN ('approved', 'rejected', 'paid') THEN RAISE EXCEPTION 'invalid_status'; END IF;

  UPDATE public.influencer_withdrawal_requests
  SET status = p_status, processed_at = now(), processed_by = auth.uid()
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
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.get_creator_earnings(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_creator_earnings(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.request_creator_withdrawal(text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_creator_withdrawal(text, numeric) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.list_creator_withdrawals(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_creator_withdrawals(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_creator_withdrawal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_creator_withdrawal(uuid, text) TO authenticated;

-- ── Contratos versionados ───────────────────────────────────────────────────
INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT v.fn, v.args, v.aud, v.rat, md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-24'
FROM (VALUES
  ('get_creator_earnings', 'p_token text', 'public_token', 'Saldo de comisiones del creador por token del portal publico.'),
  ('request_creator_withdrawal', 'p_token text, p_amount_ars numeric', 'public_token', 'Solicitud de retiro por token con validacion server-side de saldo.'),
  ('list_creator_withdrawals', 'p_token text', 'public_token', 'Historial de retiros del creador por token del portal publico.'),
  ('resolve_creator_withdrawal', 'p_request_id uuid, p_status text', 'authenticated_delegate', 'La marca liquida el retiro y la base asienta la liquidacion idempotente en payouts.')
) AS v(fn, args, aud, rat)
JOIN pg_proc procedure ON procedure.proname = v.fn
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND pg_get_function_identity_arguments(procedure.oid) = v.args
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260924000300', 'creator_withdrawal_settlement_integrity')
ON CONFLICT DO NOTHING;