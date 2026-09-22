-- Migración: Retiros del creador en el portal público
-- Fecha: 2026-09-22
-- Descripción: Go-Marz lado creador — el creador ve su saldo real (comisiones
--   no pagadas) y solicita retiros. El servidor calcula y valida; el portal
--   es público por token, sin cuenta.

BEGIN;

-- ============================================
-- SOLICITUDES DE RETIRO DEL CREADOR
-- ============================================
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

-- ============================================
-- SALDO REAL DEL CREADOR POR TOKEN
-- Comisiones acumuladas menos pagos completados menos retiros pendientes.
-- ============================================
CREATE OR REPLACE FUNCTION public.get_creator_earnings(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    'total_generated_ars', COALESCE(v_inf.total_generated_ars, 0),
    'total_commissions_ars', v_sales,
    'total_sales_count', v_sales_count,
    'paid_ars', v_paid,
    'pending_withdrawals_ars', v_pending,
    'available_ars', GREATEST(v_sales - v_paid - v_pending, 0)
  );
END;
$$;

-- ============================================
-- SOLICITAR RETIRO (público por token, con validación de saldo)
-- El saldo lo calcula el servidor: el cliente nunca declara su saldo.
-- ============================================
CREATE OR REPLACE FUNCTION public.request_creator_withdrawal(p_token text, p_amount_ars numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inf record;
  v_sales numeric := 0;
  v_paid numeric := 0;
  v_pending numeric := 0;
  v_available numeric := 0;
  v_row public.influencer_withdrawal_requests;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN RAISE EXCEPTION 'invalid_token'; END IF;
  IF p_amount_ars IS NULL OR p_amount_ars <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  SELECT * INTO v_inf FROM public.influencers i
  WHERE i.referral_code = p_token
     OR (p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND i.id = p_token::uuid)
  LIMIT 1;

  IF v_inf.id IS NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;

  SELECT COALESCE(SUM(commission_ars), 0) INTO v_sales
  FROM public.influencer_sales WHERE influencer_id = v_inf.id;

  SELECT COALESCE(SUM(amount_ars), 0) INTO v_paid
  FROM public.influencer_payouts WHERE influencer_id = v_inf.id;

  SELECT COALESCE(SUM(amount_ars), 0) INTO v_pending
  FROM public.influencer_withdrawal_requests
  WHERE influencer_id = v_inf.id AND status IN ('pending', 'approved');

  v_available := v_sales - v_paid - v_pending;
  IF p_amount_ars > v_available THEN
    RAISE EXCEPTION 'insufficient_balance';
  END IF;

  INSERT INTO public.influencer_withdrawal_requests(org_id, influencer_id, token, amount_ars)
  VALUES (v_inf.org_id, v_inf.id, p_token, p_amount_ars)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status, 'amount_ars', v_row.amount_ars);
END;
$$;

-- ============================================
-- LISTAR RETIROS PÚBLICOS POR TOKEN
-- ============================================
CREATE OR REPLACE FUNCTION public.list_creator_withdrawals(p_token text)
RETURNS TABLE (id uuid, amount_ars numeric, status text, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, amount_ars, status, created_at
  FROM public.influencer_withdrawal_requests
  WHERE token = p_token
  ORDER BY created_at DESC;
$$;

REVOKE ALL ON TABLE public.influencer_withdrawal_requests FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.request_creator_withdrawal(text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_creator_withdrawal(text, numeric) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.list_creator_withdrawals(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_creator_withdrawals(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_creator_earnings(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_creator_earnings(text) TO anon, authenticated;

-- ============================================
-- LADO MARCA: REVISAR SOLICITUDES DE RETIRO
-- RPC transaccional con permisos del módulo. El estado 'paid' queda
-- registrado como liquidación aplicada; no borra historial.
-- ============================================
CREATE OR REPLACE FUNCTION public.resolve_creator_withdrawal(p_request_id uuid, p_status text)
RETURNS public.influencer_withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.influencer_withdrawal_requests;
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

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_creator_withdrawal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_creator_withdrawal(uuid, text) TO authenticated;

COMMIT;