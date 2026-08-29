-- API publica v1: el limite anunciado por key pasa a existir de verdad.
--
-- Antes `rate_limit_rpm` se mostraba en Integraciones, pero la Edge aplicaba
-- 120 rpm por IP dentro de una sola instancia. El limite de la key no se leia,
-- dos instancias no compartian contador y el 429 heredaba CORS `*`.
--
-- Esta funcion usa el contador atomico durable que ya protege checkout/cupon,
-- pero falla cerrado: una API server-to-server debe poder decir 503 antes que
-- prometer un cupo que no pudo verificar. Tambien registra el uso en la misma
-- transaccion. Solo service_role puede ejecutarla.

UPDATE public.api_keys
   SET rate_limit_rpm = 1000
 WHERE rate_limit_rpm IS NULL OR rate_limit_rpm < 1 OR rate_limit_rpm > 10000;

ALTER TABLE public.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_rate_limit_rpm_range;
ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_rate_limit_rpm_range
  CHECK (rate_limit_rpm BETWEEN 1 AND 10000);

CREATE OR REPLACE FUNCTION public.api_key_consumir_cupo(p_key_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_limite  integer;
  v_ahora   timestamptz := clock_timestamp();
  v_ventana timestamptz := date_trunc('minute', v_ahora);
  v_reset   timestamptz := date_trunc('minute', v_ahora) + interval '1 minute';
  v_cuenta  integer;
BEGIN
  SELECT rate_limit_rpm
    INTO STRICT v_limite
    FROM public.api_keys
   WHERE id = p_key_id
     AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > now());

  INSERT INTO public.rate_limits (clave, ventana, contador)
  VALUES ('public_api:' || p_key_id::text, v_ventana, 1)
  ON CONFLICT (clave, ventana) DO UPDATE
    SET contador = public.rate_limits.contador + 1
  RETURNING contador INTO v_cuenta;

  UPDATE public.api_keys
     SET last_used_at = now(),
         request_count = COALESCE(request_count, 0) + 1
   WHERE id = p_key_id;

  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE ventana < now() - interval '1 hour';
  END IF;

  RETURN jsonb_build_object(
    'allowed',   v_cuenta <= v_limite,
    'limit',     v_limite,
    'remaining', greatest(v_limite - v_cuenta, 0),
    'reset_at',  extract(epoch FROM v_reset)::bigint
  );
END;
$fn$;

COMMENT ON FUNCTION public.api_key_consumir_cupo(uuid) IS
  'Consume el cupo durable por API key y devuelve allowed/limit/remaining/reset_at. Solo service_role; reemplaza el limitador por IP que no respetaba rate_limit_rpm.';

REVOKE ALL ON FUNCTION public.api_key_consumir_cupo(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_consumir_cupo(uuid) TO service_role;

-- La venta y el cierre de su idempotencia tienen que ser una sola transaccion.
-- Antes la Edge reservaba, insertaba y completaba en tres requests: si el
-- tercero fallaba, la venta existia pero un retry podia quedar bloqueado o
-- duplicarla. La funcion relee key, producto, owner y costo en servidor.
CREATE OR REPLACE FUNCTION public.api_v1_crear_venta(
  p_org_id uuid,
  p_api_key_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_total_ars numeric,
  p_unit_price_ars numeric,
  p_customer_name text,
  p_paid boolean,
  p_payment_method text,
  p_date timestamptz,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_product public.products%ROWTYPE;
  v_owner uuid;
  v_exchange_rate numeric;
  v_operation text := 'api_create_sale:' || p_api_key_id::text;
  v_reservation jsonb;
  v_sale public.sales%ROWTYPE;
  v_cost_usd numeric;
  v_cogs_ars numeric;
  v_profit_ars numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 2147483647
     OR p_total_ars IS NULL OR p_total_ars < 0 OR p_total_ars > 999999999999.99
     OR p_total_ars <> round(p_total_ars, 2)
     OR p_unit_price_ars IS NULL OR p_unit_price_ars < 0 OR p_unit_price_ars > 999999999999.99
     OR p_unit_price_ars <> round(p_unit_price_ars, 2) THEN
    RAISE EXCEPTION 'Cantidad o importes fuera del contrato v1'
      USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(btrim(p_idempotency_key), '')) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Idempotency-Key fuera del contrato v1'
      USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(btrim(p_payment_method), '')) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'payment_method fuera del contrato v1'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.api_keys k
     WHERE k.id = p_api_key_id
       AND k.org_id = p_org_id
       AND k.revoked_at IS NULL
       AND (k.expires_at IS NULL OR k.expires_at > now())
       AND 'sales:write' = ANY(k.scopes)
  ) THEN
    RAISE EXCEPTION 'API key sin autoridad para crear la venta'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_product
    FROM public.products
   WHERE id = p_product_id AND org_id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto inexistente' USING ERRCODE = 'P0002';
  END IF;

  SELECT user_id, COALESCE(NULLIF(exchange_rate, 0), 1)
    INTO v_owner, v_exchange_rate
    FROM public.settings
   WHERE org_id = p_org_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'La organizacion no tiene owner operativo'
      USING ERRCODE = '23514';
  END IF;

  -- Serializa la misma key antes de reservar. Sin este lock, dos requests
  -- simultaneas podian ver "no existe", competir por el PK y devolver un 409
  -- espurio aunque el payload fuera identico.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_org_id::text || ':' || v_operation || ':' || p_idempotency_key,
    0
  ));

  v_reservation := public.idempotencia_reservar(
    p_org_id,
    v_operation,
    p_idempotency_key,
    jsonb_build_object(
      'product_id', p_product_id,
      'quantity', p_quantity,
      'total_ars', p_total_ars,
      'unit_price_ars', p_unit_price_ars,
      'customer_name', p_customer_name,
      'paid', p_paid,
      'payment_method', p_payment_method,
      'date', p_date
    )
  );

  IF NOT COALESCE((v_reservation->>'ejecutar')::boolean, true) THEN
    RETURN jsonb_build_object(
      'data', v_reservation->'respuesta',
      'idempotent_replay', true
    );
  END IF;

  v_cost_usd := round(COALESCE(NULLIF(v_product.total_cost_usd, 0), v_product.cost_usd, 0), 4);
  v_cogs_ars := round(v_cost_usd * v_exchange_rate * p_quantity, 2);
  v_profit_ars := round(p_total_ars - v_cogs_ars, 2);

  INSERT INTO public.sales (
    org_id, user_id, product_id, product_name, quantity, unit_price_ars,
    total_ars, cost_per_unit_usd, cost_of_goods_ars, profit_ars, profit_usd,
    customer_name, paid, payment_method, date, source
  ) VALUES (
    p_org_id, v_owner, v_product.id, v_product.name, p_quantity,
    p_unit_price_ars, p_total_ars, v_cost_usd, v_cogs_ars, v_profit_ars,
    CASE WHEN v_exchange_rate > 0 THEN round(v_profit_ars / v_exchange_rate, 4) ELSE 0 END,
    NULLIF(left(btrim(COALESCE(p_customer_name, '')), 500), ''),
    COALESCE(p_paid, true), btrim(p_payment_method), COALESCE(p_date, now()), 'api'
  ) RETURNING * INTO v_sale;

  PERFORM public.idempotencia_completar(
    p_org_id, v_operation, p_idempotency_key, to_jsonb(v_sale)
  );

  RETURN jsonb_build_object('data', to_jsonb(v_sale), 'idempotent_replay', false);
