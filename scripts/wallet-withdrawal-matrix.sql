-- Certificacion reversible: reserva -> confirmacion externa -> ledger.
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE zz_wallet_result (
  scenario text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $matrix$
DECLARE
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_user uuid;
  v_org uuid;
  v_account public.wallet_bank_accounts;
  v_request jsonb;
  v_withdrawal uuid;
  v_row public.wallet_withdrawals;
  v_saldo jsonb;
  v_count integer;
  v_denied boolean := false;
  v_leftovers integer;
  v_results jsonb := '[]'::jsonb;
BEGIN
  SELECT users.id INTO v_user FROM auth.users users ORDER BY users.created_at LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'La matriz necesita un usuario existente'; END IF;

  BEGIN
    INSERT INTO public.organizations(name, slug, owner_user_id)
    VALUES ('ZZ billetera ' || v_suffix, 'zz-wallet-' || v_suffix, v_user)
    RETURNING id INTO v_org;
    INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');
    INSERT INTO public.ledger_accounts(org_id, codigo, nombre, tipo, imputable)
    VALUES
      (v_org, '1.1.01', 'Caja', 'activo', true),
      (v_org, '1.1.02', 'Banco', 'activo', true),
      (v_org, '1.1.04', 'Billetera disponible', 'activo', true)
    ON CONFLICT (org_id, codigo) DO NOTHING;
    PERFORM public.ledger_asentar(
      v_org, 'ZZ saldo inicial',
      jsonb_build_array(
        jsonb_build_object('cuenta', '1.1.04', 'debe', 10000, 'detalle', 'Disponible'),
        jsonb_build_object('cuenta', '1.1.01', 'haber', 10000, 'detalle', 'Contrapartida')
      ), CURRENT_DATE, 'zz_wallet_seed', gen_random_uuid()
    );

    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_account := public.wallet_guardar_cuenta(
      v_org, 'Cuenta matriz', 'Titular matriz', '0170099220000067797393', 'Banco matriz'
    );
    v_request := public.wallet_solicitar_retiro(v_org, 3000, v_account.id, 'zz-wallet-1-' || v_suffix);
    v_withdrawal := (v_request->>'withdrawal_id')::uuid;
    RESET ROLE;

    SELECT * INTO v_row FROM public.wallet_withdrawals WHERE id = v_withdrawal;
    ASSERT v_row.estado = 'solicitado' AND v_row.entry_id IS NULL,
      'solicitar invento una transferencia o un asiento';
    SET LOCAL ROLE authenticated;
    v_saldo := public.wallet_saldo(v_org);
    RESET ROLE;
    ASSERT (v_saldo->>'disponible')::numeric = 10000
       AND (v_saldo->>'en_retiro')::numeric = 3000
       AND (v_saldo->>'retirable')::numeric = 7000,
      'la reserva no separo disponible, reservado y retirable';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'reserva_sin_transferencia', 'passed', true,
      'detail', 'solicitud reserva ARS 3.000 y no toca el ledger'
    ));

    SET LOCAL ROLE authenticated;
    v_row := public.wallet_confirmar_retiro(v_withdrawal, 'ZZ-BANK-' || v_suffix, 'transferencia');
    v_row := public.wallet_confirmar_retiro(v_withdrawal, 'ZZ-BANK-' || v_suffix, 'transferencia');
    RESET ROLE;
    ASSERT v_row.estado = 'pagado' AND v_row.entry_id IS NOT NULL
       AND v_row.referencia = 'ZZ-BANK-' || v_suffix,
      'la confirmacion no enlazo estado, referencia y asiento';
    SELECT count(*) INTO v_count FROM public.ledger_entries
    WHERE org_id = v_org AND referencia_tipo = 'retiro' AND referencia_id = v_withdrawal;
    ASSERT v_count = 1, 'la confirmacion no fue idempotente en el ledger';
    SET LOCAL ROLE authenticated;
    v_saldo := public.wallet_saldo(v_org);
    RESET ROLE;
    ASSERT (v_saldo->>'disponible')::numeric = 7000
       AND (v_saldo->>'en_retiro')::numeric = 0
       AND (v_saldo->>'retirable')::numeric = 7000,
      'el pago confirmado no actualizo el saldo real';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'confirmacion_a_ledger', 'passed', true,
      'detail', 'referencia externa crea exactamente un asiento billetera a banco'
    ));

    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.wallet_confirmar_retiro(v_withdrawal, 'ZZ-OTRA-' || v_suffix, 'transferencia');
    EXCEPTION WHEN invalid_parameter_value THEN v_denied := true;
    END;
    RESET ROLE;
    ASSERT v_denied, 'otra referencia reemplazo la evidencia original';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'referencia_inmutable', 'passed', true,
      'detail', 'un reintento contradictorio se rechaza'
    ));

    SET LOCAL ROLE authenticated;
    v_request := public.wallet_solicitar_retiro(v_org, 2000, v_account.id, 'zz-wallet-2-' || v_suffix);
    v_withdrawal := (v_request->>'withdrawal_id')::uuid;
    PERFORM public.wallet_rechazar_retiro(v_withdrawal, 'Operacion cancelada por la matriz');
    v_saldo := public.wallet_saldo(v_org);
    RESET ROLE;
    SELECT * INTO v_row FROM public.wallet_withdrawals WHERE id = v_withdrawal;
    ASSERT v_row.estado = 'rechazado' AND v_row.entry_id IS NULL AND v_row.reversa_id IS NULL,
      'cancelar una reserva creo movimientos inexistentes';
    ASSERT (v_saldo->>'retirable')::numeric = 7000,
      'cancelar no devolvio el saldo reservado';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'cancelacion_sin_ficcion', 'passed', true,
      'detail', 'libera la reserva sin asiento ni contraasiento inventados'
    ));

    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'wallet matrix rollback' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'wallet matrix rollback' THEN RAISE; END IF;
  END;

  SELECT
      (SELECT count(*) FROM public.organizations WHERE id = v_org)
    + (SELECT count(*) FROM public.wallet_bank_accounts WHERE org_id = v_org)
    + (SELECT count(*) FROM public.wallet_withdrawals WHERE org_id = v_org)
    + (SELECT count(*) FROM public.ledger_entries WHERE org_id = v_org)
  INTO v_leftovers;
  IF v_leftovers <> 0 THEN RAISE EXCEPTION 'La matriz dejo % restos', v_leftovers; END IF;

  INSERT INTO zz_wallet_result(scenario, passed, detail)
  SELECT scenario, passed, detail
  FROM jsonb_to_recordset(v_results) AS result(scenario text, passed boolean, detail text);
  INSERT INTO zz_wallet_result VALUES
    ('zz_restos', true, 'rollback transaccional: 0 filas persistidas');
END
$matrix$;

SELECT scenario, passed, detail FROM zz_wallet_result ORDER BY scenario;
COMMIT;
