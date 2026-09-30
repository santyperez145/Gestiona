-- Aprobación y preparación del pago en una transacción. El envío externo sigue
-- condicionado a la capacidad comercial y a la confirmación del proveedor.
BEGIN;

ALTER TABLE public.influencer_payout_batches
  ADD COLUMN IF NOT EXISTS idempotency_key text;
-- Los lotes ya enviados deben conservar la clave con la que fueron enviados.
UPDATE public.influencer_payout_batches
SET idempotency_key = external_reference
WHERE idempotency_key IS NULL;
ALTER TABLE public.influencer_payout_batches
  ALTER COLUMN idempotency_key SET DEFAULT gen_random_uuid()::text;
ALTER TABLE public.influencer_payout_batches
  ALTER COLUMN idempotency_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS influencer_payout_batch_idempotency_key_unique
  ON public.influencer_payout_batches(idempotency_key);
ALTER TABLE public.influencer_payout_batches
  DROP CONSTRAINT IF EXISTS influencer_payout_batch_idempotency_key_length;
ALTER TABLE public.influencer_payout_batches
  ADD CONSTRAINT influencer_payout_batch_idempotency_key_length
  CHECK (char_length(idempotency_key) BETWEEN 1 AND 64);

CREATE OR REPLACE FUNCTION public.approve_and_create_payout_batch(p_request_id uuid)
RETURNS public.influencer_payout_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_withdrawal public.influencer_withdrawal_requests;
  v_batch public.influencer_payout_batches;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_withdrawal
  FROM public.influencer_withdrawal_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF v_withdrawal.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_manage_influencers(v_withdrawal.org_id, 'edit') THEN
    RAISE EXCEPTION 'Sin permiso para aprobar pagos' USING ERRCODE = '42501';
  END IF;
  IF v_withdrawal.payout_provider IS DISTINCT FROM 'mercadopago'
     OR v_withdrawal.payout_destination_type IS DISTINCT FROM 'email'
     OR v_withdrawal.payout_identifier_encrypted IS NULL THEN
    RAISE EXCEPTION 'Este destino requiere una transferencia externa'
      USING ERRCODE = '22023';
  END IF;
  IF v_withdrawal.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'La solicitud ya fue resuelta' USING ERRCODE = '22023';
  END IF;

  -- Un retry después de que la Edge cayó devuelve el mismo lote, jamás crea
  -- otro intento mientras el resultado del proveedor sea incierto.
  SELECT batch.* INTO v_batch
  FROM public.influencer_payout_batch_items item
  JOIN public.influencer_payout_batches batch ON batch.id = item.batch_id
  WHERE item.withdrawal_id = p_request_id
    AND item.status IN ('pending', 'processing')
  ORDER BY batch.created_at DESC
  LIMIT 1;
  IF v_batch.id IS NOT NULL THEN RETURN v_batch; END IF;

  IF v_withdrawal.status = 'pending' THEN
    PERFORM public.resolve_creator_withdrawal(p_request_id, 'approved');
  END IF;
  RETURN public.create_payout_batch(ARRAY[p_request_id]);
END;
$fn$;

REVOKE ALL ON FUNCTION public.approve_and_create_payout_batch(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_and_create_payout_batch(uuid)
  TO authenticated;

-- Un comprobante manual no puede cerrar un retiro que quizá ya salió por MP.
-- El webhook verificado usa service_role y puede confirmar ese mismo lote.
CREATE OR REPLACE FUNCTION public.prevent_parallel_creator_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF OLD.status = 'approved' AND NEW.status = 'paid'
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role'
     AND EXISTS (
       SELECT 1 FROM public.influencer_payout_batch_items item
       WHERE item.withdrawal_id = NEW.id
         AND item.status IN ('pending', 'processing')
     ) THEN
    RAISE EXCEPTION 'El proveedor está confirmando este pago. Sincronizá el lote antes de registrar una transferencia.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.prevent_parallel_creator_settlement()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_parallel_creator_settlement
  ON public.influencer_withdrawal_requests;
CREATE TRIGGER prevent_parallel_creator_settlement
  BEFORE UPDATE OF status ON public.influencer_withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_parallel_creator_settlement();

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT procedure.proname, pg_get_function_identity_arguments(procedure.oid),
       CASE WHEN procedure.proname = 'approve_and_create_payout_batch'
         THEN 'authenticated_delegate' ELSE 'security_helper' END,
       CASE WHEN procedure.proname = 'approve_and_create_payout_batch'
         THEN 'Aprueba y prepara un único lote por retiro autorizado, sin mover dinero en la base.'
         ELSE 'Impide cierre manual mientras un pago externo pueda estar en curso.' END,
       md5(pg_get_functiondef(procedure.oid)), CURRENT_DATE
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname IN ('approve_and_create_payout_batch', 'prevent_parallel_creator_settlement')
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
