-- Prueba reversible del turno autoritativo. Crea una organización, ubicación,
-- producto y ticket ZZ; abre/cierra mediante RPC y hace ROLLBACK al final.
BEGIN;

CREATE TEMP TABLE zz_pos_cash_session_proof (
  check_name text,
  value text
) ON COMMIT DROP;

DO $proof$
DECLARE
  v_org uuid := gen_random_uuid();
  v_location uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_sale_a uuid := gen_random_uuid();
  v_sale_b uuid := gen_random_uuid();
  v_ticket uuid := gen_random_uuid();
  v_user uuid;
  v_outsider uuid := gen_random_uuid();
  v_open jsonb;
  v_result jsonb;
  v_close jsonb;
  v_session uuid;
  v_transaction uuid;
  v_ticket_entries integer;
  v_cash_amount numeric;
  v_linked_session uuid;
  v_expected numeric;
  v_restos integer;
  v_outsider_blocked boolean := false;
BEGIN
  SELECT user_id INTO v_user FROM public.memberships LIMIT 1;
  ASSERT v_user IS NOT NULL, 'No hay usuario para la fixture ZZ';

  INSERT INTO public.organizations (id, name, slug, owner_user_id)
  VALUES (
    v_org, 'ZZ turno POS',
    'zz-pos-cash-session-' || substr(v_org::text, 1, 8), v_user
  );
  INSERT INTO public.memberships (org_id, user_id, role)
  VALUES (v_org, v_user, 'owner');
  INSERT INTO public.locations (id, org_id, name, is_main, active)
  VALUES (v_location, v_org, 'ZZ Mostrador', true, true);
  UPDATE public.settings
  SET exchange_rate = 1000,
      discount_cash_percent = 0
  WHERE org_id = v_org;
  INSERT INTO public.products (
    id, org_id, user_id, name, sale_price_ars,
    cost_usd, total_cost_usd, stock
  ) VALUES (
    v_product, v_org, v_user, 'ZZ Producto turno', 5000,
    1, 1, 10
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
    true
  );

  v_open := public.pos_cash_session_open(v_org, v_location, 10000, 'ZZ apertura');
  v_session := (v_open->>'session_id')::uuid;
  ASSERT v_session IS NOT NULL AND NOT (v_open->>'reused')::boolean,
    'la primera apertura no creó la sesión';

  v_open := public.pos_cash_session_open(v_org, v_location, 10000, 'ZZ retry');
  ASSERT (v_open->>'session_id')::uuid = v_session
     AND (v_open->>'reused')::boolean,
    'el retry de apertura duplicó la sesión';

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_outsider, 'role', 'authenticated')::text,
    true
  );
  BEGIN
    PERFORM public.pos_cash_session_open(v_org, v_location, 0, 'ZZ outsider');
  EXCEPTION WHEN insufficient_privilege THEN
    v_outsider_blocked := true;
  END;
  ASSERT v_outsider_blocked, 'un outsider pudo abrir la caja';
  ASSERT NOT has_table_privilege('authenticated', 'public.cash_sessions', 'INSERT'),
    'authenticated conserva INSERT directo sobre cash_sessions';

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user, 'role', 'authenticated')::text,
    true
  );

  v_result := public.create_sales_transaction_v3(
    v_org,
    jsonb_build_array(
      jsonb_build_object(
        'id', v_sale_a,
        'product_id', v_product,
        'product_name', 'ZZ Producto turno',
        'quantity', 1,
        'unit_price_ars', 5000,
        'total_ars', 5000,
        'date', now(),
        'paid', true,
        'payment_method', 'efectivo',
        'location_id', v_location,
        'seller_name', 'ZZ Cajero',
        'offline_transaction_id', v_ticket,
        'offline_origin', false
      ),
      jsonb_build_object(
        'id', v_sale_b,
        'product_id', v_product,
        'product_name', 'ZZ Producto turno',
        'quantity', 1,
        'unit_price_ars', 5000,
        'total_ars', 5000,
        'date', now(),
        'paid', true,
        'payment_method', 'efectivo',
        'location_id', v_location,
        'seller_name', 'ZZ Cajero',
        'offline_transaction_id', v_ticket,
        'offline_origin', false
      )
    ),
    'pos'
  );
  v_transaction := (v_result->>'transaction_id')::uuid;

  SELECT count(*), max(amount_ars)
  INTO v_ticket_entries, v_cash_amount
  FROM public.cash_entries
  WHERE session_id = v_session AND sale_transaction_id = v_transaction;
  SELECT cash_session_id INTO v_linked_session
  FROM public.sale_transactions WHERE id = v_transaction;

  ASSERT (v_result->'cash_session'->>'linked')::boolean,
    'v3 no informó el vínculo de caja';
  ASSERT v_linked_session = v_session,
    'el ticket no quedó unido a la sesión';
  ASSERT v_ticket_entries = 1,
    'dos renglones generaron ' || v_ticket_entries || ' movimientos en vez de un ticket';
  ASSERT v_cash_amount = 10000,
    'el movimiento de caja no suma el ticket completo';

  -- Reintentar el mismo ticket no duplica entrada, stock ni sesión.
  v_result := public.create_sales_transaction_v3(
    v_org,
    jsonb_build_array(
      jsonb_build_object(
        'id', v_sale_a, 'product_id', v_product,
        'product_name', 'ZZ Producto turno', 'quantity', 1,
        'unit_price_ars', 5000, 'total_ars', 5000, 'date', now(),
        'paid', true, 'payment_method', 'efectivo',
        'location_id', v_location, 'seller_name', 'ZZ Cajero',
        'offline_transaction_id', v_ticket, 'offline_origin', false
      ),
      jsonb_build_object(
        'id', v_sale_b, 'product_id', v_product,
        'product_name', 'ZZ Producto turno', 'quantity', 1,
        'unit_price_ars', 5000, 'total_ars', 5000, 'date', now(),
        'paid', true, 'payment_method', 'efectivo',
        'location_id', v_location, 'seller_name', 'ZZ Cajero',
        'offline_transaction_id', v_ticket, 'offline_origin', false
      )
    ), 'pos'
  );
  SELECT count(*) INTO v_ticket_entries
  FROM public.cash_entries
  WHERE session_id = v_session AND sale_transaction_id = v_transaction;
  ASSERT v_ticket_entries = 1 AND (v_result->>'reused')::boolean,
    'el retry duplicó el movimiento de caja';

  v_expected := public.cash_session_expected_cash(v_session);
  ASSERT v_expected = 20000,
    'efectivo esperado debía ser apertura 10000 + ticket 10000';

  v_close := public.pos_cash_session_close(v_session, 19900, 'ZZ diferencia');
  ASSERT (v_close->>'expected_cash')::numeric = 20000
     AND (v_close->>'difference')::numeric = -100,
    'el cierre no calculó el faltante autoritativo';
  v_close := public.pos_cash_session_close(v_session, 19900, 'ZZ retry');
  ASSERT (v_close->>'reused')::boolean,
    'el retry de cierre no fue idempotente';

  INSERT INTO zz_pos_cash_session_proof VALUES
    ('session_id', v_session::text),
    ('ticket_entries', v_ticket_entries::text),
    ('ticket_amount', v_cash_amount::text),
    ('expected_cash', v_expected::text),
    ('closing_difference', (v_close->>'difference')),
    ('outsider_blocked', v_outsider_blocked::text);

  DELETE FROM public.organizations WHERE id = v_org;
  SELECT
    (SELECT count(*) FROM public.organizations WHERE id = v_org)
    + (SELECT count(*) FROM public.cash_sessions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.cash_entries WHERE org_id = v_org)
    + (SELECT count(*) FROM public.products WHERE org_id = v_org)
    + (SELECT count(*) FROM public.sales WHERE org_id = v_org)
    + (SELECT count(*) FROM public.sale_transactions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_transactions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.stock_movements WHERE org_id = v_org)
  INTO v_restos;
  ASSERT v_restos = 0, 'quedaron ' || v_restos || ' restos ZZ';
  INSERT INTO zz_pos_cash_session_proof VALUES ('restos', v_restos::text);
END
$proof$;

SELECT check_name, value
FROM zz_pos_cash_session_proof
ORDER BY check_name;

ROLLBACK;
