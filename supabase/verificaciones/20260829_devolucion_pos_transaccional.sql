-- Prueba reversible de la devolución POS autoritativa.
-- Crea un tenant y una venta ZZ con cobro partido, devuelve una unidad,
-- completa el reintegro externo y elimina todo antes de hacer ROLLBACK.
BEGIN;

CREATE TEMP TABLE zz_sales_return_proof (
  check_name text,
  value text
) ON COMMIT DROP;

DO $proof$
DECLARE
  v_org uuid := gen_random_uuid();
  v_location uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_sale uuid := gen_random_uuid();
  v_ticket uuid := gen_random_uuid();
  v_client_return uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_user uuid;
  v_open jsonb;
  v_created jsonb;
  v_retry jsonb;
  v_completed jsonb;
  v_transaction uuid;
  v_return_transaction uuid;
  v_cash_payment uuid;
  v_transfer_payment uuid;
  v_transfer_refund uuid;
  v_stock numeric;
  v_expected numeric;
  v_return_lines integer;
  v_refunds integer;
  v_cash_entries integer;
  v_ledger_entries integer;
  v_unbalanced integer;
  v_pending_liability numeric;
  v_outsider_blocked boolean := false;
  v_changed_retry_blocked boolean := false;
  v_overreturn_blocked boolean := false;
  v_restos integer;
