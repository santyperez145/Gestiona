-- Verificacion reversible de la autoridad transaccional de la API publica.
-- Todo ocurre dentro de BEGIN/ROLLBACK: ningun dato real cambia.
BEGIN;

DO $verif$
DECLARE
  v_org uuid;
  v_owner uuid;
  v_product uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_idem text := 'zz-api-' || gen_random_uuid()::text;
  v_first jsonb;
  v_replay jsonb;
  v_stock_before integer;
  v_stock_after integer;
BEGIN
  SELECT s.org_id, s.user_id
    INTO v_org, v_owner
    FROM public.settings s
   WHERE s.user_id IS NOT NULL
   ORDER BY s.created_at
   LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'api v1: sin settings operativos para fixture';
    RETURN;
  END IF;

  INSERT INTO public.products (
    id, org_id, user_id, name, stock, cost_usd, total_cost_usd,
    sale_price_ars, is_active
  ) VALUES (
    v_product, v_org, v_owner, 'ZZ API contrato', 5, 1, 1, 100, true
  );
  SELECT stock INTO v_stock_before FROM public.products WHERE id = v_product;

  INSERT INTO public.api_keys (
    id, org_id, name, key_prefix, key_hash, scopes, rate_limit_rpm
  ) VALUES (
    v_key, v_org, 'ZZ API contrato', 'gst_live_zz',
    md5(v_key::text) || md5(v_key::text || ':2'),
    ARRAY['sales:write'], 10
  );

  v_first := public.api_v1_crear_venta(
    v_org, v_key, v_product, 2, 200, 100, 'ZZ Cliente', true,
    'efectivo', '2026-08-29T12:00:00Z', v_idem
  );
  v_replay := public.api_v1_crear_venta(
    v_org, v_key, v_product, 2, 200, 100, 'ZZ Cliente', true,
    'efectivo', '2026-08-29T12:00:00Z', v_idem
  );

  SELECT stock INTO v_stock_after FROM public.products WHERE id = v_product;
  ASSERT NOT (v_first->>'idempotent_replay')::boolean,
    'la primera request no puede ser replay';
  ASSERT (v_replay->>'idempotent_replay')::boolean,
    'la segunda request debe ser replay';
  ASSERT v_first->'data'->>'id' = v_replay->'data'->>'id',
    'el replay no devolvio la misma venta';
  ASSERT (SELECT count(*) FROM public.sales WHERE product_id = v_product) = 1,
    'la idempotencia creo mas de una venta';
  ASSERT v_stock_before - v_stock_after = 2,
    format('el stock se movio %s y se esperaban 2', v_stock_before - v_stock_after);
  ASSERT (SELECT count(*) FROM public.idempotency_keys
           WHERE org_id = v_org
             AND operacion = 'api_create_sale:' || v_key::text
             AND estado = 'completada') = 1,
    'la venta y la idempotencia no quedaron completadas juntas';

  BEGIN
    PERFORM public.api_v1_crear_venta(
      v_org, v_key, v_product, 1, 100, 100, 'ZZ Otro', true,
      'efectivo', '2026-08-29T12:00:00Z', v_idem
    );
    RAISE EXCEPTION 'ZZ_FALLO: la misma key acepto otro payload';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'api v1: 7 invariantes transaccionales verificadas';
END;
$verif$;

ROLLBACK;

SELECT
  (SELECT count(*) FROM public.products WHERE name = 'ZZ API contrato')
  + (SELECT count(*) FROM public.api_keys WHERE name = 'ZZ API contrato')
  + (SELECT count(*) FROM public.sales WHERE customer_name = 'ZZ Cliente')
  + (SELECT count(*) FROM public.idempotency_keys
      WHERE clave LIKE 'zz-api-%') AS restos;
