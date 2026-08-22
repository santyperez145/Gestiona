-- Verificación destructiva-cero de F2 / explicación por operación.
--
-- Ejecutar con:
--   npx supabase db query --linked --file supabase/verificaciones/20260822_margin_operation_explanations.sql

DO $verification$
DECLARE
  v_org uuid;
  v_owner uuid;
  v_outsider uuid;
  v_product uuid := gen_random_uuid();
  v_tx uuid := gen_random_uuid();
  v_return_tx uuid := gen_random_uuid();
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_entry uuid;
  v_count bigint;
  v_tax numeric;
  v_margin numeric;
BEGIN
  SELECT membership.org_id, membership.user_id
  INTO v_org, v_owner
  FROM public.memberships membership
  WHERE membership.role = 'owner'
    AND EXISTS (SELECT 1 FROM public.products product WHERE product.org_id = membership.org_id)
  ORDER BY membership.created_at
  LIMIT 1;

  SELECT user_row.id INTO v_outsider
  FROM auth.users user_row
  WHERE NOT public.is_org_member(v_org, user_row.id)
    AND NOT public.is_platform_admin(user_row.id)
  ORDER BY user_row.created_at
  LIMIT 1;

  IF v_org IS NULL OR v_owner IS NULL OR v_outsider IS NULL THEN
    RAISE EXCEPTION 'operation margin verification requires an org owner and outsider';
  END IF;

  BEGIN
    CREATE TEMP TABLE zz_margin_operation_product ON COMMIT DROP AS
      SELECT * FROM public.products WHERE org_id = v_org LIMIT 1;
    UPDATE zz_margin_operation_product
    SET id = v_product,
        name = 'ZZ Margen operación ' || v_suffix,
        stock = 1000,
        sale_price_ars = 2000,
        total_cost_usd = 1,
        tiendanube_id = NULL;
    INSERT INTO public.products SELECT * FROM zz_margin_operation_product;

    INSERT INTO public.sale_transactions (id, org_id, source, created_by, occurred_at)
    VALUES (v_tx, v_org, 'pos', v_owner, now());
    PERFORM set_config('gestiona.sale_transaction_id', v_tx::text, true);
    INSERT INTO public.sales (
      id, org_id, user_id, product_id, product_name, quantity,
      unit_price_ars, total_ars, cost_of_goods_ars, payment_method,
      split_payments, global_discount_ars, discount_applied,
      paid, source, sale_transaction_id, date
    ) VALUES
      (gen_random_uuid(), v_org, v_owner, v_product, 'ZZ Operación A', 1,
       1000, 900, 300, 'credito',
       '[{"method":"efectivo","amount":400},{"method":"credito","amount":500}]'::jsonb,
       100, false, true, 'pos', v_tx, now()),
      (gen_random_uuid(), v_org, v_owner, v_product, 'ZZ Operación B', 1,
       2000, 1800, 600, 'credito',
       '[{"method":"efectivo","amount":800},{"method":"credito","amount":1000}]'::jsonb,
       200, false, true, 'pos', v_tx, now());

    INSERT INTO public.payment_transactions (
      org_id, source, source_id, provider, method, gross_amount,
      provider_fee, provider_fee_iva, platform_fee, net_amount,
      status, external_id
    ) VALUES (
      v_org, 'pos', v_tx, 'mercadopago', 'credit', 2700,
      100, 21, 0, 2579, 'approved', 'ZZ-MARGIN-OP-' || v_suffix
    );

    v_entry := public.ledger_asentar_venta_pos(
      jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('transaction_id', v_tx))
    );
    IF v_entry IS NULL THEN RAISE EXCEPTION 'split POS did not produce a ledger entry'; END IF;

    INSERT INTO public.sale_transactions (id, org_id, source, created_by, occurred_at)
    VALUES (v_return_tx, v_org, 'pos', v_owner, now());
    PERFORM set_config('gestiona.sale_transaction_id', v_return_tx::text, true);
    INSERT INTO public.sales (
      id, org_id, user_id, product_id, product_name, quantity,
      unit_price_ars, total_ars, cost_of_goods_ars, payment_method,
      coupon_code, discount_applied, returned, returned_quantity,
      paid, source, sale_transaction_id, date
    ) VALUES (
      gen_random_uuid(), v_org, v_owner, v_product, 'ZZ Operación devuelta', 1,
      500, 500, 100, 'efectivo', 'ZZ10', true, true, 1,
      true, 'pos', v_return_tx, now()
    );
    v_entry := public.ledger_asentar_venta_pos(
      jsonb_build_object('org_id', v_org, 'data', jsonb_build_object('transaction_id', v_return_tx))
    );
    IF v_entry IS NULL THEN RAISE EXCEPTION 'return test did not produce a ledger entry'; END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
      true
    );

    SELECT tax_ars, contribution_margin_ars
    INTO v_tax, v_margin
    FROM public.sale_margin_operations
    WHERE operation_id = v_tx;
    IF v_margin <> round(2700 - 900 - 121 - v_tax, 2) THEN
      RAISE EXCEPTION 'operation contribution does not reconcile: margin %, tax %', v_margin, v_tax;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.sale_margin_operations operation
      WHERE operation.operation_id = v_tx
        AND operation.line_count = 2
        AND operation.units = 2
        AND operation.revenue_ars = 2700
        AND operation.cogs_ars = 900
        AND operation.payment_fee_ars = 121
        AND operation.payment_mix @> '[{"method":"credito","amount_ars":1500},{"method":"efectivo","amount_ars":1200}]'::jsonb
        AND operation.payment_mix_difference_ars = 0
        AND operation.measured_discount_ars = 300
        AND operation.promotion_evidence_status = 'measured'
        AND operation.is_explainable
        AND operation.coverage_pct = 100
    ) THEN
      RAISE EXCEPTION 'split payment or measured promotion explanation is incomplete';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.sale_margin_operations operation
      WHERE operation.operation_id = v_return_tx
        AND operation.contribution_margin_ars IS NULL
        AND NOT operation.is_explainable
        AND operation.quality_status = 'return_pending'
        AND operation.margin_blockers @> ARRAY['devolucion_neta']::text[]
        AND operation.promotion_evidence_status = 'partial'
        AND operation.promotion_missing_evidence @> ARRAY[
          'importe_descuento_cupon', 'precio_referencia_historico'
        ]::text[]
    ) THEN
      RAISE EXCEPTION 'return or incomplete promotion was presented as final margin';
    END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text,
      true
    );
    SELECT count(*) INTO v_count
    FROM public.sale_margin_operations
    WHERE operation_id IN (v_tx, v_return_tx);
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'outsider read % operation margin rows', v_count;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT count(*) INTO v_count
  FROM public.sales WHERE product_name LIKE 'ZZ Operación%';
  v_count := v_count
    + (SELECT count(*) FROM public.products WHERE name LIKE 'ZZ Margen operación%')
    + (SELECT count(*) FROM public.payment_transactions WHERE external_id LIKE 'ZZ-MARGIN-OP-%');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'operation margin verification left % ZZ rows', v_count;
  END IF;

  RAISE NOTICE 'operation margin verification passed: ticket sums exactly, split mix exact, promotion evidence honest, return blocks margin, outsider blocked, leftovers=0';
END
$verification$;
