-- Verificacion destructiva-cero de F2 / propuesta -> accion -> resultado.
--
-- Ejecutar con:
--   npx supabase db query --linked --file supabase/verificaciones/20260822_price_change_impact_loop.sql

DO $verification$
DECLARE
  v_org uuid;
  v_owner uuid;
  v_outsider uuid;
  v_product uuid := gen_random_uuid();
  v_recommendation uuid;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_result jsonb;
  v_baseline_transaction uuid;
  v_observed_transaction uuid;
  v_count bigint;
  v_status text;
  v_discount numeric;
  v_baseline_revenue numeric;
  v_observed_revenue numeric;
  v_baseline_coverage numeric;
  v_observed_coverage numeric;
  v_contribution_delta numeric;
  v_conflict_blocked boolean := false;
  v_outsider_blocked boolean := false;
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
    RAISE EXCEPTION 'Price impact verification requires an owner and outsider';
  END IF;

  BEGIN
    CREATE TEMP TABLE zz_price_impact_product ON COMMIT DROP AS
      SELECT * FROM public.products WHERE org_id = v_org LIMIT 1;
    UPDATE zz_price_impact_product
    SET id = v_product,
        name = 'ZZ Impacto Precio ' || v_suffix,
        sku = 'ZZ-PRICE-' || left(v_suffix, 12),
        stock = 1000,
        sale_price_ars = 3000,
        discount_price_ars = NULL,
        offer_expires_at = NULL,
        total_cost_usd = 1,
        cost_usd = 1,
        profit_per_unit_ars = 2500,
        featured = false,
        tiendanube_id = NULL;
    INSERT INTO public.products SELECT * FROM zz_price_impact_product;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
      true
    );

    -- Una venta canonica dentro de la ventana previa congela la baseline.
    v_result := public.create_sales_transaction_v3(
      v_org,
      jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(),
        'user_id', v_owner,
        'org_id', v_org,
        'product_id', v_product,
        'product_name', 'ZZ Impacto Precio ' || v_suffix,
        'quantity', 1,
        'unit_price_ars', 3000,
        'paid', true,
        'payment_method', 'efectivo',
        'date', now() - interval '30 minutes',
        'source', 'pos'
      )),
      'pos'
    );
    v_baseline_transaction := (v_result->>'transaction_id')::uuid;
    PERFORM public.ledger_asentar_venta_pos(jsonb_build_object(
      'org_id', v_org,
      'data', jsonb_build_object('transaction_id', v_baseline_transaction)
    ));

    INSERT INTO public.ai_offer_recommendations (
      org_id, user_id, product_id, offer_type, reason,
      suggested_discount_percent, suggested_price_ars, duration_hours,
      resulting_margin_percent, probability, recommended_channel, payload
    ) VALUES (
      v_org, v_owner, v_product, 'flash', 'ZZ medir una decision de precio',
      10, 2700, 1, 99, 'alta', 'catalogo_destacado',
      jsonb_build_object('product_name', 'ZZ Impacto Precio ' || v_suffix)
    ) RETURNING id INTO v_recommendation;

    v_result := public.apply_ai_offer_recommendation(v_recommendation);
    IF v_result->>'ok' <> 'true' OR v_result->>'price_applied' <> 'true' THEN
      RAISE EXCEPTION 'Price proposal was not applied: %', v_result;
    END IF;

    SELECT recommendation.status, product.discount_price_ars
    INTO v_status, v_discount
    FROM public.ai_offer_recommendations recommendation
    JOIN public.products product ON product.id = recommendation.product_id
    WHERE recommendation.id = v_recommendation;
    IF v_status <> 'applied' OR v_discount <> 2700 THEN
      RAISE EXCEPTION 'Applied state or price is wrong: status %, price %', v_status, v_discount;
    END IF;

    SELECT event.baseline_revenue_ars, event.baseline_coverage_pct
    INTO v_baseline_revenue, v_baseline_coverage
    FROM public.price_change_impact_events event
    WHERE event.recommendation_id = v_recommendation
      AND event.event_type = 'applied';
    IF v_baseline_revenue <> 3000 OR v_baseline_coverage <> 100 THEN
      RAISE EXCEPTION 'Frozen baseline is wrong: revenue %, coverage %',
        v_baseline_revenue, v_baseline_coverage;
    END IF;

    -- La venta posterior usa el precio aplicado por el servidor y alimenta el
    -- mismo contrato canonico de margen; no se escribe ningun outcome a mano.
    v_result := public.create_sales_transaction_v3(
      v_org,
      jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(),
        'user_id', v_owner,
        'org_id', v_org,
        'product_id', v_product,
        'product_name', 'ZZ Impacto Precio ' || v_suffix,
        'quantity', 1,
        'unit_price_ars', 2700,
        'paid', true,
        'payment_method', 'efectivo',
        'date', clock_timestamp(),
        'source', 'pos'
      )),
      'pos'
    );
    v_observed_transaction := (v_result->>'transaction_id')::uuid;
    PERFORM public.ledger_asentar_venta_pos(jsonb_build_object(
      'org_id', v_org,
      'data', jsonb_build_object('transaction_id', v_observed_transaction)
    ));

    v_result := public.measure_price_change_outcome(v_recommendation);
    IF v_result->>'ok' <> 'true'
       OR v_result->>'interpretation' <> 'observed_not_causal'
       OR v_result->>'is_mature' <> 'false' THEN
      RAISE EXCEPTION 'Outcome semantics are wrong: %', v_result;
    END IF;

    SELECT outcome.observed_revenue_ars, outcome.observed_coverage_pct,
           outcome.contribution_per_day_delta_ars
    INTO v_observed_revenue, v_observed_coverage, v_contribution_delta
    FROM public.price_change_proposal_outcomes outcome
    WHERE outcome.recommendation_id = v_recommendation;
    IF v_observed_revenue <> 2700
       OR v_observed_coverage <> 100
       OR v_contribution_delta IS NULL THEN
      RAISE EXCEPTION 'Observed outcome is incomplete: revenue %, coverage %, contribution delta %',
        v_observed_revenue, v_observed_coverage, v_contribution_delta;
    END IF;

    -- Si alguien cambia el precio despues, revertir no lo pisa.
    UPDATE public.products SET discount_price_ars = 2600 WHERE id = v_product;
    BEGIN
      PERFORM public.revert_price_change_proposal(v_recommendation, 'ZZ conflict');
    EXCEPTION WHEN SQLSTATE '40001' THEN
      v_conflict_blocked := true;
    END;
    SELECT discount_price_ars INTO v_discount FROM public.products WHERE id = v_product;
    IF NOT v_conflict_blocked OR v_discount <> 2600 THEN
      RAISE EXCEPTION 'Concurrent price guard failed: blocked %, price %',
        v_conflict_blocked, v_discount;
    END IF;

    UPDATE public.products SET discount_price_ars = 2700 WHERE id = v_product;
    v_result := public.revert_price_change_proposal(v_recommendation, 'ZZ cierre controlado');
    SELECT recommendation.status, product.discount_price_ars
    INTO v_status, v_discount
    FROM public.ai_offer_recommendations recommendation
    JOIN public.products product ON product.id = recommendation.product_id
    WHERE recommendation.id = v_recommendation;
    IF v_result->>'ok' <> 'true' OR v_status <> 'reverted' OR v_discount IS NOT NULL THEN
      RAISE EXCEPTION 'Safe reversal did not restore the baseline: result %, status %, price %',
        v_result, v_status, v_discount;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.audit_logs audit
      WHERE audit.org_id = v_org
        AND audit.entity_type = 'price_change_proposal'
        AND audit.entity_id = v_recommendation::text
        AND audit.action = 'apply'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.audit_logs audit
      WHERE audit.org_id = v_org
        AND audit.entity_type = 'price_change_proposal'
        AND audit.entity_id = v_recommendation::text
        AND audit.action = 'revert'
    ) THEN
      RAISE EXCEPTION 'Apply or reversal audit is missing';
    END IF;

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text,
      true
    );
    EXECUTE 'SET LOCAL ROLE authenticated';
    SELECT count(*) INTO v_count
    FROM public.price_change_proposal_outcomes outcome
    WHERE outcome.recommendation_id = v_recommendation;
    BEGIN
      PERFORM public.measure_price_change_outcome(v_recommendation);
    EXCEPTION WHEN insufficient_privilege THEN
      v_outsider_blocked := true;
    END;
    EXECUTE 'RESET ROLE';
    IF v_count <> 0 OR NOT v_outsider_blocked THEN
      RAISE EXCEPTION 'Outsider saw % rows or function was not blocked %',
        v_count, v_outsider_blocked;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT count(*) INTO v_count
  FROM public.products product
  WHERE product.name LIKE 'ZZ Impacto Precio%';
  v_count := v_count + (
    SELECT count(*) FROM public.ai_offer_recommendations recommendation
    WHERE recommendation.reason LIKE 'ZZ medir una decision%'
  ) + (
    SELECT count(*) FROM public.audit_logs audit
    WHERE audit.entity_id = v_recommendation::text
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Price impact verification left % ZZ rows', v_count;
  END IF;

  RAISE NOTICE 'Price impact loop passed: baseline 3000/100%%, observed 2700/100%%, non-causal label, conflict guard, reversal, audit, outsider blocked, leftovers=0';
END
$verification$;