BEGIN
  SELECT membership.user_id INTO v_user
  FROM public.memberships membership
  WHERE membership.role = 'owner'
  ORDER BY membership.created_at
  LIMIT 1;
  ASSERT v_user IS NOT NULL, 'No hay un owner para la fixture ZZ';

  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (
    v_org,
    'ZZ devolución POS',
    'zz-sales-return-' || substr(v_org::text, 1, 8),
    v_user
  );
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org, v_user, 'owner');
  INSERT INTO public.locations (id, org_id, name, is_main, active)
  VALUES (v_location, v_org, 'ZZ Mostrador', true, true);
  UPDATE public.settings
  SET exchange_rate = 1000,
      discount_cash_percent = 0,
      discount_transfer_percent = 0
  WHERE org_id = v_org;
  INSERT INTO public.products (
    id, org_id, user_id, name, sale_price_ars,
    cost_usd, total_cost_usd, stock
  ) VALUES (
    v_product, v_org, v_user, 'ZZ Producto devolución', 5000,
    1, 1, 10
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
    true
  );
  v_open := public.pos_cash_session_open(v_org, v_location, 10000, 'ZZ apertura');
  ASSERT (v_open->>'session_id')::uuid IS NOT NULL,
    'no se pudo abrir la caja ZZ';

  v_created := public.create_sales_transaction_v3(
    v_org,
    jsonb_build_array(jsonb_build_object(
      'id', v_sale,
      'user_id', v_user,
      'org_id', v_org,
      'product_id', v_product,
      'product_name', 'ZZ Producto devolución',
      'quantity', 2,
      'unit_price_ars', 5000,
      'total_ars', 10000,
      'cost_of_goods_ars', 2000,
      'paid', true,
      'payment_method', 'transferencia',
      'split_payments', jsonb_build_array(
        jsonb_build_object('method', 'efectivo', 'amount', 5000),
        jsonb_build_object('method', 'transferencia', 'amount', 5000)
      ),
      'location_id', v_location,
      'seller_name', 'ZZ Cajero',
      'offline_transaction_id', v_ticket,
      'offline_origin', false,
      'date', now(),
      'source', 'pos'
    )),
    'pos'
  );
  v_transaction := (v_created->>'transaction_id')::uuid;

  SELECT payment.id INTO v_cash_payment
  FROM public.payment_transactions payment
  WHERE payment.org_id = v_org
    AND payment.source_id = v_transaction
    AND payment.method = 'cash';
  SELECT payment.id INTO v_transfer_payment
  FROM public.payment_transactions payment
  WHERE payment.org_id = v_org
    AND payment.source_id = v_transaction
    AND payment.method = 'transfer';
  ASSERT v_cash_payment IS NOT NULL AND v_transfer_payment IS NOT NULL,
    'el ticket no conservó las dos partes del cobro original';

  SELECT product.stock INTO v_stock
  FROM public.products product WHERE product.id = v_product;
  ASSERT v_stock = 8, 'la venta no dejó el stock en 8';

  v_created := public.create_sales_return_v1(
    v_org,
    v_sale,
    jsonb_build_array(jsonb_build_object('sale_id', v_sale, 'quantity', 1)),
    jsonb_build_array(
      jsonb_build_object(
        'payment_transaction_id', v_cash_payment,
        'amount', 2500
      ),
      jsonb_build_object(
        'payment_transaction_id', v_transfer_payment,
        'amount', 2500
      )
    ),
    'ZZ producto sin uso',
    'ZZ prueba reversible',
    true,
    v_client_return
  );
  v_return_transaction := (v_created->>'return_transaction_id')::uuid;
  ASSERT v_return_transaction IS NOT NULL
     AND v_created->>'status' = 'pending_refund'
     AND NOT (v_created->>'reused')::boolean,
    'la devolución inicial no quedó pendiente del reintegro externo';

  SELECT count(*) INTO v_return_lines
  FROM public.returns line
  WHERE line.return_transaction_id = v_return_transaction;
  SELECT count(*) INTO v_refunds
  FROM public.sales_return_refunds refund
  WHERE refund.return_transaction_id = v_return_transaction;
  SELECT count(*) INTO v_cash_entries
  FROM public.cash_entries entry
  WHERE entry.return_transaction_id = v_return_transaction;
  SELECT product.stock INTO v_stock
  FROM public.products product WHERE product.id = v_product;
  SELECT public.cash_session_expected_cash((v_open->>'session_id')::uuid)
    INTO v_expected;

  ASSERT v_return_lines = 1 AND v_refunds = 2,
    'la devolución no agrupó una línea y dos reintegros';
  ASSERT v_cash_entries = 1,
    'antes de la confirmación externa debía existir sólo el egreso efectivo';
  ASSERT v_stock = 9, 'la reposición no dejó el stock en 9';
  ASSERT v_expected = 12500,
    'caja esperada debía ser apertura 10000 + efectivo 5000 - reintegro 2500';
  ASSERT EXISTS (
    SELECT 1 FROM public.sales sale
    WHERE sale.id = v_sale
      AND sale.returned_quantity = 1
      AND NOT sale.returned
  ), 'la venta parcial quedó marcada como totalmente devuelta';

  -- El retry debe resolverse antes de volver a validar saldos mutables.
  v_retry := public.create_sales_return_v1(
    v_org,
    v_sale,
    jsonb_build_array(jsonb_build_object('sale_id', v_sale, 'quantity', 1)),
    jsonb_build_array(
      jsonb_build_object('payment_transaction_id', v_cash_payment, 'amount', 2500),
      jsonb_build_object('payment_transaction_id', v_transfer_payment, 'amount', 2500)
    ),
    'ZZ producto sin uso',
    'ZZ prueba reversible',
    true,
    v_client_return
  );
  ASSERT (v_retry->>'return_transaction_id')::uuid = v_return_transaction
     AND (v_retry->>'reused')::boolean,
    'el retry idéntico no reutilizó la operación';
  ASSERT (SELECT count(*) FROM public.returns line
          WHERE line.return_transaction_id = v_return_transaction) = 1,
    'el retry duplicó la línea de devolución';
  ASSERT (SELECT product.stock FROM public.products product
          WHERE product.id = v_product) = 9,
    'el retry volvió a mover stock';

  BEGIN
    PERFORM public.create_sales_return_v1(
      v_org, v_sale,
      jsonb_build_array(jsonb_build_object('sale_id', v_sale, 'quantity', 1)),
      jsonb_build_array(
        jsonb_build_object('payment_transaction_id', v_cash_payment, 'amount', 2500),
        jsonb_build_object('payment_transaction_id', v_transfer_payment, 'amount', 2500)
      ),
      'ZZ motivo alterado', NULL, true, v_client_return
    );
  EXCEPTION WHEN unique_violation THEN
    v_changed_retry_blocked := true;
  END;
  ASSERT v_changed_retry_blocked,
    'una misma clave idempotente aceptó contenido diferente';

  BEGIN
    PERFORM public.create_sales_return_v1(
      v_org, v_sale,
      jsonb_build_array(jsonb_build_object('sale_id', v_sale, 'quantity', 2)),
      jsonb_build_array(
        jsonb_build_object('payment_transaction_id', v_cash_payment, 'amount', 2500),
        jsonb_build_object('payment_transaction_id', v_transfer_payment, 'amount', 2500)
      ),
      'ZZ exceso', NULL, true, gen_random_uuid()
    );
  EXCEPTION WHEN OTHERS THEN
    v_overreturn_blocked := position('quedan 1' IN SQLERRM) > 0;
  END;
  ASSERT v_overreturn_blocked, 'se permitió devolver más unidades que las disponibles';

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text,
    true
  );
  BEGIN
    PERFORM public.preview_sales_return(v_org, v_sale);
  EXCEPTION WHEN insufficient_privilege THEN
    v_outsider_blocked := true;
  END;
  ASSERT v_outsider_blocked, 'un usuario ajeno pudo previsualizar el ticket';
  ASSERT NOT has_table_privilege('authenticated', 'public.returns', 'INSERT')
     AND NOT has_table_privilege('authenticated', 'public.sales_return_transactions', 'INSERT')
     AND NOT has_table_privilege('authenticated', 'public.sales_return_refunds', 'UPDATE'),
    'authenticated conserva una mutación directa de devoluciones';

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
    true
  );
  SELECT refund.id INTO v_transfer_refund
  FROM public.sales_return_refunds refund
  WHERE refund.return_transaction_id = v_return_transaction
    AND refund.method = 'transfer';
  ASSERT v_transfer_refund IS NOT NULL,
    'no existe la parte de transferencia pendiente';

  v_completed := public.sales_return_refund_complete(
    v_transfer_refund,
    'ZZ-TRANSFER-REF',
    jsonb_build_object('proof', 'reversible')
  );
  ASSERT v_completed->>'return_status' = 'completed',
    'la evidencia externa no completó la devolución';
  ASSERT (public.sales_return_refund_complete(
    v_transfer_refund, 'ZZ-TRANSFER-REF', NULL
  )->>'reused')::boolean,
    'el retry de confirmación externa no fue idempotente';

  SELECT count(*) INTO v_cash_entries
  FROM public.cash_entries entry
  WHERE entry.return_transaction_id = v_return_transaction;
  SELECT public.cash_session_expected_cash((v_open->>'session_id')::uuid)
    INTO v_expected;
  ASSERT v_cash_entries = 2,
    'la caja operativa no recibió el egreso externo confirmado';
  ASSERT v_expected = 12500,
    'un reintegro por transferencia alteró el efectivo esperado';

  SELECT count(*) INTO v_ledger_entries
  FROM public.ledger_entries entry
  WHERE entry.org_id = v_org
    AND entry.referencia_tipo IN ('devolucion_pos', 'reintegro_pos');
  SELECT count(*) INTO v_unbalanced
  FROM (
    SELECT entry.id
    FROM public.ledger_entries entry
    JOIN public.ledger_lines line ON line.entry_id = entry.id
    WHERE entry.org_id = v_org
      AND entry.referencia_tipo IN ('devolucion_pos', 'reintegro_pos')
    GROUP BY entry.id
    HAVING round(sum(line.debe), 2) <> round(sum(line.haber), 2)
  ) imbalance;
  SELECT round(COALESCE(sum(line.haber - line.debe), 0), 2)
    INTO v_pending_liability
  FROM public.ledger_lines line
  JOIN public.ledger_accounts account ON account.id = line.account_id
  JOIN public.ledger_entries entry ON entry.id = line.entry_id
  WHERE entry.org_id = v_org
    AND account.codigo = '2.1.04'
    AND entry.referencia_tipo IN ('devolucion_pos', 'reintegro_pos');
  ASSERT v_ledger_entries = 2 AND v_unbalanced = 0,
    'la devolución y su pago no produjeron dos asientos balanceados';
  ASSERT v_pending_liability = 0,
    'la obligación de reintegro no se canceló con la evidencia externa';

  INSERT INTO zz_sales_return_proof VALUES
    ('return_status', v_completed->>'return_status'),
    ('retry_reused', v_retry->>'reused'),
    ('stock_after_return', v_stock::text),
    ('expected_cash', v_expected::text),
    ('return_lines', v_return_lines::text),
    ('refund_parts', v_refunds::text),
    ('ledger_entries', v_ledger_entries::text),
    ('unbalanced_entries', v_unbalanced::text),
    ('pending_liability', v_pending_liability::text),
    ('outsider_blocked', v_outsider_blocked::text),
    ('changed_retry_blocked', v_changed_retry_blocked::text),
    ('overreturn_blocked', v_overreturn_blocked::text);

  DELETE FROM public.organizations WHERE id = v_org;
  SELECT
    (SELECT count(*) FROM public.organizations WHERE id = v_org)
    + (SELECT count(*) FROM public.sales_return_transactions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.sales_return_refunds WHERE org_id = v_org)
    + (SELECT count(*) FROM public.returns WHERE org_id = v_org)
    + (SELECT count(*) FROM public.cash_sessions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.cash_entries WHERE org_id = v_org)
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
  INSERT INTO zz_sales_return_proof VALUES ('restos', v_restos::text);
END
$proof$;

SELECT check_name, value
FROM zz_sales_return_proof
ORDER BY check_name;

ROLLBACK;