END;
$fn$;

COMMENT ON FUNCTION public.api_v1_crear_venta(
  uuid, uuid, uuid, integer, numeric, numeric, text, boolean, text,
  timestamptz, text
) IS
  'Crea una venta API v1 y completa su idempotencia en una sola transaccion. Revalida key, scope, tenant, producto, owner y costos en servidor.';

REVOKE ALL ON FUNCTION public.api_v1_crear_venta(
  uuid, uuid, uuid, integer, numeric, numeric, text, boolean, text,
  timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_v1_crear_venta(
  uuid, uuid, uuid, integer, numeric, numeric, text, boolean, text,
  timestamptz, text
) TO service_role;

-- Verificacion transaccional: una key temporal con limite 2 permite dos
-- requests, frena la tercera, registra las tres y deja cero restos.
DO $verif$
DECLARE
  v_org uuid;
  v_key uuid := gen_random_uuid();
  v_uno jsonb;
  v_dos jsonb;
  v_tres jsonb;
  v_antes bigint;
  v_restos bigint;
BEGIN
  SELECT id INTO v_org FROM public.organizations ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'api_key_consumir_cupo: sin organizacion para fixture';
    RETURN;
  END IF;

  INSERT INTO public.api_keys (
    id, org_id, name, key_prefix, key_hash, scopes, rate_limit_rpm, request_count
  ) VALUES (
    v_key, v_org, 'ZZ cupo API', 'gst_live_zz',
    md5(v_key::text) || md5(v_key::text || ':2'),
    ARRAY['products:read'], 2, 0
  );

  SELECT count(*) INTO v_antes FROM public.rate_limits
   WHERE clave = 'public_api:' || v_key::text;

  v_uno := public.api_key_consumir_cupo(v_key);
  v_dos := public.api_key_consumir_cupo(v_key);
  v_tres := public.api_key_consumir_cupo(v_key);

  ASSERT (v_uno->>'allowed')::boolean, 'la primera request fue rechazada';
  ASSERT (v_dos->>'allowed')::boolean, 'la segunda request fue rechazada';
  ASSERT NOT (v_tres->>'allowed')::boolean, 'la tercera request paso el limite';
  ASSERT (v_tres->>'remaining')::integer = 0, 'remaining no llego a cero';
  ASSERT (SELECT request_count FROM public.api_keys WHERE id = v_key) = 3,
    'request_count no registro cada request autenticada';

  DELETE FROM public.rate_limits WHERE clave = 'public_api:' || v_key::text;
  DELETE FROM public.api_keys WHERE id = v_key;

  SELECT count(*) INTO v_restos
    FROM public.api_keys WHERE id = v_key;
  v_restos := v_restos + (
    SELECT count(*) FROM public.rate_limits
     WHERE clave = 'public_api:' || v_key::text
  );
  ASSERT v_restos = 0, format('quedaron %s restos de la fixture', v_restos);
  RAISE NOTICE 'api_key_consumir_cupo: 6 invariantes, restos 0';
END;
$verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829000020', 'api_publica_tiene_contrato')
ON CONFLICT DO NOTHING;
