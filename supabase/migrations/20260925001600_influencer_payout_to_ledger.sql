-- ============================================================================
-- Liquidación de influencers enlazada a Finance: asiento ledger para payouts
-- ============================================================================
--
-- Este cambio modifica la función resolve_creator_withdrawal para crear un
-- asiento contable en el ledger cuando se liquida un retiro de creador como
-- 'pagado', cerrando el ciclo completo: retiro aprobado → payout MP → asiento
-- en ledger → conciliación bancaria.
--
-- El asiento creado es:
--   DEBE  5.9.01 Otros gastos        = monto del payout
--   HABER 1.1.02 Banco               = monto del payout
-- Con metadata que vincula al withdrawal_id y influencer_id para trazabilidad.

-- Primero, obtenemos la definición actual de la función para modificarla
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
    
    -- ASIENTO LEDGER PARA EL PAGO AL CREADOR
    -- Gasto en cuenta 5.9.01 (Otros gastos) y salida de banco 1.1.02
    PERFORM public.ledger_asentar(
      p_org := v_row.org_id,
      p_descripcion := 'Pago a creador por retiro ' || v_row.id::text,
      p_lineas := jsonb_build_array(
        jsonb_build_object('cuenta', '5.9.01', 'debe', v_row.amount_ars,
          'detalle', 'Pago a creador por retiro ' || v_row.id::text,
          'metadata', jsonb_build_object(
            'withdrawal_id', v_row.id::text,
            'influencer_id', v_row.influencer_id::text,
            'payout_note', 'withdrawal:' || v_row.id::text
          )),
        jsonb_build_object('cuenta', '1.1.02', 'haber', v_row.amount_ars,
          'detalle', 'Salida de banco por pago a creador',
          'metadata', jsonb_build_object(
            'withdrawal_id', v_row.id::text,
            'influencer_id', v_row.influencer_id::text
          ))
      ),
      p_fecha := now()::date,
      p_ref_tipo := 'payout_creator',
      p_ref_id := v_row.id
    );
  END IF;

  RETURN v_row;
END;
$$;

-- Permisos
REVOKE ALL ON FUNCTION public.resolve_creator_withdrawal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_creator_withdrawal(uuid, text) TO authenticated;

-- Contratos versionados
INSERT INTO public.security_function_contracts(
  function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on
)
SELECT
  'resolve_creator_withdrawal', 'p_request_id uuid, p_status text', 'authenticated_delegate',
  'La marca liquida el retiro y la base asienta la liquidacion idempotente en payouts y crea asiento en ledger para Finanzas.',
  md5(pg_get_functiondef(procedure.oid)), DATE '2026-09-25'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.proname = 'resolve_creator_withdrawal'
  AND pg_get_function_identity_arguments(procedure.oid) = 'p_request_id uuid, p_status text'
ON CONFLICT (function_name, identity_arguments) DO UPDATE SET
  audience = EXCLUDED.audience,
  rationale = EXCLUDED.rationale,
  definition_hash = EXCLUDED.definition_hash,
  reviewed_on = EXCLUDED.reviewed_on;

-- Registro de migración
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260925001600', 'influencer_payout_to_ledger')
ON CONFLICT DO NOTHING;