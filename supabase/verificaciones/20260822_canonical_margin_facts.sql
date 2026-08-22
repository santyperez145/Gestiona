-- Verificación destructiva-cero de F2 / hechos canónicos de margen.
--
-- Ejecutar con:
--   npx supabase db query --linked --file supabase/verificaciones/20260822_canonical_margin_facts.sql

DO $verification$
DECLARE
  v_org uuid;
  v_owner uuid;
  v_staff uuid;
  v_outsider uuid;
  v_product uuid := gen_random_uuid();
  v_tx uuid := gen_random_uuid();
  v_legacy_tx uuid := gen_random_uuid();
  v_sale_a uuid := gen_random_uuid();
  v_sale_b uuid := gen_random_uuid();
  v_legacy_sale uuid := gen_random_uuid();
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_entry uuid;
  v_count bigint;
  v_platform_before bigint;
  v_platform_after bigint;
  v_fee numeric;
  v_tax numeric;
  v_margin numeric;
  v_expected_margin numeric;
BEGIN
  SELECT membership.org_id, membership.user_id
  INTO v_org, v_owner
  FROM public.memberships membership
  WHERE membership.role = 'owner'
    AND EXISTS (SELECT 1 FROM public.products product WHERE product.org_id = membership.org_id)
  ORDER BY membership.created_at
  LIMIT 1;

  SELECT admin.user_id INTO v_staff
  FROM public.platform_admins admin
  ORDER BY (admin.role = 'superadmin') DESC, admin.granted_at
  LIMIT 1;

  SELECT user_row.id INTO v_outsider
  FROM auth.users user_row
  WHERE NOT public.is_org_member(v_org, user_row.id)
    AND NOT public.is_platform_admin(user_row.id)
  ORDER BY user_row.created_at
  LIMIT 1;

  IF v_org IS NULL OR v_owner IS NULL OR v_staff IS NULL OR v_outsider IS NULL THEN
    RAISE EXCEPTION 'canonical margin verification requires an org owner, platform staff and outsider';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_staff, 'role', 'authenticated')::text,
    true
  );
  SELECT sales_lines INTO v_platform_before
  FROM public.platform_org_margin_coverage
  WHERE org_id = v_org;

  BEGIN
    -- Clona la forma actual de products para no depender de defaults viejos.
    -- Todo vive en una subtransacción que se revierte al terminar.
    CREATE TEMP TABLE zz_margin_product ON COMMIT DROP AS
      SELECT * FROM public.products WHERE org_id = v_org LIMIT 1;
    UPDATE zz_margin_product
    SET id = v_product,
        name = 'ZZ Margen canónico ' || v_suffix,
        stock = 1000,
        sale_price_ars = 2000,
        total_cost_usd = 1,
        tiendanube_id = NULL;
    INSERT INTO public.products SELECT * FROM zz_margin_product;

    INSERT INTO public.sale_transactions (id, org_id, source, created_by, occurred_at)
    VALUES (v_tx, v_org, 'pos', v_owner, now());
    PERFORM set_config('gestiona.sale_transaction_id', v_tx::text, true);
    INSERT INTO public.sales (
      id, org_id, user_id, product_id, product_name, quantity,
      unit_price_ars, total_ars, cost_of_goods_ars, payment_method,
      paid, source, sale_transaction_id, date
    ) VALUES
      (v_sale_a, v_org, v_owner, v_product, 'ZZ Margen canónico A', 1,
       1000, 1000, 300, 'credito', true, 'pos', v_tx, now()),
      (v_sale_b, v_org, v_owner, v_product, 'ZZ Margen canónico B', 1,
       2000, 2000, 600, 'credito', true, 'pos', v_tx, now());

    INSERT INTO public.payment_transactions (
      org_id, source, source_id, provider, method, gross_amount,
      provider_fee, provider_fee_iva, platform_fee, net_amount,
      status, external_id
    ) VALUES (
      v_org, 'pos', v_tx, 'mercadopago', 'credit', 3000,
      150, 31.50, 0, 2818.50, 'approved', 'ZZ-MARGIN-' || v_suffix
    );

    v_entry := public.ledger_asentar_venta_pos(
      jsonb_build_object(
        'org_id', v_org,
        'data', jsonb_build_object('transaction_id', v_tx)
      )
    );
    IF v_entry IS NULL THEN
      RAISE EXCEPTION 'POS verification did not produce a ledger entry';
    END IF;

    -- Una venta histórica sin costo no puede heredar el costo actual del
    -- producto ni quedar fuera de la vista.
    INSERT INTO public.sale_transactions (id, org_id, source, created_by, occurred_at)
    VALUES (v_legacy_tx, v_org, 'manual', v_owner, now());
    PERFORM set_config('gestiona.sale_transaction_id', v_legacy_tx::text, true);
    INSERT INTO public.sales (
      id, org_id, user_id, product_id, product_name, quantity,
      unit_price_ars, total_ars, cost_of_goods_ars, payment_method,
      paid, source, sale_transaction_id, date
    ) VALUES (
      v_legacy_sale, v_org, v_owner, v_product, 'ZZ Margen histórico', 1,
      500, 500, 0, 'efectivo', true, 'manual', v_legacy_tx, now()
    );

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
      true
    );

    SELECT count(*), sum(payment_fee_ars), sum(tax_ars), sum(contribution_margin_ars)
    INTO v_count, v_fee, v_tax, v_margin
    FROM public.sale_margin_facts
    WHERE sale_id IN (v_sale_a, v_sale_b);

    v_expected_margin := round(3000 - 900 - 181.50 - v_tax, 2);
    IF v_count <> 2 OR v_fee <> 181.50 OR v_margin <> v_expected_margin THEN
      RAISE EXCEPTION 'complete POS facts do not reconcile: lines %, fee %, tax %, margin % expected %',
        v_count, v_fee, v_tax, v_margin, v_expected_margin;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.sale_margin_facts
      WHERE sale_id IN (v_sale_a, v_sale_b)
        AND (
          NOT is_explainable
          OR coverage_pct <> 100
          OR cogs_source <> 'sale_snapshot'
          OR payment_fee_source <> 'payment_transaction_allocation'
          OR shipping_cost_source <> 'pos_not_applicable'
          OR tax_source <> 'ledger_operation_allocation'
        )
    ) THEN
      RAISE EXCEPTION 'complete POS facts lost provenance or four-component coverage';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.sale_margin_facts
      WHERE sale_id = v_legacy_sale
        AND channel = 'sin_atribuir'
        AND cogs_ars IS NULL
        AND contribution_margin_ars IS NULL
        AND coverage_pct = 25
        AND missing_components @> ARRAY['costo_mercaderia', 'costo_envio_real', 'iva']::text[]
        AND payment_fee_source = 'cash_not_applicable'
    ) THEN
      RAISE EXCEPTION 'historical zero-cost sale was hidden or presented as measured';
    END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text,
      true
    );
    SELECT count(*) INTO v_count
    FROM public.sale_margin_facts
    WHERE sale_id IN (v_sale_a, v_sale_b, v_legacy_sale);
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'outsider read % tenant margin facts', v_count;
    END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_staff, 'role', 'authenticated')::text,
      true
    );
    SELECT sales_lines INTO v_platform_after
    FROM public.platform_org_margin_coverage
    WHERE org_id = v_org;
    IF v_platform_after <> v_platform_before + 3 THEN
      RAISE EXCEPTION 'platform aggregate did not include the three test lines: before %, after %',
        v_platform_before, v_platform_after;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT count(*) INTO v_count
  FROM public.sales
  WHERE product_name LIKE 'ZZ Margen%';
  v_count := v_count + (
    SELECT count(*) FROM public.products WHERE name LIKE 'ZZ Margen canónico%'
  ) + (
    SELECT count(*) FROM public.payment_transactions WHERE external_id LIKE 'ZZ-MARGIN-%'
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'canonical margin verification left % ZZ rows', v_count;
  END IF;

  RAISE NOTICE 'canonical margin verification passed: all sales visible, 4 sources reconciled, outsider blocked, platform aggregate sanitized, leftovers=0';
END
$verification$;
