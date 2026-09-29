-- Cierra la autoridad operativa de retiros de creadores.
--
-- Aprobar/rechazar es una decisión humana de la marca. Confirmar un pago es
-- otra transición y exige una referencia externa; puede realizarla la marca o
-- el sincronizador firmado del proveedor. Ambas rutas producen payout, gasto
-- y asiento Finance en una sola transacción idempotente.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_creator_withdrawal(
  p_request_id uuid,
  p_status text
) RETURNS public.influencer_withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE v_row public.influencer_withdrawal_requests;
BEGIN
  SELECT * INTO v_row
  FROM public.influencer_withdrawal_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_manage_influencers(v_row.org_id, 'edit') THEN
    RAISE EXCEPTION 'Sin permiso para revisar retiros' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Aprobar o rechazar no confirma una transferencia' USING ERRCODE = '22023';
  END IF;
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'La solicitud ya fue revisada' USING ERRCODE = '22023';
  END IF;

  UPDATE public.influencer_withdrawal_requests
  SET status = p_status, processed_at = now(), processed_by = auth.uid()
  WHERE id = p_request_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.settle_creator_withdrawal(
  p_request_id uuid,
  p_payment_reference text,
  p_payment_method text DEFAULT 'transferencia'
) RETURNS public.influencer_withdrawal_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row public.influencer_withdrawal_requests;
  v_is_service boolean := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
  v_is_brand boolean;
  v_actor uuid;
  v_creator_name text;
  v_reference text := btrim(COALESCE(p_payment_reference, ''));
  v_method text := left(btrim(COALESCE(NULLIF(p_payment_method, ''), 'transferencia')), 40);
BEGIN
  SELECT * INTO v_row
  FROM public.influencer_withdrawal_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Solicitud no encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT public.can_manage_influencers(v_row.org_id, 'edit') INTO v_is_brand;
  IF NOT COALESCE(v_is_brand, false) AND NOT v_is_service THEN
    RAISE EXCEPTION 'Sin permiso para liquidar retiros' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reference) < 3 THEN
    RAISE EXCEPTION 'Ingresá la referencia de la transferencia' USING ERRCODE = '22023';
  END IF;
  IF v_row.status = 'paid' AND v_row.payment_reference IS DISTINCT FROM left(v_reference, 160) THEN
    RAISE EXCEPTION 'El retiro ya fue liquidado con otra referencia' USING ERRCODE = '22023';
  END IF;
  IF v_row.status NOT IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'Primero aprobá la solicitud' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    auth.uid(),
    v_row.processed_by,
    organization.owner_user_id,
    (SELECT membership.user_id
       FROM public.memberships membership
      WHERE membership.org_id = v_row.org_id
      ORDER BY CASE WHEN membership.role IN ('owner', 'admin') THEN 0 ELSE 1 END,
               membership.joined_at NULLS LAST
      LIMIT 1)
  ) INTO v_actor
  FROM public.organizations organization
  WHERE organization.id = v_row.org_id;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'La organización no tiene responsable para registrar el pago' USING ERRCODE = '23502';
  END IF;

  INSERT INTO public.influencer_payouts (
    org_id, influencer_id, amount_ars, payment_method, notes, created_by
  )
  SELECT v_row.org_id, v_row.influencer_id, v_row.amount_ars, v_method,
         'withdrawal:' || v_row.id::text, v_actor
  WHERE NOT EXISTS (
    SELECT 1 FROM public.influencer_payouts
    WHERE influencer_id = v_row.influencer_id
      AND notes = 'withdrawal:' || v_row.id::text
  );

  SELECT influencer.name INTO v_creator_name
  FROM public.influencers influencer
  WHERE influencer.id = v_row.influencer_id;

  INSERT INTO public.expenses (
    org_id, user_id, description, amount_ars, category, date, vendor
  )
  SELECT v_row.org_id, v_actor,
         'Liquidación de comisiones - ' || COALESCE(v_creator_name, 'creador'),
         v_row.amount_ars, 'marketing', CURRENT_DATE,
         'influencer_withdrawal:' || v_row.id::text
  WHERE NOT EXISTS (
    SELECT 1 FROM public.expenses expense
    WHERE expense.org_id = v_row.org_id
      AND expense.vendor = 'influencer_withdrawal:' || v_row.id::text
  );

  UPDATE public.influencer_withdrawal_requests
  SET status = 'paid', payment_reference = left(v_reference, 160),
      payment_method = v_method, paid_at = COALESCE(paid_at, now()),
      processed_at = COALESCE(processed_at, now()),
      processed_by = COALESCE(processed_by, v_actor)
  WHERE id = p_request_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.resolve_creator_withdrawal(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_creator_withdrawal(uuid, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.settle_creator_withdrawal(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_creator_withdrawal(uuid, text, text)
  TO authenticated, service_role;

INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT contract.function_name, contract.identity_arguments,
       contract.audience, contract.rationale, md5(pg_get_functiondef(procedure.oid)),
       DATE '2026-09-29'
FROM (VALUES
  ('resolve_creator_withdrawal', 'p_request_id uuid, p_status text',
   'authenticated_delegate', 'La marca aprueba o rechaza; esta RPC nunca confirma movimientos de dinero.'),
  ('settle_creator_withdrawal', 'p_request_id uuid, p_payment_reference text, p_payment_method text',
   'authenticated_delegate', 'Marca o proveedor confirman con referencia; payout, gasto y asiento son atómicos e idempotentes.')
) AS contract(function_name, identity_arguments, audience, rationale)
JOIN pg_proc procedure ON procedure.proname = contract.function_name
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  AND namespace.nspname = 'public'
WHERE pg_get_function_identity_arguments(procedure.oid) = contract.identity_arguments
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

COMMIT;
