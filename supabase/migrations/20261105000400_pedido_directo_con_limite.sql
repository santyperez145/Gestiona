-- El pedido directo también tiene límite (2026-11-05).
--
-- Crear un pedido reserva stock sin cobrar nada. 20260819000040 puso el
-- límite (10 por minuto por IP, o por tienda sin IP) en create_store_order_idem,
-- que es lo que usa la tienda. Pero create_store_order sigue ejecutable por
-- anon —la tienda la usa de respaldo y las matrices la llaman— y no tenía
-- tope: un script la llamaba directo y dejaba la tienda sin disponible.
--
-- Misma función que 20261030000200 con el chequeo al principio, en un balde
-- propio ('checkout_directo') para que el camino idempotente no consuma dos
-- veces el mismo cupo. Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_store_order(
  p_slug text,
  p_items jsonb,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_shipping jsonb,
  p_payment_method text,
  p_notes text DEFAULT NULL,
  p_coupon text DEFAULT NULL,
  p_shipping_option text DEFAULT NULL,
  p_fiscal jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_store record;
  v_cliente uuid;
  v_resultado jsonb;
  v_limite numeric;
  v_comprometido numeric;
  v_a_cuenta boolean := lower(btrim(COALESCE(p_payment_method, ''))) = 'cuenta_corriente';
  v_con_saldo boolean := lower(btrim(COALESCE(p_payment_method, ''))) = 'saldo_a_favor';
  v_cliente_saldo uuid;
  v_saldo numeric;
  v_total numeric;
  v_order_id uuid;
BEGIN
  -- Límite propio (20261105000400): create_store_order_idem limitaba a 10 por
  -- minuto, pero ésta también se puede llamar directo y reservaba stock sin
  -- tope. Balde aparte para no contar dos veces el camino idempotente.
  IF NOT public.rate_limit_publico('checkout_directo', p_slug, 10, interval '1 minute') THEN
    RAISE EXCEPTION 'Demasiados intentos de compra seguidos. Esperá un minuto.'
      USING ERRCODE = '53400';
  END IF;

  SELECT store.id, store.org_id, store.mayorista_modo, store.mayorista_minimo_ars, store.mayorista_cuenta_corriente
    INTO v_store
  FROM public.ecommerce_stores store
  WHERE lower(store.slug) = lower(btrim(p_slug)) AND store.is_active
  LIMIT 1;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'Tienda no encontrada o inactiva' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('nerqia.store_id', v_store.id::text, true);

  -- Venta mayorista (20261023000600).
  v_cliente := public.cliente_mayorista_de_tienda(v_store.id);
  IF v_store.mayorista_modo = 'exclusivo' AND v_cliente IS NULL THEN
    RAISE EXCEPTION 'Esta tienda vende sólo a clientes mayoristas aprobados. Ingresá con tu cuenta o pedí el alta mayorista.'
      USING ERRCODE = '22023';
  END IF;
  IF v_a_cuenta AND (
       v_cliente IS NULL OR NOT v_store.mayorista_cuenta_corriente
       OR NOT COALESCE((SELECT c.cuenta_corriente_online FROM public.customers c WHERE c.id = v_cliente), false)
     ) THEN
    RAISE EXCEPTION 'La cuenta corriente no está habilitada para tu cuenta.' USING ERRCODE = '22023';
  END IF;

  -- Saldo a favor (20261030000200): sólo el comprador logueado con saldo, y
  -- una cerradura por cliente para que dos pedidos no lo usen dos veces.
  IF v_con_saldo THEN
    v_cliente_saldo := public.cliente_del_comprador(v_store.id);
    IF v_cliente_saldo IS NULL THEN
      RAISE EXCEPTION 'Ingresá con tu cuenta para pagar con tu saldo a favor.' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('saldo_a_favor:' || v_cliente_saldo::text, 0));
  END IF;

  v_resultado := public.create_store_order_core(
    p_slug, p_items, p_customer_name, p_customer_email, p_customer_phone,
    p_shipping, p_payment_method, p_notes, p_coupon, p_shipping_option, p_fiscal
  );

  -- Después del núcleo, con el subtotal ya calculado por la base: si no
  -- alcanza, la excepción deshace el pedido entero.
  IF v_cliente IS NOT NULL AND COALESCE(v_store.mayorista_minimo_ars, 0) > 0
     AND COALESCE((v_resultado->>'subtotal')::numeric, 0) < v_store.mayorista_minimo_ars THEN
    RAISE EXCEPTION 'La compra mínima mayorista es de $ %. Te faltan $ %.',
      replace(to_char(round(v_store.mayorista_minimo_ars), 'FM999,999,999,990'), ',', '.'),
      replace(to_char(round(v_store.mayorista_minimo_ars - COALESCE((v_resultado->>'subtotal')::numeric, 0)), 'FM999,999,999,990'), ',', '.')
      USING ERRCODE = '22023';
  END IF;

  IF v_a_cuenta THEN
    SELECT c.credit_limit_ars INTO v_limite FROM public.customers c WHERE c.id = v_cliente;
    IF v_limite IS NOT NULL THEN
      -- Incluye este pedido, que ya quedó pendiente a cuenta.
      v_comprometido := public.saldo_comprometido_cliente(v_cliente);
      IF v_comprometido > v_limite THEN
        RAISE EXCEPTION 'El pedido supera tu crédito disponible: te quedan $ % de $ %.',
          replace(to_char(GREATEST(round(v_limite - (v_comprometido - COALESCE((v_resultado->>'total')::numeric, 0))), 0), 'FM999,999,999,990'), ',', '.'),
          replace(to_char(round(v_limite), 'FM999,999,999,990'), ',', '.')
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  IF v_con_saldo THEN
    v_total := COALESCE((v_resultado->>'total')::numeric, 0);
    SELECT COALESCE(sum(m.monto_ars), 0) INTO v_saldo FROM public.saldo_a_favor_movimientos m
     WHERE m.org_id = v_store.org_id AND m.customer_id = v_cliente_saldo;
    IF v_saldo < v_total THEN
      RAISE EXCEPTION 'Tu saldo a favor ($ %) no alcanza para el total ($ %). Elegí otro medio de pago: el saldo lo podés usar en el local.',
        replace(to_char(round(v_saldo), 'FM999,999,999,990'), ',', '.'),
        replace(to_char(round(v_total), 'FM999,999,999,990'), ',', '.')
        USING ERRCODE = '22023';
    END IF;
    SELECT o.id INTO v_order_id FROM public.ecommerce_orders o
     WHERE o.store_id = v_store.id AND o.order_number = v_resultado->>'order_number';
    -- Medio de pago, no descuento: el pedido conserva su total y se factura completo.
    IF v_total > 0 THEN
      INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por, ecommerce_order_id)
      VALUES (v_store.org_id, v_cliente_saldo,
              COALESCE((SELECT c.name FROM public.customers c WHERE c.id = v_cliente_saldo), p_customer_name),
              -round(v_total, 2), format('Pago del pedido %s', v_resultado->>'order_number'), auth.uid(), v_order_id);
    END IF;
    PERFORM public.mark_store_order_paid(v_order_id, 'saldo-' || (v_resultado->>'order_number'), 'saldo_a_favor');
    v_resultado := v_resultado || jsonb_build_object('pagado_con_saldo', true);
  END IF;

  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.create_store_order(
  text, jsonb, text, text, text, jsonb, text, text, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_store_order(
  text, jsonb, text, text, text, jsonb, text, text, text, text, jsonb
) TO anon, authenticated;

UPDATE public.security_function_contracts sfc
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-11-05'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'create_store_order'
   AND sfc.function_name = p.proname
   AND sfc.identity_arguments = pg_get_function_identity_arguments(p.oid);

COMMIT;
