-- Certificación reversible de comisión -> retiro -> pago -> Finance.
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE zz_creator_settlement_result (
  scenario text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $matrix$
DECLARE
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_user uuid;
  v_email text;
  v_org uuid;
  v_influencer uuid;
  v_destination uuid;
  v_request uuid;
  v_batch uuid;
  v_result jsonb;
  v_count integer;
  v_denied boolean;
  v_leftovers integer;
  v_results jsonb := '[]'::jsonb;
BEGIN
  SELECT users.id, users.email INTO v_user, v_email
  FROM auth.users users
  WHERE users.email IS NOT NULL
  ORDER BY users.created_at
  LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'La matriz necesita un usuario existente'; END IF;

  BEGIN
    INSERT INTO public.organizations(name, slug, owner_user_id)
    VALUES ('ZZ matriz retiros ' || v_suffix, 'zz-creator-settlement-' || v_suffix, v_user)
    RETURNING id INTO v_org;
    INSERT INTO public.memberships(org_id, user_id, role) VALUES (v_org, v_user, 'owner');

    INSERT INTO public.creator_accounts(user_id, email, display_name, onboarding_completed)
    VALUES (v_user, v_email, 'ZZ creador', true)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT email INTO v_email FROM public.creator_accounts WHERE user_id = v_user;

    INSERT INTO public.influencers(
      org_id, user_id, name, email, referral_code, status, commission_percent
    ) VALUES (
      v_org, v_user, 'ZZ creador ' || v_suffix, v_email,
      'ZZRET-' || v_suffix, 'activo', 10
    ) RETURNING id INTO v_influencer;

    INSERT INTO public.influencer_sales(
      org_id, sale_id, influencer_id, referral_code,
      sale_total_ars, commission_ars
    ) VALUES (
      v_org, gen_random_uuid(), v_influencer, 'ZZRET-' || v_suffix,
      10000, 1000
    );

    -- Las cuentas hacen que el gasto se asiente y permiten comprobar Finance.
    INSERT INTO public.ledger_accounts(org_id, codigo, nombre, tipo, imputable)
    VALUES
      (v_org, '1.1.01', 'Caja', 'activo', true),
      (v_org, '5.9.01', 'Otros gastos', 'gasto', true)
    ON CONFLICT (org_id, codigo) DO NOTHING;

    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    v_destination := public.creator_payout_destination_save(
      'mercadopago', 'email', 'Mercado Pago', 'ZZ creador',
      'zz-retiro-' || v_suffix || '@invalid.test', true
    );
    v_result := public.creator_request_withdrawal(700, v_destination, 'Matriz reversible');
    v_request := ((v_result->'request_ids')->>0)::uuid;
    ASSERT v_request IS NOT NULL, 'no se creó la solicitud';

    RESET ROLE;
    SELECT count(*) INTO v_count
    FROM public.creator_payout_destinations
    WHERE id = v_destination
      AND identifier_encrypted <> 'zz-retiro-' || v_suffix || '@invalid.test'
      AND identifier_masked NOT LIKE '%zz-retiro-' || v_suffix || '%';
    ASSERT v_count = 1, 'el destino no quedó cifrado y enmascarado';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'destino_privado', 'passed', true,
      'detail', 'identificador cifrado; cliente recibe sólo máscara'
    ));

    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
    v_denied := false;
    BEGIN
      PERFORM public.approve_and_create_payout_batch(v_request);
    EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
    END;
    RESET ROLE;
    ASSERT v_denied, 'anon pudo preparar un pago automático';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'anon_sin_pago', 'passed', true,
      'detail', 'anon no puede invocar la autoridad de lotes'
    ));

    -- Aprobar y preparar el envío es atómico; ni el lote ni su retry
    -- acreditan dinero antes de que lo confirme el proveedor.
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT id INTO v_batch FROM public.approve_and_create_payout_batch(v_request);
    ASSERT v_batch IS NOT NULL, 'no se preparó el lote automático';
    ASSERT (SELECT id FROM public.approve_and_create_payout_batch(v_request)) = v_batch,
      'el retry creó otro lote para el mismo retiro';
    SELECT count(*) INTO v_count FROM public.influencer_payouts
    WHERE notes = 'withdrawal:' || v_request::text;
    ASSERT v_count = 0, 'aprobar creó un pago inexistente';
    SELECT count(*) INTO v_count FROM public.expenses
    WHERE vendor = 'influencer_withdrawal:' || v_request::text;
    ASSERT v_count = 0, 'aprobar creó un gasto antes de la transferencia';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'aprobacion_sin_pago', 'passed', true,
      'detail', 'revisión humana no inventa una transferencia'
    ));

    v_denied := false;
    BEGIN
      PERFORM public.settle_creator_withdrawal(v_request, 'MANUAL-ZZ-' || v_suffix, 'transferencia');
    EXCEPTION WHEN SQLSTATE '55000' THEN v_denied := true;
    END;
    ASSERT v_denied, 'se permitió registrar otro pago con un lote externo activo';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'lote_idempotente_sin_doble_pago', 'passed', true,
      'detail', 'retry conserva el lote y bloquea liquidación manual paralela'
    ));

    -- La RPC de revisión ya no puede saltarse la referencia externa.
    v_denied := false;
    BEGIN
      PERFORM public.resolve_creator_withdrawal(v_request, 'paid');
    EXCEPTION WHEN invalid_parameter_value THEN v_denied := true;
    END;
    ASSERT v_denied, 'resolve_creator_withdrawal todavía permite marcar paid';

    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    SET LOCAL ROLE service_role;
    PERFORM public.settle_creator_withdrawal(v_request, 'MP-ZZ-' || v_suffix, 'mercadopago');
    -- Reintento del webhook con la misma referencia: sin duplicados.
    PERFORM public.settle_creator_withdrawal(v_request, 'MP-ZZ-' || v_suffix, 'mercadopago');
    RESET ROLE;

    SELECT count(*) INTO v_count FROM public.influencer_payouts
    WHERE notes = 'withdrawal:' || v_request::text AND created_by = v_user;
    ASSERT v_count = 1, 'la liquidación no creó exactamente un payout con actor';
    SELECT count(*) INTO v_count FROM public.expenses
    WHERE org_id = v_org AND vendor = 'influencer_withdrawal:' || v_request::text;
    ASSERT v_count = 1, 'la liquidación no creó exactamente un gasto Finance';
    SELECT count(*) INTO v_count FROM public.ledger_entries entry
    JOIN public.expenses expense ON expense.id = entry.referencia_id
    WHERE entry.org_id = v_org AND entry.referencia_tipo = 'gasto'
      AND expense.vendor = 'influencer_withdrawal:' || v_request::text;
    ASSERT v_count = 1, 'el gasto no llegó exactamente una vez al ledger';
    ASSERT (SELECT status = 'paid' AND payment_reference = 'MP-ZZ-' || v_suffix
      FROM public.influencer_withdrawal_requests WHERE id = v_request),
      'el retiro no quedó pagado con referencia';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'webhook_a_finance', 'passed', true,
      'detail', 'service role crea un payout, un gasto y un asiento idempotentes'
    ));

    -- Una referencia distinta nunca puede reescribir la evidencia original.
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_denied := false;
    BEGIN
      PERFORM public.settle_creator_withdrawal(v_request, 'OTRA-REFERENCIA', 'transferencia');
    EXCEPTION WHEN invalid_parameter_value THEN v_denied := true;
    END;
    RESET ROLE;
    ASSERT v_denied, 'un reintento cambió la referencia original';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'referencia_inmutable', 'passed', true,
      'detail', 'reintentos distintos se rechazan sin alterar evidencia'
    ));

    -- Una reversa conserva el pago y agrega ajustes compensatorios.
    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.reverse_creator_withdrawal(
      v_request, 'REV-ZZ-' || v_suffix, 'Proveedor devolvió la transferencia'
    );
    -- Mismo evento: idempotente.
    PERFORM public.reverse_creator_withdrawal(
      v_request, 'REV-ZZ-' || v_suffix, 'Proveedor devolvió la transferencia'
    );
    RESET ROLE;

    ASSERT (SELECT status = 'reversed' AND reversal_reference = 'REV-ZZ-' || v_suffix
      FROM public.influencer_withdrawal_requests WHERE id = v_request),
      'el retiro no quedó revertido con referencia';
    SELECT count(*) INTO v_count FROM public.influencer_payouts
    WHERE influencer_id = v_influencer
      AND notes IN ('withdrawal:' || v_request::text, 'reversal:withdrawal:' || v_request::text);
    ASSERT v_count = 2, 'la reversa no conservó pago y ajuste exactamente una vez';
    ASSERT (SELECT COALESCE(sum(amount_ars), 0) = 0 FROM public.influencer_payouts
      WHERE influencer_id = v_influencer), 'el payout neto no volvió a cero';
    ASSERT (SELECT COALESCE(sum(amount_ars), 0) = 0 FROM public.expenses
      WHERE org_id = v_org), 'el gasto neto no volvió a cero';
    ASSERT EXISTS (
      SELECT 1 FROM public.ledger_entries original
      JOIN public.ledger_entries reversal ON reversal.id = original.anulado_por
      WHERE original.org_id = v_org AND reversal.anula_a = original.id
    ), 'el ledger no conserva el contraasiento';
    SELECT count(*) INTO v_count FROM public.influencer_payout_reversals
    WHERE withdrawal_id = v_request;
    ASSERT v_count = 1, 'la reversa no es idempotente';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'reversa_a_finance', 'passed', true,
      'detail', 'payout, gasto y asiento quedan compensados sin borrar evidencia'
    ));

    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'creator settlement matrix rollback' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'creator settlement matrix rollback' THEN RAISE; END IF;
  END;

  SELECT
      (SELECT count(*) FROM public.organizations WHERE id = v_org)
    + (SELECT count(*) FROM public.influencers WHERE org_id = v_org)
    + (SELECT count(*) FROM public.influencer_sales WHERE org_id = v_org)
    + (SELECT count(*) FROM public.influencer_withdrawal_requests WHERE org_id = v_org)
    + (SELECT count(*) FROM public.influencer_payouts WHERE org_id = v_org)
    + (SELECT count(*) FROM public.influencer_payout_reversals WHERE org_id = v_org)
    + (SELECT count(*) FROM public.expenses WHERE org_id = v_org)
    + (SELECT count(*) FROM public.ledger_entries WHERE org_id = v_org)
  INTO v_leftovers;
  IF v_leftovers <> 0 THEN RAISE EXCEPTION 'La matriz dejó % restos', v_leftovers; END IF;

  INSERT INTO zz_creator_settlement_result(scenario, passed, detail)
  SELECT scenario, passed, detail
  FROM jsonb_to_recordset(v_results) AS result(
    scenario text, passed boolean, detail text
  );
  INSERT INTO zz_creator_settlement_result VALUES
    ('zz_restos', true, 'rollback transaccional: 0 filas persistidas');
END
$matrix$;

SELECT scenario, passed, detail
FROM zz_creator_settlement_result
ORDER BY scenario;
COMMIT;
