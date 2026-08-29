-- Verificacion reversible de la cola offline del POS.
--
-- Ejecutar con:
--   npm run db -- --file supabase/verificaciones/20260829_pos_offline_idempotente.sql
--
-- Todo el escenario vive en una subtransaccion que se revierte. Si cualquier
-- invariante falla, la excepcion real aborta igualmente y PostgreSQL limpia.

DO $verification$
DECLARE
  v_org uuid;
  v_owner uuid;
  v_product uuid := gen_random_uuid();
  v_coupon uuid := gen_random_uuid();
  v_client_transaction uuid := gen_random_uuid();
  v_line_one uuid := gen_random_uuid();
  v_line_two uuid := gen_random_uuid();
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_payload jsonb;
  v_first jsonb;
  v_retry jsonb;
  v_transaction uuid;
  v_count bigint;
  v_stock integer;
  v_uses integer;
BEGIN
  SELECT membership.org_id, membership.user_id
  INTO v_org, v_owner
  FROM public.memberships membership
  WHERE membership.role = 'owner'
    AND EXISTS (
      SELECT 1 FROM public.products product
      WHERE product.org_id = membership.org_id
    )
    AND EXISTS (
      SELECT 1 FROM public.settings setting
      WHERE setting.org_id = membership.org_id
    )
  ORDER BY membership.created_at
  LIMIT 1;

  IF v_org IS NULL OR v_owner IS NULL THEN
    RAISE EXCEPTION 'La verificacion necesita una organizacion con owner, settings y producto base';
  END IF;

  BEGIN
    CREATE TEMP TABLE zz_pos_offline_product ON COMMIT DROP AS
      SELECT * FROM public.products WHERE org_id = v_org LIMIT 1;
    UPDATE zz_pos_offline_product
    SET id = v_product,
        name = 'ZZ POS offline ' || v_suffix,
        stock = 50,
        sale_price_ars = 5000,
        discount_price_ars = NULL,
        total_cost_usd = 1,
        tiendanube_id = NULL;
    INSERT INTO public.products SELECT * FROM zz_pos_offline_product;

    INSERT INTO public.coupons (
      id, org_id, user_id, code, discount_percent, discount_fixed_ars,
      current_uses, max_uses, active, valid_from
    ) VALUES (
      v_coupon, v_org, v_owner, 'ZZOFF' || left(v_suffix, 10), 10, 0,
      0, 1, true, now() - interval '1 day'
    );

    v_payload := jsonb_build_array(
      jsonb_build_object(
        'id', v_line_one,
        'user_id', v_owner,
        'org_id', v_org,
        'product_id', v_product,
        'product_name', 'ZZ POS offline ' || v_suffix,
        'quantity', 1,
        'unit_price_ars', 4500,
        'total_ars', 4500,
        'paid', false,
        'payment_method', 'fiado',
        'customer_name', 'ZZ Cliente offline',
        'coupon_id', v_coupon,
        'coupon_code', 'ZZOFF' || left(v_suffix, 10),
        'date', now(),
        'source', 'pos',
        'offline_transaction_id', v_client_transaction,
        'offline_origin', true
      ),
      jsonb_build_object(
        'id', v_line_two,
        'user_id', v_owner,
        'org_id', v_org,
        'product_id', v_product,
        'product_name', 'ZZ POS offline ' || v_suffix,
        'quantity', 2,
        'unit_price_ars', 4500,
        'total_ars', 9000,
        'paid', false,
        'payment_method', 'fiado',
        'customer_name', 'ZZ Cliente offline',
        'coupon_id', v_coupon,
        'coupon_code', 'ZZOFF' || left(v_suffix, 10),
        'date', now(),
        'source', 'pos',
        'offline_transaction_id', v_client_transaction,
        'offline_origin', true
      )
    );

    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text,
      true
    );
    EXECUTE 'SET LOCAL ROLE authenticated';

    v_first := public.create_sales_transaction_v3(v_org, v_payload, 'pos');
    v_retry := public.create_sales_transaction_v3(v_org, v_payload, 'pos');

    BEGIN
      PERFORM public.create_sales_transaction_v3(
        v_org,
        jsonb_set(v_payload, '{0,id}', to_jsonb(gen_random_uuid()::text)),
        'pos'
      );
      RAISE EXCEPTION 'La misma clave acepto contenido diferente';
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;

    EXECUTE 'RESET ROLE';

    IF COALESCE((v_first->>'reused')::boolean, true)
       OR NOT COALESCE((v_retry->>'reused')::boolean, false) THEN
      RAISE EXCEPTION 'La respuesta no distinguio creacion y reintento: first %, retry %',
        v_first, v_retry;
    END IF;

    v_transaction := (v_first->>'transaction_id')::uuid;
    IF v_transaction IS DISTINCT FROM (v_retry->>'transaction_id')::uuid THEN
      RAISE EXCEPTION 'El reintento devolvio otro ticket';
    END IF;

    SELECT count(*) INTO v_count
    FROM public.sale_transactions transaction
    WHERE transaction.org_id = v_org
      AND transaction.client_transaction_id = v_client_transaction;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Se crearon % padres comerciales', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.sales sale
    WHERE sale.sale_transaction_id = v_transaction;
    IF v_count <> 2 THEN
      RAISE EXCEPTION 'Se crearon % renglones en vez de 2', v_count;
    END IF;

    SELECT count(*) INTO v_count
    FROM public.debts debt
    WHERE debt.org_id = v_org
      AND debt.sale_id IN (v_line_one, v_line_two);
    IF v_count <> 2 THEN
      RAISE EXCEPTION 'Se crearon % deudas en vez de una por renglon', v_count;
    END IF;

    SELECT product.stock INTO v_stock
    FROM public.products product WHERE product.id = v_product;
    IF v_stock <> 47 THEN
      RAISE EXCEPTION 'El stock quedo en %, se esperaba 47', v_stock;
    END IF;

    SELECT coupon.current_uses INTO v_uses
    FROM public.coupons coupon WHERE coupon.id = v_coupon;
    IF v_uses <> 1 THEN
      RAISE EXCEPTION 'El cupon se uso % veces, se esperaba 1', v_uses;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback verification data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT
    (SELECT count(*) FROM public.products product
      WHERE product.name LIKE 'ZZ POS offline%')
    + (SELECT count(*) FROM public.sales sale
      WHERE sale.product_name LIKE 'ZZ POS offline%')
    + (SELECT count(*) FROM public.coupons coupon
      WHERE coupon.code LIKE 'ZZOFF%')
    + (SELECT count(*) FROM public.sale_transactions transaction
      WHERE transaction.client_transaction_id = v_client_transaction)
  INTO v_count;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'La verificacion offline dejo % restos ZZ', v_count;
  END IF;

  RAISE NOTICE 'POS offline idempotente: 1 ticket, 2 renglones, stock -3, 2 deudas, cupon +1, conflicto rechazado, restos=0';
END
$verification$;
