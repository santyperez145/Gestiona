-- Payouts de creadores: el lote usa el destino elegido en el retiro, evita
-- dobles envios concurrentes y entrega los datos sensibles solo al service role.

ALTER TABLE public.influencer_payout_batches
  DROP CONSTRAINT IF EXISTS influencer_payout_batches_status_check;
ALTER TABLE public.influencer_payout_batches
  ADD CONSTRAINT influencer_payout_batches_status_check
  CHECK (status IN ('processing', 'awaiting_confirmation', 'completed', 'failed', 'partially_completed'));

ALTER TABLE public.influencer_payout_batch_items
  DROP CONSTRAINT IF EXISTS influencer_payout_batch_items_status_check;
ALTER TABLE public.influencer_payout_batch_items
  ADD CONSTRAINT influencer_payout_batch_items_status_check
  CHECK (status IN ('pending', 'processing', 'approved', 'rejected', 'cancelled', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS influencer_payout_one_active_batch
  ON public.influencer_payout_batch_items(withdrawal_id)
  WHERE status IN ('pending', 'processing');

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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;
  IF p_withdrawal_ids IS NULL OR cardinality(p_withdrawal_ids) = 0 THEN
    RAISE EXCEPTION 'Sin retiros para pagar' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_withdrawal_ids) <> (SELECT count(DISTINCT value) FROM unnest(p_withdrawal_ids) value) THEN
    RAISE EXCEPTION 'La seleccion contiene retiros repetidos' USING ERRCODE = '22023';
  END IF;

  SELECT min(w.org_id), count(*), count(DISTINCT w.org_id), COALESCE(sum(w.amount_ars), 0)
    INTO v_org, v_count, v_org_count, v_total
  FROM public.influencer_withdrawal_requests w
  WHERE w.id = ANY(p_withdrawal_ids)
    AND w.status = 'approved'
    AND w.payout_provider = 'mercadopago'
    AND w.payout_destination_type = 'email'
    AND w.payout_identifier_encrypted IS NOT NULL;

  IF v_count <> cardinality(p_withdrawal_ids) OR v_org_count <> 1 THEN
    RAISE EXCEPTION 'Todos los retiros deben estar aprobados, pertenecer a una organizacion y usar una cuenta Mercado Pago valida'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.can_manage_influencers(v_org, 'edit') THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.influencer_payout_batch_items item
    WHERE item.withdrawal_id = ANY(p_withdrawal_ids)
      AND item.status IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'Uno de los retiros ya esta en un lote activo'
      USING ERRCODE = 'object_in_use';
  END IF;

  INSERT INTO public.influencer_payout_batches (
    org_id, external_reference, status, description, total_ars, items_count, created_by
  ) VALUES (
    v_org, 'nerqia-payout-batch-' || gen_random_uuid()::text, 'processing',
    'Pago automatico de comisiones a creadores', v_total, cardinality(p_withdrawal_ids), auth.uid()
  ) RETURNING * INTO v_row;

  INSERT INTO public.influencer_payout_batch_items (
    batch_id, withdrawal_id, influencer_id, amount_ars
  )
  SELECT v_row.id, w.id, w.influencer_id, w.amount_ars
  FROM public.influencer_withdrawal_requests w
  WHERE w.id = ANY(p_withdrawal_ids);

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_payout_batch(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_payout_batch(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.creator_payout_batch_dispatch_payload(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_batch public.influencer_payout_batches;
  v_items jsonb;
BEGIN
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_batch
  FROM public.influencer_payout_batches
  WHERE id = p_batch_id;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Lote no encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'item_id', item.id,
    'withdrawal_id', withdrawal.id,
    'amount_ars', withdrawal.amount_ars,
    'destination_email', public.secret_decrypt(withdrawal.payout_identifier_encrypted)
  ) ORDER BY item.created_at)
  INTO v_items
  FROM public.influencer_payout_batch_items item
  JOIN public.influencer_withdrawal_requests withdrawal ON withdrawal.id = item.withdrawal_id
  WHERE item.batch_id = p_batch_id
    AND withdrawal.status = 'approved'
    AND withdrawal.payout_provider = 'mercadopago'
    AND withdrawal.payout_destination_type = 'email'
    AND withdrawal.payout_identifier_encrypted IS NOT NULL;

  IF COALESCE(jsonb_array_length(v_items), 0) <> v_batch.items_count THEN
    RAISE EXCEPTION 'El lote ya no coincide con retiros aprobados y destinos validos'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN jsonb_build_object(
    'id', v_batch.id,
    'org_id', v_batch.org_id,
    'external_reference', v_batch.external_reference,
    'mp_payout_id', v_batch.mp_payout_id,
    'status', v_batch.status,
    'items', v_items
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.creator_payout_batch_dispatch_payload(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.creator_payout_batch_dispatch_payload(uuid) TO service_role;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT procedure.proname, pg_get_function_identity_arguments(procedure.oid),
       CASE WHEN procedure.proname = 'creator_payout_batch_dispatch_payload'
         THEN 'security_helper' ELSE 'authenticated_delegate' END,
       CASE WHEN procedure.proname = 'creator_payout_batch_dispatch_payload'
         THEN 'Entrega el destino descifrado solo al adaptador server-side de payouts.'
         ELSE 'Crea un lote unico con retiros MP aprobados y destinos versionados.' END,
       md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-29'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname IN ('create_payout_batch', 'creator_payout_batch_dispatch_payload')
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;
