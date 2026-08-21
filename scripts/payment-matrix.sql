-- F0 — matriz destructiva segura del ciclo de pagos.
--
-- Usa una organización ZZ dentro de un sub-bloque transaccional. Al finalizar
-- fuerza los constraints diferidos y provoca un rollback controlado del
-- sub-bloque: las métricas sobreviven en variables PL/pgSQL, los datos no.

BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE zz_payment_matrix_result (
  scenario text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $matrix$
DECLARE
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_user uuid;
  v_org uuid;
  v_store uuid;
  v_product uuid;
  v_order uuid;
  v_rejected_order uuid;
  v_rma uuid;
  v_first jsonb;
  v_duplicate jsonb;
  v_pending jsonb;
  v_approved jsonb;
  v_approved_duplicate jsonb;
  v_rejected jsonb;
  v_retry jsonb;
  v_refund_first jsonb;
  v_refund_retry jsonb;
  v_refund_state jsonb;
  v_refund_done jsonb;
  v_refund_duplicate jsonb;
  v_intent uuid;
  v_attempt uuid;
  v_rejected_attempt uuid;
  v_refund uuid;
  v_settlement uuid;
  v_settlement_duplicate uuid;
  v_ledger uuid;
  v_stock_after_payment integer;
  v_stock_after_refund integer;
  v_provider_fee numeric;
  v_provider_fee_iva numeric;
  v_ledger_fee numeric;
  v_count integer;
  v_leftovers integer;
  v_results jsonb := '[]'::jsonb;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'La matriz necesita un usuario existente para el owner ZZ';
  END IF;

  BEGIN
    INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ matriz de pagos ' || v_suffix, 'zz-payment-matrix-' || v_suffix, v_user)
    RETURNING id INTO v_org;

    INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (v_org, v_user, 'owner');

    -- Habilita el ruteo sin crear ni leer una credencial: la matriz corta antes
    -- de la red y ensaya únicamente la autoridad de estados de Gestiona.
    INSERT INTO public.org_payment_providers (org_id, provider, habilitado, cuenta)
    VALUES (v_org, 'mercadopago', true, 'ZZ matriz sin credencial');

    INSERT INTO public.ecommerce_stores (org_id, name, slug, is_active)
    VALUES (v_org, 'ZZ tienda matriz', 'zz-payment-matrix-' || v_suffix, true)
    RETURNING id INTO v_store;

    INSERT INTO public.products (
      org_id, user_id, name, sale_price_ars, total_cost_usd, stock, is_active
    ) VALUES (
      v_org, v_user, 'ZZ producto matriz de pagos', 1000, 0.25, 5, true
    ) RETURNING id INTO v_product;

    INSERT INTO public.ecommerce_orders (
      org_id, store_id, order_number, customer_name, customer_email,
      items, subtotal, total, payment_method
    ) VALUES (
      v_org, v_store, 'ZZPAY-' || v_suffix, 'ZZ comprador',
      'zz-payment-' || v_suffix || '@invalid.test',
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product, 'name', 'ZZ producto matriz de pagos',
        'quantity', 1, 'unit_price', 1000, 'total', 1000
      )),
      1000, 1000, 'mercadopago'
    ) RETURNING id INTO v_order;

    -- Checkout + submit duplicado: una sola intención y un solo intento.
    v_first := public.pago_intento_preparar(
      v_order, 'mercadopago', 1, 'zz-checkout:' || v_suffix
    );
    v_duplicate := public.pago_intento_preparar(
      v_order, 'mercadopago', 1, 'zz-checkout:' || v_suffix
    );
    v_intent := (v_first->>'intent_id')::uuid;
    v_attempt := (v_first->>'attempt_id')::uuid;

    IF (v_duplicate->>'intent_id')::uuid <> v_intent
       OR (v_duplicate->>'attempt_id')::uuid <> v_attempt
       OR COALESCE((v_duplicate->>'reusado')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'El submit duplicado creó otra operación';
    END IF;
    SELECT count(*) INTO v_count FROM public.payment_attempts WHERE intent_id = v_intent;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Hay % intentos para el mismo checkout', v_count; END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'checkout_idempotente', 'passed', true,
      'detail', 'misma clave, una intención y un intento'
    ));

    -- Timeout ambiguo: queda pendiente y el retry conserva la clave canónica.
    PERFORM public.pago_attempt_resultado(
      v_attempt, 'pendiente', NULL, NULL, NULL, NULL,
      'timeout simulado antes de conocer el resultado',
      jsonb_build_object('source', 'payment_matrix', 'outcome', 'unknown')
    );
    v_pending := public.pago_intento_preparar(
      v_order, 'mercadopago', 1, 'zz-checkout:' || v_suffix
    );
    SELECT count(*) INTO v_count FROM public.payment_attempts WHERE intent_id = v_intent;
    IF (v_pending->>'attempt_id')::uuid <> v_attempt OR v_count <> 1 THEN
      RAISE EXCEPTION 'El timeout abrió un segundo intento de cobro';
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'timeout_sin_doble_cobro', 'passed', true,
      'detail', 'estado ambiguo reutiliza el intento pendiente'
    ));

    -- Webhook aprobado repetido + settlement repetido + mark paid repetido.
    v_approved := public.pago_attempt_resultado(
      v_attempt, 'aprobado', 'zz-payment-' || v_suffix, 50, 0, 950,
      NULL, jsonb_build_object('source', 'payment_matrix', 'status', 'approved')
    );
    v_approved_duplicate := public.pago_attempt_resultado(
      v_attempt, 'aprobado', 'zz-payment-' || v_suffix, 50, 0, 950,
      NULL, jsonb_build_object('source', 'payment_matrix', 'status', 'approved')
    );
    IF COALESCE((v_approved_duplicate->>'repetido')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'El resultado aprobado repetido no fue idempotente';
    END IF;

    v_settlement := public.record_payment_settlement(
      v_org, 'ecommerce', v_order, 'mercadopago', 'wallet', 1,
      1000, 'zz-payment-' || v_suffix, 50, 'ARS', 'approved'
    );
    v_settlement_duplicate := public.record_payment_settlement(
      v_org, 'ecommerce', v_order, 'mercadopago', 'wallet', 1,
      1000, 'zz-payment-' || v_suffix, 50, 'ARS', 'approved'
    );
    IF v_settlement IS NULL OR v_settlement_duplicate <> v_settlement THEN
      RAISE EXCEPTION 'La liquidación duplicada creó otra transacción';
    END IF;

    PERFORM public.mark_store_order_paid(v_order, 'zz-payment-' || v_suffix, 'mercado_pago');
    PERFORM public.mark_store_order_paid(v_order, 'zz-payment-' || v_suffix, 'mercado_pago');

    SELECT count(*) INTO v_count FROM public.sales WHERE ecommerce_order_id = v_order;
    SELECT stock INTO v_stock_after_payment FROM public.products WHERE id = v_product;
    IF v_count <> 1 OR v_stock_after_payment <> 4 THEN
      RAISE EXCEPTION 'Webhook duplicado dejó % ventas y stock %', v_count, v_stock_after_payment;
    END IF;
    SELECT count(*) INTO v_count
    FROM public.payment_transactions
    WHERE org_id = v_org AND external_id = 'zz-payment-' || v_suffix;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Hay % liquidaciones para el mismo pago', v_count; END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'webhook_duplicado', 'passed', true,
      'detail', 'una venta, un movimiento de stock y una liquidación'
    ));

    -- La liquidación ecommerce tiene que llegar al ledger con la comisión real.
    v_ledger := public.ledger_asentar_orden_pagada(jsonb_build_object(
      'org_id', v_org,
      'data', jsonb_build_object('order_id', v_order)
    ));
    SELECT provider_fee, provider_fee_iva
      INTO v_provider_fee, v_provider_fee_iva
    FROM public.payment_transactions WHERE id = v_settlement;
    SELECT COALESCE(sum(l.debe), 0) INTO v_ledger_fee
    FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id = l.account_id
    WHERE l.entry_id = v_ledger AND a.codigo = '5.2.01';
    IF v_provider_fee <= 0
       OR v_ledger_fee <> round(v_provider_fee + v_provider_fee_iva, 2) THEN
      RAISE EXCEPTION 'El ledger perdió la comisión: transacción % + %, asiento %',
        v_provider_fee, v_provider_fee_iva, v_ledger_fee;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'liquidacion_al_ledger', 'passed', true,
      'detail', 'source ecommerce conserva comisión e IVA en el asiento'
    ));

    -- Rechazo: no acredita y una acción explícita abre un intento nuevo.
    INSERT INTO public.ecommerce_orders (
      org_id, store_id, order_number, customer_name, customer_email,
      items, subtotal, total, payment_method
    ) VALUES (
      v_org, v_store, 'ZZREJ-' || v_suffix, 'ZZ comprador rechazo',
      'zz-rejected-' || v_suffix || '@invalid.test',
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product, 'name', 'ZZ producto matriz de pagos',
        'quantity', 1, 'unit_price', 250, 'total', 250
      )),
      250, 250, 'mercadopago'
    ) RETURNING id INTO v_rejected_order;
    v_rejected := public.pago_intento_preparar(
      v_rejected_order, 'mercadopago', 1, 'zz-rejected:' || v_suffix
    );
    v_rejected_attempt := (v_rejected->>'attempt_id')::uuid;
    PERFORM public.pago_attempt_resultado(
      v_rejected_attempt, 'rechazado', 'zz-rejected-' || v_suffix,
      NULL, NULL, NULL, 'rejected_by_provider',
      jsonb_build_object('source', 'payment_matrix', 'status', 'rejected')
    );
    v_retry := public.pago_intento_preparar(
      v_rejected_order, 'mercadopago', 1, 'zz-retry:' || v_suffix
    );
    IF (v_retry->>'attempt_id')::uuid = v_rejected_attempt
       OR (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_rejected_order) <> 'pending' THEN
      RAISE EXCEPTION 'El rechazo se acreditó o reutilizó un intento terminal';
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'rechazo_reintentable', 'passed', true,
      'detail', 'no acredita; el retry explícito usa un intento nuevo'
    ));

    -- Reintegro: timeout conserva processing y la reconciliación es idempotente.
    INSERT INTO public.return_requests (
      org_id, rma_number, ecommerce_order_id, tipo,
      customer_name, customer_email, product_id, product_name, quantity,
      condition, resolution, refund_amount, refund_method, status,
      reason_text, approved_by, approved_at
    ) VALUES (
      v_org, 'ZZRMA-' || v_suffix, v_order, 'arrepentimiento',
      'ZZ comprador', 'zz-payment-' || v_suffix || '@invalid.test',
      v_product, 'ZZ producto matriz de pagos', 1,
      'unopened', 'refund', 1000, 'original_payment', 'approved',
      'Matriz de pago', v_user, now()
    ) RETURNING id INTO v_rma;

    v_refund_first := public.pago_reintegro_preparar(v_org, v_rma, v_user);
    v_refund := (v_refund_first->>'refund_id')::uuid;
    v_refund_state := public.pago_reintegro_estado(v_org, v_rma);
    v_refund_retry := public.pago_reintegro_preparar(v_org, v_rma, v_user);
    IF v_refund_state->>'status' <> 'processing'
       OR (v_refund_retry->>'refund_id')::uuid <> v_refund
       OR v_refund_retry->>'client_key' <> v_refund_first->>'client_key' THEN
      RAISE EXCEPTION 'El timeout de reintegro no conservó operación y clave';
    END IF;
    SELECT count(*) INTO v_count FROM public.payment_refunds WHERE return_request_id = v_rma;
    IF v_count <> 1 THEN RAISE EXCEPTION 'El retry creó % reintegros', v_count; END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'refund_timeout', 'passed', true,
      'detail', 'processing conserva refund y clave de proveedor'
    ));

    v_refund_done := public.pago_reintegro_resultado(
      v_refund, 'refunded', 'zz-refund-' || v_suffix,
      jsonb_build_object('source', 'payment_matrix', 'status', 'approved'), NULL
    );
    v_refund_duplicate := public.pago_reintegro_resultado(
      v_refund, 'refunded', 'zz-refund-' || v_suffix,
      jsonb_build_object('source', 'payment_matrix', 'status', 'approved'), NULL
    );
    SELECT stock INTO v_stock_after_refund FROM public.products WHERE id = v_product;
    IF v_refund_done->>'order_payment_status' <> 'refunded'
       OR COALESCE((v_refund_duplicate->>'idempotent')::boolean, false) IS NOT TRUE
       OR v_stock_after_refund <> v_stock_after_payment
       OR (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_order) <> 'refunded'
       OR (SELECT status FROM public.return_requests WHERE id = v_rma) <> 'resolved' THEN
      RAISE EXCEPTION 'La reconciliación del reintegro duplicó stock o dejó estados ambiguos';
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'refund_reconciliado', 'passed', true,
      'detail', 'orden refund, RMA resuelto, resultado duplicado y stock intacto'
    ));

    -- Ejecuta ahora los constraints diferidos. Si alguno falla, no se informa
    -- verde antes de descubrirlo al COMMIT.
    SET CONSTRAINTS ALL IMMEDIATE;

    -- Rollback deliberado del sub-bloque. Las variables PL/pgSQL conservan la
    -- matriz; organizaciones, ventas, stock, ledger y eventos vuelven atrás.
    RAISE EXCEPTION 'payment matrix rollback' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'payment matrix rollback' THEN RAISE; END IF;
  END;

  SELECT
      (SELECT count(*) FROM public.organizations WHERE id = v_org)
    + (SELECT count(*) FROM public.products WHERE org_id = v_org)
    + (SELECT count(*) FROM public.ecommerce_orders WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_intents WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_attempts WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_transactions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_refunds WHERE org_id = v_org)
    + (SELECT count(*) FROM public.ledger_entries WHERE org_id = v_org)
  INTO v_leftovers;
  IF v_leftovers <> 0 THEN
    RAISE EXCEPTION 'La matriz dejó % restos después del rollback', v_leftovers;
  END IF;

  INSERT INTO zz_payment_matrix_result (scenario, passed, detail)
  SELECT scenario, passed, detail
  FROM jsonb_to_recordset(v_results) AS result(
    scenario text, passed boolean, detail text
  );
  INSERT INTO zz_payment_matrix_result VALUES
    ('zz_restos', true, 'rollback transaccional: 0 filas persistidas');
END
$matrix$;

SELECT scenario, passed, detail
FROM zz_payment_matrix_result
ORDER BY scenario;

COMMIT;
