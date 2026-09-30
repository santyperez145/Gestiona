-- Certificacion reversible: ventas -> comision -> pago -> gasto -> ledger.
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE zz_seller_commission_result (
  scenario text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $matrix$
DECLARE
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_user uuid;
  v_org uuid;
  v_payout public.seller_payouts;
  v_count integer;
  v_denied boolean := false;
  v_leftovers integer;
  v_results jsonb := '[]'::jsonb;
BEGIN
  SELECT users.id INTO v_user FROM auth.users users ORDER BY users.created_at LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'La matriz necesita un usuario existente'; END IF;

  BEGIN
    INSERT INTO public.organizations(name, slug, owner_user_id)
    VALUES ('ZZ comisiones ' || v_suffix, 'zz-seller-commission-' || v_suffix, v_user)
    RETURNING id INTO v_org;
    INSERT INTO public.memberships(org_id, user_id, role, commission_enabled, commission_percent)
    VALUES (v_org, v_user, 'owner', false, 0);

    INSERT INTO public.ledger_accounts(org_id, codigo, nombre, tipo, imputable)
    VALUES
      (v_org, '1.1.01', 'Caja', 'activo', true),
      (v_org, '5.9.01', 'Otros gastos', 'gasto', true)
    ON CONFLICT (org_id, codigo) DO NOTHING;

    -- ARS 10.000 netos: una venta de 10.000 al 50% devuelta + otra de 5.000.
    INSERT INTO public.sales(
      org_id, user_id, product_name, quantity, unit_price_ars, total_ars,
      paid, returned, returned_quantity, payment_method, source
    ) VALUES
      (v_org, v_user, 'ZZ producto A', 2, 5000, 10000, true, true, 1, 'transferencia', 'manual'),
      (v_org, v_user, 'ZZ producto B', 1, 5000, 5000, true, false, 0, 'transferencia', 'manual'),
      (v_org, v_user, 'ZZ no cobrado', 1, 9000, 9000, false, false, 0, 'transferencia', 'manual');

    PERFORM set_config('request.jwt.claims',
      jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    PERFORM public.configure_seller_commission(v_org, v_user, true, 10);
    v_payout := public.generate_seller_commission(
      v_org, v_user, date_trunc('month', CURRENT_DATE)::date,
      (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date
    );
    ASSERT v_payout.sales_total_ars = 10000, 'la base no calculo ventas netas cobradas';
    ASSERT v_payout.commission_ars = 1000, 'la base no calculo la comision';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'calculo_neto', 'passed', true,
      'detail', 'ignora impagos y descuenta devoluciones parciales'
    ));

    -- Recalcular el mismo mes actualiza el borrador, no duplica.
    v_payout := public.generate_seller_commission(
      v_org, v_user, date_trunc('month', CURRENT_DATE)::date,
      (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date
    );
    RESET ROLE;
    SELECT count(*) INTO v_count FROM public.seller_payouts WHERE org_id = v_org;
    ASSERT v_count = 1, 'el recalculo duplico la liquidacion';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'periodo_idempotente', 'passed', true,
      'detail', 'una sola liquidacion por vendedor y mes'
    ));

    SET LOCAL ROLE authenticated;
    v_payout := public.settle_seller_commission(
      v_payout.id, 'ZZ-TRANSFER-' || v_suffix, 'transferencia'
    );
    -- Mismo evento externo: idempotente.
    v_payout := public.settle_seller_commission(
      v_payout.id, 'ZZ-TRANSFER-' || v_suffix, 'transferencia'
    );
    RESET ROLE;

    ASSERT v_payout.status = 'paid' AND v_payout.payment_reference = 'ZZ-TRANSFER-' || v_suffix,
      'el pago no conservo la referencia';
    ASSERT v_payout.expense_id IS NOT NULL AND v_payout.ledger_entry_id IS NOT NULL,
      'el pago no quedo enlazado a Finance';
    SELECT count(*) INTO v_count FROM public.expenses
    WHERE org_id = v_org AND vendor = 'seller_payout:' || v_payout.id::text;
    ASSERT v_count = 1, 'el pago no creo exactamente un gasto';
    SELECT count(*) INTO v_count FROM public.ledger_entries
    WHERE id = v_payout.ledger_entry_id AND referencia_tipo = 'gasto'
      AND referencia_id = v_payout.expense_id;
    ASSERT v_count = 1, 'el gasto no llego exactamente una vez al ledger';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'pago_a_finance', 'passed', true,
      'detail', 'referencia, gasto y asiento se confirman atomicamente'
    ));

    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.settle_seller_commission(v_payout.id, 'ZZ-OTRA-REFERENCIA', 'transferencia');
    EXCEPTION WHEN invalid_parameter_value THEN v_denied := true;
    END;
    RESET ROLE;
    ASSERT v_denied, 'una segunda referencia reescribio la evidencia';
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'referencia_inmutable', 'passed', true,
      'detail', 'un pago confirmado no admite otra evidencia'
    ));

    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'seller commission matrix rollback' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'seller commission matrix rollback' THEN RAISE; END IF;
  END;

  SELECT
      (SELECT count(*) FROM public.organizations WHERE id = v_org)
    + (SELECT count(*) FROM public.sales WHERE org_id = v_org)
    + (SELECT count(*) FROM public.seller_payouts WHERE org_id = v_org)
    + (SELECT count(*) FROM public.expenses WHERE org_id = v_org)
    + (SELECT count(*) FROM public.ledger_entries WHERE org_id = v_org)
  INTO v_leftovers;
  IF v_leftovers <> 0 THEN RAISE EXCEPTION 'La matriz dejo % restos', v_leftovers; END IF;

  INSERT INTO zz_seller_commission_result(scenario, passed, detail)
  SELECT scenario, passed, detail
  FROM jsonb_to_recordset(v_results) AS result(scenario text, passed boolean, detail text);
  INSERT INTO zz_seller_commission_result VALUES
    ('zz_restos', true, 'rollback transaccional: 0 filas persistidas');
END
$matrix$;

SELECT scenario, passed, detail
FROM zz_seller_commission_result
ORDER BY scenario;
COMMIT;
