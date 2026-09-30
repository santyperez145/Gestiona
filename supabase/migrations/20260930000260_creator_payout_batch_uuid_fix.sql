-- La primera ejecución real detectó min(uuid), que PostgreSQL no implementa.
-- Conservamos la misma autoridad e índices; sólo corregimos la agregación.
BEGIN;

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
    RAISE EXCEPTION 'La selección contiene retiros repetidos' USING ERRCODE = '22023';
  END IF;

  SELECT min(w.org_id::text)::uuid, count(*), count(DISTINCT w.org_id), COALESCE(sum(w.amount_ars), 0)
    INTO v_org, v_count, v_org_count, v_total
  FROM public.influencer_withdrawal_requests w
  WHERE w.id = ANY(p_withdrawal_ids)
    AND w.status = 'approved'
    AND w.payout_provider = 'mercadopago'
    AND w.payout_destination_type = 'email'
    AND w.payout_identifier_encrypted IS NOT NULL;

  IF v_count <> cardinality(p_withdrawal_ids) OR v_org_count <> 1 THEN
    RAISE EXCEPTION 'Todos los retiros deben estar aprobados, pertenecer a una organización y usar una cuenta Mercado Pago válida'
      USING ERRCODE = '23514';
  END IF;
  IF NOT public.can_manage_influencers(v_org, 'edit') THEN
    RAISE EXCEPTION 'influencer_permission_denied' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.influencer_payout_batch_items item
    WHERE item.withdrawal_id = ANY(p_withdrawal_ids)
      AND item.status IN ('pending', 'processing')
  ) THEN
    RAISE EXCEPTION 'Uno de los retiros ya está en un lote activo' USING ERRCODE = '55006';
  END IF;

  INSERT INTO public.influencer_payout_batches (
    org_id, external_reference, status, description, total_ars, items_count, created_by
  ) VALUES (
    v_org, 'nerqia-payout-batch-' || gen_random_uuid()::text, 'processing',
    'Pago automático de comisiones a creadores', v_total, cardinality(p_withdrawal_ids), auth.uid()
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

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT procedure.proname, pg_get_function_identity_arguments(procedure.oid),
       'authenticated_delegate',
       'Crea un lote único con retiros MP aprobados y destinos versionados.',
       md5(pg_get_functiondef(procedure.oid)), CURRENT_DATE
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public' AND procedure.proname = 'create_payout_batch'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
