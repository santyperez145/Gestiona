-- H1b — el checkout deja de poder duplicarse.
--
-- ── Por qué un envoltorio y no tocar `create_store_order` ────────────────
--
-- `create_store_order` tiene 186 líneas y es el camino por el que entra toda
-- venta online. Este repo ya aprendió que reescribir una función así de memoria
-- es como casi se rompe `mark_store_order_paid`. Agregarle un parámetro además
-- crearía una sobrecarga —`CREATE OR REPLACE` con una firma nueva no reemplaza,
-- convive— y quedarían dos versiones vivas.
--
-- Un envoltorio deja la función original intacta, se puede desactivar volviendo
-- a llamar a la vieja, y no tiene forma de romper lo que ya funciona.
--
-- ── Lo que resuelve ──────────────────────────────────────────────────────
--
-- Hoy, si el navegador reintenta el checkout —timeout que en realidad completó,
-- doble clic, un proxy— se crean dos órdenes con el mismo carrito, se reserva
-- stock dos veces y el comprador ve dos números de orden. Con la clave, el
-- segundo intento devuelve **exactamente la misma respuesta** que el primero.
--
-- ── La decisión que no es obvia ──────────────────────────────────────────
--
-- La organización sale del slug de la tienda **adentro de la función**, no la
-- manda el navegador. Si la mandara, cualquiera podría reservar claves en la
-- organización de otro y bloquearle los checkouts. Es el mismo criterio que ya
-- rige para precios y stock: el cliente manda ids, el servidor resuelve.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.create_store_order_idem(
  p_slug            text,
  p_items           jsonb,
  p_customer_name   text,
  p_customer_email  text,
  p_customer_phone  text    DEFAULT NULL,
  p_shipping        jsonb   DEFAULT NULL,
  p_payment_method  text    DEFAULT NULL,
  p_notes           text    DEFAULT NULL,
  p_coupon          text    DEFAULT NULL,
  p_shipping_option text    DEFAULT NULL,
  p_fiscal          jsonb   DEFAULT NULL,
  p_idempotency_key text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org       uuid;
  v_reserva   jsonb;
  v_resultado jsonb;
  v_payload   jsonb;
BEGIN
  -- La organización la resuelve el servidor desde el slug. Nunca la manda el
  -- navegador: si no, cualquiera podría reservar claves en la organización
  -- ajena y dejarle el checkout bloqueado.
  SELECT s.org_id INTO v_org
    FROM public.ecommerce_stores s
   WHERE lower(s.slug) = lower(p_slug) AND s.is_active
   LIMIT 1;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada o inactiva';
  END IF;

  -- El hash se arma con lo que define la compra. Si cambia el carrito, el
  -- email o el envío, es otra compra aunque reusen la clave.
  v_payload := jsonb_build_object(
    'items', p_items, 'email', lower(btrim(COALESCE(p_customer_email, ''))),
    'shipping', p_shipping, 'coupon', p_coupon,
    'shipping_option', p_shipping_option, 'payment_method', p_payment_method);

  v_reserva := public.idempotencia_reservar(
    v_org, 'create_store_order', p_idempotency_key, v_payload);

  -- Ya se había creado: se devuelve la misma orden, no una nueva.
  IF NOT (v_reserva->>'ejecutar')::boolean THEN
    RETURN (v_reserva->'respuesta') || jsonb_build_object('reintento', true);
  END IF;

  BEGIN
    v_resultado := public.create_store_order(
      p_slug, p_items, p_customer_name, p_customer_email, p_customer_phone,
      p_shipping, p_payment_method, p_notes, p_coupon, p_shipping_option,
      p_fiscal);
  EXCEPTION WHEN OTHERS THEN
    -- Sin esto la clave queda en `en_curso` para siempre y el comprador no
    -- puede reintentar nunca más — que es peor que el problema original.
    PERFORM public.idempotencia_fallar(
      v_org, 'create_store_order', p_idempotency_key, SQLERRM);
    RAISE;
  END;

  PERFORM public.idempotencia_completar(
    v_org, 'create_store_order', p_idempotency_key, v_resultado);

  RETURN v_resultado;
END;
$$;

COMMENT ON FUNCTION public.create_store_order_idem IS
  'Checkout con clave de idempotencia. Envuelve create_store_order sin modificarla: el reintento devuelve la misma orden en vez de crear otra. La organizacion se resuelve del slug en el servidor, nunca la manda el navegador.';

REVOKE ALL ON FUNCTION public.create_store_order_idem(
  text, jsonb, text, text, text, jsonb, text, text, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_store_order_idem(
  text, jsonb, text, text, text, jsonb, text, text, text, text, jsonb, text)
  TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación contra producción, con limpieza
-- ═══════════════════════════════════════════════════════════════════════════
DO $verif$
DECLARE
  v_slug     text;
  v_org      uuid;
  v_prod     uuid;
  v_items    jsonb;
  v_r1       jsonb;
  v_r2       jsonb;
  v_ordenes  int;
  v_restos   int;
BEGIN
  SELECT s.slug, s.org_id INTO v_slug, v_org
    FROM public.ecommerce_stores s WHERE s.is_active LIMIT 1;
  IF v_slug IS NULL THEN
    RAISE NOTICE 'H1b: sin tienda activa, no se puede verificar'; RETURN;
  END IF;

  SELECT p.id INTO v_prod FROM public.products p
   WHERE p.org_id = v_org AND p.is_active AND COALESCE(p.stock, 0) > 2
   LIMIT 1;
  IF v_prod IS NULL THEN
    RAISE NOTICE 'H1b: sin producto activo con stock, no se puede verificar';
    RETURN;
  END IF;

  v_items := jsonb_build_array(
    jsonb_build_object('product_id', v_prod, 'quantity', 1));

  -- Primer intento: crea la orden.
  v_r1 := public.create_store_order_idem(
    v_slug, v_items, 'ZZ Prueba Idem', 'zz-idem@ejemplo.invalid', NULL,
    NULL, 'transferencia', 'ZZ prueba idempotencia', NULL, NULL, NULL,
    'zz-clave-1');

  -- Segundo intento con la MISMA clave: no puede crear otra.
  v_r2 := public.create_store_order_idem(
    v_slug, v_items, 'ZZ Prueba Idem', 'zz-idem@ejemplo.invalid', NULL,
    NULL, 'transferencia', 'ZZ prueba idempotencia', NULL, NULL, NULL,
    'zz-clave-1');

  ASSERT v_r1->>'order_number' = v_r2->>'order_number',
    format('el reintento devolvio otra orden: %s vs %s',
           v_r1->>'order_number', v_r2->>'order_number');
  ASSERT (v_r2->>'reintento')::boolean, 'el reintento deberia venir marcado';

  SELECT count(*) INTO v_ordenes FROM public.ecommerce_orders
   WHERE org_id = v_org AND customer_email = 'zz-idem@ejemplo.invalid';
  ASSERT v_ordenes = 1,
    format('se crearon %s ordenes con el mismo carrito y la misma clave', v_ordenes);

  RAISE NOTICE 'H1b OK: dos llamadas, orden % unica', v_r1->>'order_number';

  -- ── Limpieza ───────────────────────────────────────────────────────────
  DELETE FROM public.stock_reservations
   WHERE order_id IN (SELECT id FROM public.ecommerce_orders
                       WHERE customer_email = 'zz-idem@ejemplo.invalid');
  DELETE FROM public.ecommerce_orders WHERE customer_email = 'zz-idem@ejemplo.invalid';
  DELETE FROM public.idempotency_keys
   WHERE org_id = v_org AND operacion = 'create_store_order' AND clave = 'zz-clave-1';

  SELECT (SELECT count(*) FROM public.ecommerce_orders
           WHERE customer_email = 'zz-idem@ejemplo.invalid')
       + (SELECT count(*) FROM public.idempotency_keys WHERE clave = 'zz-clave-1')
    INTO v_restos;
  RAISE NOTICE 'H1b restos: %', v_restos;
  ASSERT v_restos = 0, format('quedaron %s restos', v_restos);
END;
$verif$;
