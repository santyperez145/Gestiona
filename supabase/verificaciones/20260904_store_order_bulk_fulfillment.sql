-- Verificación reversible D5.27: lote parcial, retiro/domicilio, permiso y
-- límite. No usa productos ni stock; todo lo ZZ queda dentro del ROLLBACK.

BEGIN;

CREATE TEMP TABLE zz_bulk_results (
  check_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text
);

SELECT
  set_config('app.zz_store_id', s.id::text, true),
  set_config('app.zz_org_id', s.org_id::text, true),
  set_config('app.zz_member_id', m.user_id::text, true)
FROM public.ecommerce_stores s
JOIN LATERAL (
  SELECT user_id
  FROM public.memberships
  WHERE org_id = s.org_id
    AND role IN ('owner', 'admin')
  ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END
  LIMIT 1
) m ON true
WHERE s.is_active
ORDER BY s.created_at
LIMIT 1;

DO $$
DECLARE
  v_org uuid := current_setting('app.zz_org_id')::uuid;
  v_store uuid := current_setting('app.zz_store_id')::uuid;
  v_ship uuid := gen_random_uuid();
  v_pickup uuid := gen_random_uuid();
  v_unpaid uuid := gen_random_uuid();
  v_done uuid := gen_random_uuid();
  v_missing uuid := gen_random_uuid();
  v_result jsonb;
  v_statuses text[];
BEGIN
  INSERT INTO public.ecommerce_orders (
    id, org_id, store_id, order_number, customer_email, customer_name,
    items, subtotal, total, payment_method, payment_status,
    fulfillment_status, carrier, shipping_service
  ) VALUES
    (v_ship, v_org, v_store, 'ZZ-BULK-SHIP', 'zz-bulk@example.invalid', 'ZZ Bulk domicilio',
     '[]', 1, 1, 'efectivo', 'paid', 'processing', 'propio', 'domicilio'),
    (v_pickup, v_org, v_store, 'ZZ-BULK-PICKUP', 'zz-bulk@example.invalid', 'ZZ Bulk retiro',
     '[]', 1, 1, 'efectivo', 'paid', 'processing', 'retiro', 'sucursal'),
    (v_unpaid, v_org, v_store, 'ZZ-BULK-UNPAID', 'zz-bulk@example.invalid', 'ZZ Bulk impago',
     '[]', 1, 1, 'efectivo', 'pending', 'processing', 'propio', 'domicilio'),
    (v_done, v_org, v_store, 'ZZ-BULK-DONE', 'zz-bulk@example.invalid', 'ZZ Bulk finalizado',
     '[]', 1, 1, 'efectivo', 'paid', 'delivered', 'retiro', 'sucursal');

  INSERT INTO public.deliveries (
    org_id, ecommerce_order_id, tracking_code, customer_name, customer_email,
    address_street, address_city, carrier, status, cod_amount, cod_collected
  ) VALUES (
    v_org, v_ship, 'ZZ-BULK-TRACK', 'ZZ Bulk domicilio', 'zz-bulk@example.invalid',
    'Calle ZZ 1', 'Ciudad ZZ', 'propio', 'pending', 0, true
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', current_setting('app.zz_member_id'),
      'role', 'authenticated'
    )::text,
    true
  );
  SET LOCAL ROLE authenticated;

  SELECT public.bulk_update_store_order_fulfillment(
    v_org,
    ARRAY[v_ship, v_pickup, v_unpaid, v_missing, v_ship],
    'shipped'
  ) INTO v_result;
  RESET ROLE;

  INSERT INTO zz_bulk_results VALUES (
    'partial_shipped',
    (v_result->>'changed')::int = 1
      AND (v_result->>'skipped')::int = 3
      AND (v_result->>'duplicates')::int = 1,
    v_result::text
  );

  SELECT array_agg(fulfillment_status ORDER BY order_number)
    INTO v_statuses
    FROM public.ecommerce_orders
   WHERE id = ANY(ARRAY[v_ship, v_pickup, v_unpaid]);
  INSERT INTO zz_bulk_results VALUES (
    'first_states',
    v_statuses = ARRAY['processing', 'shipped', 'processing'],
    array_to_string(v_statuses, ',')
  );

  SET LOCAL ROLE authenticated;
  SELECT public.bulk_update_store_order_fulfillment(
    v_org,
    ARRAY[v_ship, v_pickup, v_done],
    'delivered'
  ) INTO v_result;
  RESET ROLE;
  INSERT INTO zz_bulk_results VALUES (
    'delivery_and_pickup',
    (v_result->>'changed')::int = 2
      AND (v_result->>'unchanged')::int = 1
      AND (v_result->>'skipped')::int = 0,
    v_result::text
  );

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated"}',
    true
  );
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.bulk_update_store_order_fulfillment(v_org, ARRAY[v_done], 'delivered');
    RESET ROLE;
    INSERT INTO zz_bulk_results VALUES ('outsider_denied', false, 'el outsider pudo operar');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO zz_bulk_results VALUES (
      'outsider_denied',
      SQLERRM = 'No tenés permiso para actualizar pedidos de esta tienda',
      SQLERRM
    );
  END;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', current_setting('app.zz_member_id'),
      'role', 'authenticated'
    )::text,
    true
  );
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.bulk_update_store_order_fulfillment(
      v_org,
      array_fill(v_done, ARRAY[51]),
      'delivered'
    );
    RESET ROLE;
    INSERT INTO zz_bulk_results VALUES ('limit_50', false, 'aceptó 51 IDs');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO zz_bulk_results VALUES (
      'limit_50',
      SQLERRM = 'Podés actualizar hasta 50 pedidos por lote',
      SQLERRM
    );
  END;
  INSERT INTO zz_bulk_results
  SELECT
    'audit_summary',
    count(*) = 2,
    format('%s eventos bulk', count(*))
  FROM public.audit_logs
  WHERE org_id = v_org
    AND action = 'fulfillment_bulk'
    AND details->>'status' IN ('shipped', 'delivered')
    AND created_at >= transaction_timestamp();
END;
$$;

SELECT * FROM zz_bulk_results ORDER BY check_name;
SELECT count(*) AS failed_checks FROM zz_bulk_results WHERE NOT passed;

ROLLBACK;

SELECT count(*) AS zz_residuos
FROM public.ecommerce_orders
WHERE order_number LIKE 'ZZ-BULK-%';
