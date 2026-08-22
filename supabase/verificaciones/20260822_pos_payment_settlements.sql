-- Verificacion destructiva-cero de F2 / liquidaciones POS.
--
-- Ejecutar con:
--   npx supabase db query --linked --file supabase/verificaciones/20260822_pos_payment_settlements.sql

DO $verification$
DECLARE
  v_org uuid;
  v_owner uuid;
  v_outsider uuid;
  v_product uuid := gen_random_uuid();
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_result jsonb;
  v_transaction uuid;
  v_credit_payment uuid;
  v_sale_entry uuid;
  v_settlement_entry uuid;
  v_count bigint;
  v_debe numeric;
  v_haber numeric;
  v_fee numeric;
  v_tax numeric;
  v_margin numeric;
  v_total numeric;
  v_reference_price numeric;
  v_override boolean;
BEGIN
  SELECT membership.org_id, membership.user_id
  INTO v_org, v_owner
  FROM public.memberships membership
  WHERE membership.role = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.products product
      WHERE product.org_id = membership.org_id
    )
  ORDER BY membership.created_at
  LIMIT 1;

  SELECT user_row.id INTO v_outsider
  FROM auth.users user_row
  WHERE NOT public.is_org_member(v_org, user_row.id)
    AND NOT public.is_platform_admin(user_row.id)
  ORDER BY user_row.created_at
  LIMIT 1;

  IF v_org IS NULL OR v_owner IS NULL OR v_outsider IS NULL THEN
    RAISE EXCEPTION 'POS settlement verification requires an owner and outsider';
  END IF;

  BEGIN
    CREATE TEMP TABLE zz_pos_settlement_product ON COMMIT DROP AS
      SELECT * FROM public.products WHERE org_id = v_org LIMIT 1;
    UPDATE zz_pos_settlement_product
    SET id = v_product,
        name = 'ZZ Liquidacion POS ' || v_suffix,
        stock = 1000,
        sale_price_ars = 3000,
        discount_price_ars = NULL,
        total_cost_usd = 1,
        tiendanube_id = NULL;
    INSERT INTO public.products SELECT * FROM zz_pos_settlement_product;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
      true
    );

    -- El precio vigente es 3000 y el cajero termina cobrando 2700. v2 debe
    -- guardar el override y no volver a inflar el total al precio anterior al
    -- descuento. El split coincide exactamente con ese bruto final.
    v_result := public.create_sales_transaction_v3(
      v_org,
      jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(),
        'user_id', v_owner,
        'org_id', v_org,
        'product_id', v_product,
        'product_name', 'ZZ Liquidacion POS ' || v_suffix,
        'quantity', 1,
        'unit_price_ars', 2700,
        'total_ars', 2700,
        'global_discount_ars', 300,
        'paid', true,
        'payment_method', 'credito',
        'split_payments', jsonb_build_array(
          jsonb_build_object('method', 'efectivo', 'amount', 1200),
          jsonb_build_object('method', 'credito', 'amount', 1500)
        ),
        'date', now(),
        'source', 'pos'
      )),
      'pos'
    );
    v_transaction := (v_result->>'transaction_id')::uuid;

    SELECT sale.total_ars, sale.precio_autoritativo, sale.override_de_precio
    INTO v_total, v_reference_price, v_override
    FROM public.sales sale
    WHERE sale.sale_transaction_id = v_transaction;
    IF v_total <> 2700 OR NOT v_override OR v_reference_price IS NULL THEN
      RAISE EXCEPTION 'discounted total or price baseline was lost: total %, reference %, override %',
        v_total, v_reference_price, v_override;
    END IF;

    IF (v_result#>>'{payment_evidence,parts}')::int <> 2
       OR (v_result#>>'{payment_evidence,pending}')::int <> 1 THEN
      RAISE EXCEPTION 'POS split evidence is incomplete: %', v_result->'payment_evidence';
    END IF;

    -- Reintentar la captura no duplica partes.
    PERFORM public.capture_pos_payment_transactions(v_org, v_transaction);
    SELECT count(*) INTO v_count
    FROM public.payment_transactions payment
    WHERE payment.org_id = v_org
      AND payment.source = 'pos'
      AND payment.source_id = v_transaction;
    IF v_count <> 2 THEN
      RAISE EXCEPTION 'POS payment capture produced % parts instead of 2', v_count;
    END IF;

    SELECT payment.id INTO v_credit_payment
    FROM public.payment_transactions payment
    WHERE payment.source = 'pos'
      AND payment.source_id = v_transaction
      AND payment.method = 'credit';

    IF v_credit_payment IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.payment_transactions payment
         WHERE payment.source_id = v_transaction
           AND payment.method = 'cash'
           AND payment.status = 'approved'
           AND payment.provider_fee = 0
           AND payment.net_amount = 1200
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.payment_transactions payment
         WHERE payment.id = v_credit_payment
           AND payment.status = 'pending'
           AND payment.gross_amount = 1500
       ) THEN
      RAISE EXCEPTION 'cash exact-zero or card pending evidence is wrong';
    END IF;

    v_sale_entry := public.ledger_asentar_venta_pos(
      jsonb_build_object(
        'org_id', v_org,
        'data', jsonb_build_object('transaction_id', v_transaction)
      )
    );
    IF v_sale_entry IS NULL THEN
      RAISE EXCEPTION 'POS sale did not produce its ledger entry';
    END IF;

    -- Aunque efectivo ya este aprobado, la tarjeta pendiente manda sobre el
    -- ticket completo: no se puede mostrar comision cero ni margen final.
    IF NOT EXISTS (
      SELECT 1 FROM public.sale_margin_operations operation
      WHERE operation.operation_id = v_transaction
        AND operation.payment_fee_ars IS NULL
        AND operation.quality_status = 'settlement_pending'
        AND operation.margin_blockers @> ARRAY['liquidacion_cobro']::text[]
        AND NOT operation.is_explainable
    ) THEN
      RAISE EXCEPTION 'pending card was hidden by the approved cash part';
    END IF;

    v_result := public.confirm_pos_payment_settlement(
      v_credit_payment,
      'mercadopago',
      100,
      21,
      'ZZ-POS-SETTLEMENT-' || v_suffix,
      now()
    );
    v_settlement_entry := (v_result->>'ledger_entry_id')::uuid;

    SELECT round(sum(payment.provider_fee + payment.provider_fee_iva + payment.platform_fee), 2)
    INTO v_fee
    FROM public.payment_transactions payment
    WHERE payment.source = 'pos' AND payment.source_id = v_transaction;

    SELECT operation.tax_ars, operation.contribution_margin_ars
    INTO v_tax, v_margin
    FROM public.sale_margin_operations operation
    WHERE operation.operation_id = v_transaction;

    IF v_fee <> 121
       OR v_margin <> round(2700 - (
         SELECT sale.cost_of_goods_ars FROM public.sales sale
         WHERE sale.sale_transaction_id = v_transaction
       ) - v_fee - v_tax, 2)
       OR NOT EXISTS (
         SELECT 1 FROM public.sale_margin_operations operation
         WHERE operation.operation_id = v_transaction
           AND operation.payment_fee_ars = v_fee
           AND operation.coverage_pct = 100
           AND operation.is_explainable
           AND cardinality(operation.margin_blockers) = 0
       ) THEN
      RAISE EXCEPTION 'confirmed settlement did not complete canonical margin: fee %, tax %, margin %',
        v_fee, v_tax, v_margin;
    END IF;

    SELECT round(sum(line.debe), 2), round(sum(line.haber), 2)
    INTO v_debe, v_haber
    FROM public.ledger_lines line
    WHERE line.entry_id = v_settlement_entry;
    IF v_debe <> 1500 OR v_haber <> 1500
       OR NOT EXISTS (
         SELECT 1
         FROM public.ledger_lines line
         JOIN public.ledger_accounts account ON account.id = line.account_id
         WHERE line.entry_id = v_settlement_entry
           AND account.codigo = '5.2.01'
           AND line.debe = 121
       ) THEN
      RAISE EXCEPTION 'settlement ledger does not balance: debit %, credit %', v_debe, v_haber;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.audit_logs audit
      WHERE audit.org_id = v_org
        AND audit.entity_type = 'payment_settlement'
        AND audit.entity_id = v_credit_payment::text
    ) THEN
      RAISE EXCEPTION 'settlement confirmation was not audited';
    END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text,
      true
    );
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_count
    FROM public.sale_margin_operations operation
    WHERE operation.operation_id = v_transaction;
    v_count := v_count + (
      SELECT count(*) FROM public.payment_transactions payment
      WHERE payment.source_id = v_transaction
    );
    EXECUTE 'RESET ROLE';
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'outsider read % settlement or margin rows', v_count;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT count(*) INTO v_count
  FROM public.products product
  WHERE product.name LIKE 'ZZ Liquidacion POS%';
  v_count := v_count + (
    SELECT count(*) FROM public.sales sale
    WHERE sale.product_name LIKE 'ZZ Liquidacion POS%'
  ) + (
    SELECT count(*) FROM public.payment_transactions payment
    WHERE payment.external_id LIKE 'ZZ-POS-SETTLEMENT-%'
  ) + (
    SELECT count(*) FROM public.audit_logs audit
    WHERE audit.entity_type = 'payment_settlement'
      AND audit.details->>'provider' = 'mercadopago'
      AND audit.created_at > now() - interval '5 minutes'
      AND audit.entity_id = v_credit_payment::text
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'POS settlement verification left % ZZ rows', v_count;
  END IF;

  RAISE NOTICE 'POS settlement verification passed: discounted gross persisted, split pending blocker, actual fee, balanced ledger, audit, outsider blocked, leftovers=0';
END
$verification$;
