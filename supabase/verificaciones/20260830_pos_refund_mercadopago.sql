-- Fixture reversible del handoff PostgreSQL ↔ Mercado Pago.
-- No llama al proveedor ni usa un cobro real: prueba que el servidor deriva
-- IDs/monto/idempotencia, conserva la deuda ante fallo y sólo la cancela con
-- evidencia positiva de la Edge Function.
BEGIN;

CREATE TEMP TABLE zz_pos_mp_refund_proof (
  check_name text,
  value text
) ON COMMIT DROP;

DO $proof$
DECLARE
  v_org uuid := gen_random_uuid();
  v_location uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_sale uuid := gen_random_uuid();
  v_ticket_key uuid := gen_random_uuid();
  v_return_key uuid := gen_random_uuid();
  v_user uuid;
  v_sale_result jsonb;
  v_return_result jsonb;
  v_prepared jsonb;
  v_retry jsonb;
  v_observed jsonb;
  v_completed jsonb;
  v_transaction uuid;
  v_payment uuid;
  v_refund uuid;
  v_key text;
  v_status text;
  v_failure text;
  v_pending numeric;
  v_liability numeric;
  v_attempts integer;
  v_restos integer;
BEGIN
  SELECT membership.user_id INTO v_user
  FROM public.memberships membership
  WHERE membership.role = 'owner'
  ORDER BY membership.created_at
  LIMIT 1;
  ASSERT v_user IS NOT NULL, 'No hay owner para la fixture ZZ';

  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (
    v_org,
    'ZZ refund Mercado Pago',
    'zz-pos-mp-refund-' || substr(v_org::text, 1, 8),
    v_user
  );
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org, v_user, 'owner');
  INSERT INTO public.locations (id, org_id, name, is_main, active)
  VALUES (v_location, v_org, 'ZZ Caja QR', true, true);
  UPDATE public.settings SET exchange_rate = 1000 WHERE org_id = v_org;
  INSERT INTO public.products (
    id, org_id, user_id, name, sale_price_ars,
    cost_usd, total_cost_usd, stock
  ) VALUES (
    v_product, v_org, v_user, 'ZZ Producto QR refund', 5000,
    1, 1, 10
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
    true
  );
  v_sale_result := public.create_sales_transaction_v3(
    v_org,
    jsonb_build_array(jsonb_build_object(
      'id', v_sale,
      'user_id', v_user,
      'org_id', v_org,
      'product_id', v_product,
      'product_name', 'ZZ Producto QR refund',
      'quantity', 2,
      'unit_price_ars', 5000,
      'total_ars', 10000,
      'cost_of_goods_ars', 2000,
      'paid', true,
      'payment_method', 'mercadopago',
      'split_payments', jsonb_build_array(
        jsonb_build_object('method', 'mercadopago', 'amount', 10000)
      ),
      'location_id', v_location,
      'seller_name', 'ZZ Cajero',
      'offline_transaction_id', v_ticket_key,
      'offline_origin', false,
      'date', now(),
      'source', 'pos'
    )),
    'pos'
  );
  v_transaction := (v_sale_result->>'transaction_id')::uuid;

  UPDATE public.payment_transactions payment
  SET provider = 'mercadopago',
      method = 'wallet',
      status = 'approved',
      external_id = 'PAY-ZZ-REFUND',
      raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object(
        'provider_order_id', 'ORD-ZZ-REFUND',
        'provider_payment_id', 'PAY-ZZ-REFUND',
        'provider_status_detail', 'accredited'
      )
  WHERE payment.org_id = v_org
    AND payment.source = 'pos'
    AND payment.source_id = v_transaction
    AND payment.method = 'wallet'
  RETURNING payment.id INTO v_payment;
  ASSERT v_payment IS NOT NULL, 'el ticket no conservó el cobro Mercado Pago';

  v_return_result := public.create_sales_return_v1(
    v_org,
    v_sale,
    jsonb_build_array(jsonb_build_object('sale_id', v_sale, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object(
      'payment_transaction_id', v_payment,
      'amount', 5000
    )),
    'ZZ devolución QR',
    'ZZ fixture reversible',
    true,
    v_return_key
  );
  v_refund := (v_return_result->'refunds'->0->>'refund_id')::uuid;
  ASSERT v_refund IS NOT NULL
     AND v_return_result->'refunds'->0->>'execution_mode' = 'mercadopago_api',
    'la devolución no reconoció la evidencia de Mercado Pago';

  v_prepared := public.pos_mp_refund_prepare(v_org, v_refund, v_user, true);
  v_key := v_prepared->>'client_key';
  ASSERT v_prepared->>'api_mode' = 'orders'
     AND v_prepared->>'provider_order_id' = 'ORD-ZZ-REFUND'
     AND v_prepared->>'provider_payment_id' = 'PAY-ZZ-REFUND'
     AND (v_prepared->>'amount')::numeric = 5000
     AND NOT (v_prepared->>'is_total')::boolean,
    'prepare no derivó el refund parcial desde el cobro original';
  ASSERT v_key = 'pos-refund:' || v_refund::text,
    'la clave idempotente no es estable por parte del reintegro';

  v_retry := public.pos_mp_refund_prepare(v_org, v_refund, v_user, true);
  ASSERT v_retry->>'client_key' = v_key
     AND (v_retry->>'attempt_count')::integer = 2,
    'el retry cambió de identidad o no contó el intento';

  v_observed := public.pos_mp_refund_observe(
    v_refund,
    'http_422',
    NULL,
    'ZZ saldo insuficiente en proveedor',
    jsonb_build_object('source', 'zz_fixture', 'http_status', 422)
  );
  SELECT refund.status, refund.failure_reason, refund.provider_attempt_count
    INTO v_status, v_failure, v_attempts
  FROM public.sales_return_refunds refund
  WHERE refund.id = v_refund;
  SELECT operation.pending_amount INTO v_pending
  FROM public.sales_return_operations operation
  WHERE operation.id = (v_return_result->>'return_transaction_id')::uuid;
  ASSERT v_status = 'pending_external'
     AND v_failure = 'ZZ saldo insuficiente en proveedor'
     AND v_attempts = 2
     AND v_pending = 5000,
    'un rechazo escondió o liberó la obligación al cliente';
  ASSERT (public.pos_mp_refund_prepare(v_org, v_refund, v_user, false)->>'attempt_count')::integer = 2,
    'consultar estado contó como un nuevo envío de dinero';

  PERFORM public.pos_mp_refund_observe(
    v_refund,
    'processed',
    'REF-ZZ-CONFIRMED',
    NULL,
    jsonb_build_object(
      'source', 'zz_fixture',
      'id', 'REF-ZZ-CONFIRMED',
      'status', 'processed',
      'amount', 5000
    )
  );
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'service_role')::text,
    true
  );
  v_completed := public.sales_return_refund_complete(
    v_refund,
    'REF-ZZ-CONFIRMED',
    jsonb_build_object('source', 'zz_fixture', 'status', 'processed')
  );
  ASSERT v_completed->>'status' = 'completed'
     AND v_completed->>'return_status' = 'completed',
    'la confirmación positiva no cerró reintegro y devolución';
  ASSERT (public.sales_return_refund_complete(
    v_refund, 'REF-ZZ-CONFIRMED', NULL
  )->>'reused')::boolean,
    'la confirmación positiva no es idempotente';

  SELECT round(COALESCE(sum(line.haber - line.debe), 0), 2)
    INTO v_liability
  FROM public.ledger_lines line
  JOIN public.ledger_accounts account ON account.id = line.account_id
  JOIN public.ledger_entries entry ON entry.id = line.entry_id
  WHERE entry.org_id = v_org
    AND account.codigo = '2.1.04'
    AND entry.referencia_tipo IN ('devolucion_pos', 'reintegro_pos');
  ASSERT v_liability = 0,
    'la confirmación de Mercado Pago no canceló el pasivo al cliente';
  ASSERT NOT has_function_privilege(
      'authenticated',
      'public.pos_mp_refund_prepare(uuid,uuid,uuid,boolean)',
      'EXECUTE'
    ) AND NOT has_function_privilege(
      'authenticated',
      'public.pos_mp_refund_observe(uuid,text,text,text,jsonb)',
      'EXECUTE'
    ),
    'el navegador puede fabricar preparación o evidencia de proveedor';

  INSERT INTO zz_pos_mp_refund_proof VALUES
    ('api_mode', v_prepared->>'api_mode'),
    ('attempts', v_attempts::text),
    ('idempotency_stable', (v_retry->>'client_key' = v_key)::text),
    ('liability_after_confirmation', v_liability::text),
    ('pending_after_provider_error', v_pending::text),
    ('provider_refund_id', 'REF-ZZ-CONFIRMED'),
    ('return_status', v_completed->>'return_status'),
    ('status_after_provider_error', v_status);

  DELETE FROM public.organizations WHERE id = v_org;
  SELECT
    (SELECT count(*) FROM public.organizations WHERE id = v_org)
    + (SELECT count(*) FROM public.sales_return_transactions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.sales_return_refunds WHERE org_id = v_org)
    + (SELECT count(*) FROM public.returns WHERE org_id = v_org)
    + (SELECT count(*) FROM public.products WHERE org_id = v_org)
    + (SELECT count(*) FROM public.sales WHERE org_id = v_org)
    + (SELECT count(*) FROM public.sale_transactions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_transactions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.stock_movements WHERE org_id = v_org)
    + (SELECT count(*) FROM public.ledger_accounts WHERE org_id = v_org)
    + (SELECT count(*) FROM public.ledger_entries WHERE org_id = v_org)
    + (SELECT count(*) FROM public.ledger_lines WHERE org_id = v_org)
  INTO v_restos;
  ASSERT v_restos = 0, 'quedaron ' || v_restos || ' restos ZZ';
  INSERT INTO zz_pos_mp_refund_proof VALUES ('restos', v_restos::text);
END
$proof$;

SELECT check_name, value
FROM zz_pos_mp_refund_proof
ORDER BY check_name;

ROLLBACK;
