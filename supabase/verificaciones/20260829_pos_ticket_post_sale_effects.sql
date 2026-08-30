-- Fidelidad y alerta de venta grande se prueban sobre el ticket completo.
-- El bloque interno fuerza rollback y la ultima consulta exige cero restos.

DO $verification$
DECLARE
  v_org uuid := gen_random_uuid();
  v_user uuid;
  v_product uuid := gen_random_uuid();
  v_client_key uuid := gen_random_uuid();
  v_line_one uuid := gen_random_uuid();
  v_line_two uuid := gen_random_uuid();
  v_payload jsonb;
  v_first jsonb;
  v_retry jsonb;
  v_transaction uuid;
  v_count integer;
  v_points integer;
BEGIN
  SELECT membership.user_id INTO v_user
  FROM public.memberships membership
  WHERE membership.role = 'owner'
  ORDER BY membership.created_at
  LIMIT 1;
  ASSERT v_user IS NOT NULL, 'La prueba necesita un owner existente';

  BEGIN
    INSERT INTO public.organizations (id, name, slug, owner_user_id)
    VALUES (
      v_org, 'ZZ POS efectos ticket',
      'zz-pos-effects-' || substr(v_org::text, 1, 8), v_user
    );
    INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (v_org, v_user, 'owner');
    UPDATE public.settings
    SET exchange_rate = 1000,
        loyalty_enabled = true,
        loyalty_points_per_1000 = 2,
        large_sale_threshold_ars = 10000,
        discount_cash_percent = 0
    WHERE org_id = v_org;

    INSERT INTO public.products (
      id, org_id, user_id, name, sale_price_ars,
      cost_usd, total_cost_usd, stock
    ) VALUES (
      v_product, v_org, v_user, 'ZZ Producto efectos ticket', 6000,
      1, 1, 10
    );

    v_payload := jsonb_build_array(
      jsonb_build_object(
        'id', v_line_one,
        'product_id', v_product,
        'product_name', 'ZZ Producto efectos ticket A',
        'quantity', 1,
        'unit_price_ars', 6000,
        'customer_name', 'ZZ Cliente efectos',
        'paid', true,
        'payment_method', 'efectivo',
        'source', 'pos',
        'offline_transaction_id', v_client_key
      ),
      jsonb_build_object(
        'id', v_line_two,
        'product_id', v_product,
        'product_name', 'ZZ Producto efectos ticket B',
        'quantity', 1,
        'unit_price_ars', 6000,
        'customer_name', 'ZZ Cliente efectos',
        'paid', true,
        'payment_method', 'efectivo',
        'source', 'pos',
        'offline_transaction_id', v_client_key
      )
    );

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
      true
    );
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_first := public.create_sales_transaction_v3(v_org, v_payload, 'pos');
    v_retry := public.create_sales_transaction_v3(v_org, v_payload, 'pos');
    EXECUTE 'RESET ROLE';

    v_transaction := (v_first->>'transaction_id')::uuid;
    ASSERT NOT COALESCE((v_first->>'reused')::boolean, true),
      'la primera venta se marco reutilizada';
    ASSERT COALESCE((v_retry->>'reused')::boolean, false),
      'el retry no reutilizo el ticket';

    SELECT count(*), COALESCE(sum(point.delta), 0)
    INTO v_count, v_points
    FROM public.loyalty_points point
    WHERE point.org_id = v_org
      AND point.reason = 'sale'
      AND point.reference_id = v_transaction;
    ASSERT v_count = 1, 'el ticket creo mas de un movimiento de fidelidad';
    ASSERT v_points = 24, format(
      'los puntos no se calcularon sobre ARS 12.000 completos: filas=%s puntos=%s ticket=%s',
      v_count, v_points, v_transaction
    );

    SELECT count(*) INTO v_count
    FROM public.notifications notification
    WHERE notification.org_id = v_org
      AND notification.type = 'venta_grande'
      AND notification.entity_type = 'sale_transaction'
      AND notification.entity_id = v_transaction::text;
    ASSERT v_count = 1, 'el ticket creo mas de una alerta de venta grande';

    -- Al anular una sola linea el ticket queda en ARS 6.000: se recalculan
    -- puntos y desaparece la alerta que ya no corresponde.
    DELETE FROM public.sales WHERE id = v_line_two;
    SELECT COALESCE(sum(point.delta), 0) INTO v_points
    FROM public.loyalty_points point
    WHERE point.org_id = v_org
      AND point.reason = 'sale'
      AND point.reference_id = v_transaction;
    ASSERT v_points = 12, 'la anulacion parcial no recalculo fidelidad';
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.notifications notification
      WHERE notification.org_id = v_org
        AND notification.type = 'venta_grande'
        AND notification.entity_type = 'sale_transaction'
        AND notification.entity_id = v_transaction::text
    ), 'la anulacion parcial dejo una alerta grande falsa';

    DELETE FROM public.sales WHERE id = v_line_one;
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.loyalty_points point
      WHERE point.org_id = v_org
        AND point.reason = 'sale'
        AND point.reference_id = v_transaction
    ), 'la anulacion total dejo puntos del ticket';

    RAISE NOTICE 'ticket=%, retry=%, puntos=24->12->0, alerta=1->0',
      v_transaction, v_retry->>'reused';
    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT
    (SELECT count(*) FROM public.organizations organization WHERE organization.id = v_org)
    + (SELECT count(*) FROM public.products product WHERE product.id = v_product)
    + (SELECT count(*) FROM public.sales sale WHERE sale.id IN (v_line_one, v_line_two))
    + (SELECT count(*) FROM public.sale_transactions transaction
       WHERE transaction.client_transaction_id = v_client_key)
    + (SELECT count(*) FROM public.loyalty_points point
       WHERE point.org_id = v_org)
    + (SELECT count(*) FROM public.notifications notification
       WHERE notification.org_id = v_org)
  INTO v_count;

  ASSERT v_count = 0, format('la prueba dejo %s restos ZZ', v_count);
  RAISE NOTICE 'POS postventa por ticket: retry idempotente y restos=0';
END
$verification$;
