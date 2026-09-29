-- Integridad de runtime detectada por plpgsql_check tras sincronizar el lote
-- 20260925. Son correcciones aditivas: no se reescribe el historial aplicado.

-- El rate limit consume cuota, por lo tanto estas funciones no son STABLE.
ALTER FUNCTION public.stock_en_vitrina(text, jsonb) VOLATILE;
ALTER FUNCTION public.get_influencer_contract_by_token(text) VOLATILE;

-- El OUT parameter id hacía ambiguo el WHERE id = ...
CREATE OR REPLACE FUNCTION public.campaign_chat_list(
  p_campaign_id uuid,
  p_influencer_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, author_role text, body text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_email text;
  v_org uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_influencer_id IS NOT NULL THEN
    SELECT c.org_id INTO v_org
    FROM public.influencer_campaigns c
    WHERE c.id = p_campaign_id;
    IF v_org IS NULL THEN
      RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_org_member(v_org, v_user)
       OR NOT public.has_permission(v_org, 'influencers', 'view') THEN
      RAISE EXCEPTION 'campaign_chat_permission_denied' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT m.id, m.author_role, m.body, m.created_at
      FROM public.influencer_campaign_messages m
      WHERE m.campaign_id = p_campaign_id
        AND m.influencer_id = p_influencer_id
      ORDER BY m.created_at ASC
      LIMIT 200;
  ELSE
    SELECT ca.email INTO v_email
    FROM public.creator_accounts ca
    WHERE ca.user_id = v_user;
    IF v_email IS NULL THEN
      RAISE EXCEPTION 'not_a_creator' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT m.id, m.author_role, m.body, m.created_at
      FROM public.influencer_campaign_messages m
      JOIN public.influencers i ON i.id = m.influencer_id
      WHERE m.campaign_id = p_campaign_id
        AND lower(i.email) = lower(v_email)
      ORDER BY m.created_at ASC
      LIMIT 200;
  END IF;
END;
$fn$;

-- El agregado anterior mezclaba una columna no agrupada con count(*).
CREATE OR REPLACE FUNCTION public.create_payout_batch(p_withdrawal_ids uuid[])
RETURNS public.influencer_payout_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.influencer_payout_batches;
  v_org uuid;
  v_count integer;
  v_org_count integer;
  v_total numeric := 0;
  w record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;
  IF p_withdrawal_ids IS NULL OR array_length(p_withdrawal_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Sin retiros para pagar' USING ERRCODE = '22023';
  END IF;

  SELECT (array_agg(DISTINCT r.org_id))[1], count(*), count(DISTINCT r.org_id)
    INTO v_org, v_count, v_org_count
  FROM public.influencer_withdrawal_requests r
  WHERE r.id = ANY(p_withdrawal_ids)
    AND r.status = 'approved';
  IF v_count <> array_length(p_withdrawal_ids, 1) OR v_org_count <> 1 THEN
    RAISE EXCEPTION 'Todos los retiros deben estar aprobados y pertenecer a tu organización'
      USING ERRCODE = '23514';
  END IF;
  IF NOT public.can_manage_influencers(v_org, 'edit') THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(r.amount_ars), 0) INTO v_total
  FROM public.influencer_withdrawal_requests r
  WHERE r.id = ANY(p_withdrawal_ids);

  INSERT INTO public.influencer_payout_batches (
    org_id, external_reference, status, description, total_ars, items_count, created_by
  ) VALUES (
    v_org, 'nerqia-payout-batch-' || gen_random_uuid()::text, 'processing',
    'Pago automático de comisiones a creadores', v_total, v_count, auth.uid()
  ) RETURNING * INTO v_row;

  FOR w IN
    SELECT r.id, r.influencer_id, r.amount_ars
    FROM public.influencer_withdrawal_requests r
    WHERE r.id = ANY(p_withdrawal_ids)
  LOOP
    INSERT INTO public.influencer_payout_batch_items (
      batch_id, withdrawal_id, influencer_id, amount_ars
    ) VALUES (v_row.id, w.id, w.influencer_id, w.amount_ars);
  END LOOP;
  RETURN v_row;
END;
$fn$;

-- Un CTE sólo vive durante una sentencia. Se materializan los perfiles una
-- vez para reutilizarlos en comisiones, pagos y retiros.
CREATE OR REPLACE FUNCTION public.creator_earnings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_profile_ids uuid[];
  v_total numeric := 0;
  v_paid numeric := 0;
  v_pending numeric := 0;
  v_sales_count integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(i.id), ARRAY[]::uuid[]) INTO v_profile_ids
  FROM public.influencers i
  JOIN public.creator_accounts ca ON ca.user_id = v_user
  WHERE lower(i.email) = lower(ca.email);

  SELECT COALESCE(SUM(s.commission_ars), 0), count(*)
    INTO v_total, v_sales_count
  FROM public.influencer_sales s
  WHERE s.influencer_id = ANY(v_profile_ids);

  SELECT COALESCE(SUM(p.amount_ars), 0) INTO v_paid
  FROM public.influencer_payouts p
  WHERE p.influencer_id = ANY(v_profile_ids);

  SELECT COALESCE(SUM(w.amount_ars), 0) INTO v_pending
  FROM public.influencer_withdrawal_requests w
  WHERE w.influencer_id = ANY(v_profile_ids)
    AND w.status IN ('pending', 'approved');

  RETURN jsonb_build_object(
    'total_commissions_ars', v_total,
    'total_sales_count', v_sales_count,
    'paid_ars', v_paid,
    'pending_withdrawals_ars', v_pending,
    'available_ars', GREATEST(v_total - v_paid - v_pending, 0)
  );
END;
$fn$;

UPDATE public.security_function_contracts c
SET definition_hash = md5(pg_get_functiondef(p.oid)),
    reviewed_on = DATE '2026-09-25'
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = c.function_name
  AND pg_get_function_identity_arguments(p.oid) = c.identity_arguments
  AND c.function_name IN ('campaign_chat_list', 'create_payout_batch');
