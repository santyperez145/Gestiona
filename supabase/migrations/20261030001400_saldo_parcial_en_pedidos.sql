-- Saldo a favor parcial en los pedidos online (2026-10-30).
--
-- Hasta acá el saldo a favor servía online sólo si cubría todo el total
-- (20261030000200). El caso típico de un cambio es el contrario: algo más
-- caro, con diferencia a pagar. Ahora el comprador logueado aplica su saldo a
-- un pedido pendiente de transferencia o efectivo y paga sólo lo que falta.
--
--   · `ecommerce_orders.saldo_aplicado_ars`: cuánto del total se pagó con
--     saldo. El pedido conserva su total (el saldo es un medio de pago, no un
--     descuento: se factura completo).
--   · `aplicar_saldo_a_pedido`: el comprador lo aplica una sola vez, con la
--     misma cerradura por cliente que el checkout; si cubre todo, el pedido
--     queda pagado en el acto.
--   · Si el pedido falla, se reintegra o se cancela sin pagar, el saldo usado
--     vuelve al cliente una sola vez (también el de un pedido pagado entero
--     con saldo que después se reintegra).
--   · Al confirmarse el pago, cada venta lleva su parte en saldo y el resto en
--     el medio (`split_payments`), y el asiento del pedido manda esa parte a
--     Deudores por ventas (1.2.01) y sólo el resto al medio: el banco o la
--     caja no reciben lo que pagó el saldo.
--   · El comprador ve en su pedido cuánto pagó con saldo y cuánto le falta
--     (`get_store_order_secure` suma `saldo_aplicado` al final).
--
-- Mercado Pago queda para el paso siguiente: cobrar sólo la diferencia
-- necesita la función de cobro (store-pay) y un pago real para verificarlo.

BEGIN;

ALTER TABLE public.ecommerce_orders
  ADD COLUMN IF NOT EXISTS saldo_aplicado_ars numeric(14,2) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ecommerce_orders_saldo_aplicado_check') THEN
    ALTER TABLE public.ecommerce_orders ADD CONSTRAINT ecommerce_orders_saldo_aplicado_check
      CHECK (saldo_aplicado_ars >= 0 AND saldo_aplicado_ars <= COALESCE(total, 0) + 0.01);
  END IF;
END $$;
COMMENT ON COLUMN public.ecommerce_orders.saldo_aplicado_ars IS
  'Parte del total pagada con saldo a favor (aplicar_saldo_a_pedido). El total no cambia: se factura completo.';

CREATE OR REPLACE FUNCTION public.mark_store_order_paid(
  p_order_id uuid,
  p_payment_id text DEFAULT NULL,
  p_method text DEFAULT 'mercado_pago'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order       record;
  v_item        jsonb;
  v_prod        record;
  v_variant_id  uuid;
  v_qty         int;
  v_owner       uuid;
  v_customer_id uuid;
  v_rate        numeric;
  v_cost_ars    numeric;
  v_profit      numeric;
  v_ventas      int := 0;
  v_a_cuenta    boolean := p_method = 'cuenta_corriente';
  v_sale_id     uuid;
  v_deudor      text;
  -- Saldo a favor aplicado al pedido (20261030001400): parte de lo cobrado.
  v_saldo       numeric := 0;
  v_items_total numeric := 0;
  v_n_items     int := 0;
  v_i           int := 0;
  v_restante    numeric := 0;
  v_parte       numeric;
  v_split       jsonb;
BEGIN
  -- Dos webhooks aprobados no pueden crear el mismo ticket: la cerradura es
  -- la fila de la orden y el segundo lector ve payment_status = paid.
  SELECT * INTO v_order
  FROM public.ecommerce_orders
  WHERE id = p_order_id
  FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Orden no encontrada';
  END IF;
  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'ya_procesada', true);
  END IF;
  IF v_order.payment_status IN ('refunded', 'charged_back') THEN
    RAISE EXCEPTION 'El pago de la orden fue revertido; creá una orden nueva para cobrarla'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_a_cuenta THEN
    -- A cuenta corriente, la deuda es del cliente aprobado, no de uno que se
    -- adivine por email (20261023000600).
    SELECT sc.customer_id, c.name INTO v_customer_id, v_deudor
      FROM public.store_customers sc
      JOIN public.customers c ON c.id = sc.customer_id
     WHERE sc.id = v_order.store_customer_id AND sc.org_id = v_order.org_id;
    IF v_customer_id IS NULL THEN
      RAISE EXCEPTION 'El pedido no está vinculado a un cliente mayorista: no se puede cargar a cuenta corriente'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    BEGIN
      v_customer_id := public.upsert_customer_from_order(v_order.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'upsert_customer_from_order falló antes de crear ventas para %: %', p_order_id, SQLERRM;
      v_customer_id := NULL;
    END;
  END IF;

  -- Con saldo a favor aplicado, cada venta lleva su parte en saldo y el resto
  -- en el medio con que se pagó la diferencia (el libro y los reportes lo
  -- leen de split_payments). Pagado entero con saldo, el medio ya es el saldo.
  IF NOT v_a_cuenta AND p_method IS DISTINCT FROM 'saldo_a_favor' AND COALESCE(v_order.saldo_aplicado_ars, 0) > 0 THEN
    SELECT COALESCE(sum((x->>'total')::numeric), 0), count(*) INTO v_items_total, v_n_items
      FROM jsonb_array_elements(v_order.items) x;
    v_saldo := LEAST(v_order.saldo_aplicado_ars, v_items_total);
    v_restante := v_saldo;
  END IF;

  SELECT m.user_id INTO v_owner
  FROM public.memberships m
  WHERE m.org_id = v_order.org_id AND m.role = 'owner'
  ORDER BY m.joined_at LIMIT 1;

  SELECT COALESCE(exchange_rate, 1) INTO v_rate
  FROM public.settings WHERE org_id = v_order.org_id;
  v_rate := COALESCE(v_rate, 1);

  -- Esta función sólo la llaman funciones del servidor (no tiene EXECUTE para
  -- usuarios): marca la transacción como cobro del servidor para la guardia
  -- de `sales`. Sin esto, «Confirmar cobro» de una transferencia, que llama
  -- un comerciante logueado, chocaba siempre con la guardia (visto el 23/10).
  PERFORM set_config('nerqia.cobro_servidor', 'on', true);

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_order.items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 1);
    v_variant_id := NULLIF(v_item->>'variant_id', '')::uuid;

    SELECT id, name, total_cost_usd
      INTO v_prod
    FROM public.products
    WHERE id = (v_item->>'product_id')::uuid
      AND org_id = v_order.org_id
    FOR UPDATE;
    IF v_prod.id IS NULL THEN
      RAISE EXCEPTION 'El producto de la orden ya no pertenece a la organización';
    END IF;
    IF v_variant_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.product_variants v
      WHERE v.id = v_variant_id AND v.product_id = v_prod.id AND v.org_id = v_order.org_id
    ) THEN
      RAISE EXCEPTION 'La variante de la orden ya no pertenece al producto';
    END IF;

    v_i := v_i + 1;
    v_split := NULL;
    IF v_saldo > 0 THEN
      -- Proporcional al renglón; el último se lleva lo que quede del redondeo.
      v_parte := CASE WHEN v_i = v_n_items THEN v_restante
                      ELSE round((v_item->>'total')::numeric * v_saldo / NULLIF(v_items_total, 0), 2) END;
      v_parte := LEAST(GREATEST(COALESCE(v_parte, 0), 0), (v_item->>'total')::numeric, v_restante);
      v_restante := v_restante - v_parte;
      IF v_parte > 0 THEN
        v_split := jsonb_build_array(
          jsonb_build_object('method', 'saldo_a_favor', 'amount', v_parte),
          jsonb_build_object('method', p_method, 'amount', (v_item->>'total')::numeric - v_parte));
      END IF;
    END IF;

    v_cost_ars := COALESCE(v_prod.total_cost_usd, 0) * v_rate;
    v_profit := (v_item->>'unit_price')::numeric * v_qty - v_cost_ars * v_qty;
    INSERT INTO public.sales (
      org_id, user_id, product_id, variant_id, location_id, product_name, quantity,
      unit_price_ars, total_ars, cost_per_unit_usd, cost_of_goods_ars,
      profit_ars, profit_usd, customer_id, customer_name, date, paid,
      payment_method, source, ecommerce_order_id, split_payments
    ) VALUES (
      v_order.org_id, v_owner, v_prod.id, v_variant_id, v_order.fulfillment_location_id,
      v_item->>'name', v_qty,
      (v_item->>'unit_price')::numeric, (v_item->>'total')::numeric,
      COALESCE(v_prod.total_cost_usd, 0), round(v_cost_ars * v_qty, 2),
      v_profit, CASE WHEN v_rate > 0 THEN v_profit / v_rate ELSE 0 END,
      v_customer_id, COALESCE(v_deudor, v_order.customer_name), now(), NOT v_a_cuenta,
      p_method, 'tienda_online', v_order.id, v_split
    )
    RETURNING id INTO v_sale_id;

    -- Como un fiado de la caja: venta sin cobrar y su deuda. El límite de
    -- crédito lo vuelve a controlar el trigger de `debts`.
    IF v_a_cuenta THEN
      INSERT INTO public.debts (
        user_id, org_id, sale_id, customer_id, customer_name,
        amount_ars, paid_ars, remaining_ars, description, date, status
      ) VALUES (
        v_owner, v_order.org_id, v_sale_id, v_customer_id, COALESCE(v_deudor, v_order.customer_name),
        (v_item->>'total')::numeric, 0, (v_item->>'total')::numeric,
        format('Pedido %s: %sx %s', v_order.order_number, v_qty, v_item->>'name'),
        now(), 'pending'
      );
    END IF;
    v_ventas := v_ventas + 1;
  END LOOP;
  PERFORM set_config('nerqia.cobro_servidor', '', true);

  UPDATE public.ecommerce_orders
     SET payment_status = 'paid',
         fulfillment_status = CASE WHEN fulfillment_status = 'pending' THEN 'processing' ELSE fulfillment_status END,
         payment_id = COALESCE(payment_id, p_payment_id),
         updated_at = now()
   WHERE id = p_order_id;

  IF v_owner IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notifications (user_id, org_id, title, message, type)
      VALUES (
        v_owner, v_order.org_id,
        CASE WHEN v_a_cuenta THEN 'Pedido a cuenta corriente aprobado' ELSE 'Pedido pagado en la tienda' END,
        format(CASE WHEN v_a_cuenta THEN '%s compró a cuenta corriente %s (pedido %s)' ELSE '%s pagó %s (pedido %s)' END,
               COALESCE(v_deudor, v_order.customer_name),
               to_char(v_order.total, 'FM$999G999G999'), v_order.order_number),
        'ecommerce'
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'ventas_creadas', v_ventas, 'customer_id', v_customer_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_store_order_paid(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ledger_asentar_orden_pagada(p_evento jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org      uuid;
  v_orden    uuid;
  v_o        public.ecommerce_orders;
  v_pt       public.payment_transactions;
  v_cuenta   text;
  v_com_mp   numeric := 0;
  v_com_plat numeric := 0;
  v_cobrado  numeric;
  v_envio    numeric;
  v_iva      numeric;
  v_ventas   numeric;
  v_ya       uuid;
  v_lineas   jsonb;
  v_meta     jsonb := '{}'::jsonb;
  v_costo      numeric := 0;
  v_tc         numeric;
  v_tc_fuente  text;
  v_sin_costo  int := 0;
  v_lineas_mov int := 0;
  v_meta_costo jsonb;
  v_metodo_raro text;
  v_fecha       date;
  -- Saldo a favor aplicado (20261030001400): esa parte no entró por el medio.
  v_saldo       numeric := 0;
BEGIN
  v_org   := NULLIF(p_evento->>'org_id', '')::uuid;
  v_orden := NULLIF(p_evento#>>'{data,order_id}', '')::uuid;

  -- `ecommerce_orders` no tiene columna de fecha de pago: `updated_at` cambia
  -- con cualquier edicion posterior y no sirve. El evento si sabe cuando paso
  -- —lo emite el trigger en el mismo momento en que payment_status pasa a
  -- 'paid'— y es inmutable. Fechar con CURRENT_DATE ponia el cobro el dia en
  -- que el outbox lo proceso.
  v_fecha := COALESCE(
    NULLIF(p_evento->>'occurred_at','')::timestamptz::date,
    CURRENT_DATE);

  IF v_org IS NULL OR v_orden IS NULL THEN
    RAISE EXCEPTION 'ledger_asentar_orden_pagada: el evento no trae org_id u order_id';
  END IF;

  -- ⚠️ La guarda de idempotencia. Va PRIMERO y mira el libro, no una bandera
  -- en la orden: la verdad de si ya se asentó está en el libro.
  SELECT e.id INTO v_ya FROM public.ledger_entries e
   WHERE e.org_id = v_org AND e.referencia_tipo = 'orden'
     AND e.referencia_id = v_orden AND e.anulado_por IS NULL AND e.anula_a IS NULL
   LIMIT 1;
  IF v_ya IS NOT NULL THEN
    RETURN v_ya;
  END IF;

  SELECT * INTO v_o FROM public.ecommerce_orders WHERE id = v_orden;
  IF v_o.id IS NULL THEN
    RAISE EXCEPTION 'La orden % no existe', v_orden;
  END IF;

  -- El plan tiene que existir. Se siembra al vuelo y es idempotente: una
  -- organización nueva no puede quedarse sin poder asentar su primera venta.
  PERFORM public.ledger_plan_default(v_org);

  -- Dónde entra la plata según cómo pagó. Un cobro por transferencia que se
  -- asiente en "MercadoPago a liquidar" hace que la conciliación no cierre
  -- nunca.
  -- H8: el mapeo vive en `cuenta_de_cobro`, compartido con el consumidor del
  -- mostrador. Antes estaba escrito acá adentro, y agregar el POS con su propio
  -- CASE habría dado dos tablas de equivalencias para la misma pregunta.
  v_cuenta := public.cuenta_de_cobro(v_o.payment_method);
  IF v_cuenta IS NULL THEN
    -- Un método sin cuenta asignada entra igual, pero deja rastro: si se fuera
    -- en silencio a "valores a liquidar", la conciliación no cerraría y no
    -- habría con qué averiguar por qué.
    v_metodo_raro := v_o.payment_method;
    RAISE WARNING 'ledger: metodo de cobro sin cuenta asignada en la orden %: %',
      v_o.order_number, v_o.payment_method;
    v_cuenta := '1.1.03';
  END IF;

  -- Las comisiones reales, si hay registro del cobro. Sin registro son cero, y
  -- queda anotado en el asiento que se asentó sin datos del procesador.
  SELECT * INTO v_pt FROM public.payment_transactions
   WHERE org_id = v_org AND source = 'ecommerce' AND source_id = v_orden
   ORDER BY created_at DESC LIMIT 1;

  IF v_pt.id IS NOT NULL THEN
    -- El IVA de la comisión va junto con la comisión: para un monotributista es
    -- costo, y para un responsable inscripto es crédito fiscal que hoy este
    -- ledger todavía no separa. Queda anotado como pendiente en vez de
    -- inventar una cuenta que nadie concilia.
    v_com_mp   := ROUND(COALESCE(v_pt.provider_fee, 0) + COALESCE(v_pt.provider_fee_iva, 0), 2);
    v_com_plat := ROUND(COALESCE(v_pt.platform_fee, 0), 2);
    v_meta := jsonb_build_object(
      'payment_transaction_id', v_pt.id,
      'neto_informado', v_pt.net_amount,
      'provider', v_pt.provider,
      'correlation_id', v_pt.correlation_id);
  ELSE
    v_meta := jsonb_build_object('sin_registro_de_cobro', true);
  END IF;

  v_cobrado := ROUND(COALESCE(v_o.total, 0), 2);
  -- Pagado entero con saldo, la cuenta ya es la del saldo (1.2.01).
  IF v_cuenta IS DISTINCT FROM '1.2.01' THEN
    v_saldo := LEAST(ROUND(COALESCE(v_o.saldo_aplicado_ars, 0), 2), v_cobrado);
  END IF;
  v_envio   := ROUND(GREATEST(COALESCE(v_o.shipping_cost, 0), 0), 2);
  v_iva     := ROUND(GREATEST(COALESCE(v_o.tax_amount, 0), 0), 2);
  -- Ventas es el residuo: así los haber suman exactamente el total cobrado sin
  -- depender de que tres redondeos coincidan.
  v_ventas  := ROUND(v_cobrado - v_envio - v_iva, 2);

  IF v_cobrado <= 0 THEN
    RAISE EXCEPTION 'La orden % tiene total %; no hay nada que asentar', v_o.order_number, v_cobrado;
  END IF;

  -- Lo que entra es lo cobrado menos lo que se quedan otros. Se calcula como
  -- residuo y no se toma `net_amount` del procesador: el asiento tiene que
  -- cuadrar por construcción. Si el neto informado difiere, queda la diferencia
  -- anotada en la metadata, que es donde se puede investigar.
  IF v_pt.id IS NOT NULL
     AND abs(COALESCE(v_pt.net_amount, 0) - (v_cobrado - v_com_mp - v_com_plat)) > 1 THEN
    v_meta := v_meta || jsonb_build_object(
      'descuadre_con_el_procesador',
      COALESCE(v_pt.net_amount, 0) - (v_cobrado - v_com_mp - v_com_plat));
    RAISE WARNING 'ledger: el neto informado por el procesador no coincide con el residuo en la orden %',
      v_o.order_number;
  END IF;

  -- ── H7: el costo de lo vendido ─────────────────────────────────────────
  --
  -- Sin esto el resultado del periodo es ingresos menos gastos SIN el costo de
  -- la mercaderia, que es el numero mas importante del negocio. Un margen
  -- bruto que ignora el costo no esta incompleto: esta mal, y mal para el lado
  -- optimista.
  --
  -- La fuente es `stock_movements`, no `products`: el movimiento guarda el
  -- costo del momento en que se vendio. Leer el costo de hoy haria que una
  -- lista de precios nueva reescribiera el margen de ventas viejas.
  SELECT COALESCE(SUM(ABS(m.quantity) * COALESCE(m.unit_cost_usd, 0)), 0),
         count(*),
         count(*) FILTER (WHERE COALESCE(m.unit_cost_usd, 0) <= 0)
    INTO v_costo, v_lineas_mov, v_sin_costo
    FROM public.stock_movements m
   WHERE m.org_id = v_org
     -- ⚠️ El movimiento de stock NO referencia la orden: referencia la VENTA
     -- que la orden generó. Medido el 2026-08-25: los 34 movimientos que hay
     -- tienen `reference_type = 'sale'` y `reference_id` de `sales`; ninguno
     -- apunta a una orden.
     --
     -- Con el lookup anterior —sólo `reference_id = v_orden`— este SELECT
     -- devolvía **cero movimientos para toda orden online**, el asiento salía
     -- sin costo de mercadería y el resultado del período quedaba mejor de lo
     -- que es. No fallaba: sólo emitía un WARNING que nadie lee.
     --
     -- Se conserva la comparación directa por si algún camino futuro referencia
     -- la orden, y se agrega la que corresponde hoy.
     AND (m.reference_id = v_orden
          OR m.reference_id IN (SELECT s.id FROM public.sales s
                                 WHERE s.ecommerce_order_id = v_orden));

  -- El costo esta en dolares y el libro en pesos. Se busca la cotizacion del
  -- dia en `exchange_rates`; si no esta —hoy la tabla esta vacia— se usa la de
  -- la organizacion, y **queda anotado cual se uso**. Un asiento que no dice
  -- con que tipo de cambio se armo no se puede auditar despues.
  SELECT er.usd_ars INTO v_tc
    FROM public.exchange_rates er
   WHERE er.org_id = v_org AND er.date <= CURRENT_DATE AND COALESCE(er.usd_ars, 0) > 0
   ORDER BY er.date DESC LIMIT 1;

  IF v_tc IS NOT NULL THEN
    v_tc_fuente := 'exchange_rates';
  ELSE
    SELECT s.exchange_rate INTO v_tc FROM public.settings s WHERE s.org_id = v_org LIMIT 1;
    v_tc_fuente := 'settings.exchange_rate';
  END IF;

  -- ⚠️ Sin cotizacion, este COALESCE convertia "no se cuanto vale el dolar" en
  -- "el costo es cero" y el asiento salia sin costo de mercaderia, callado.
  -- Es el mismo antipatron que GREATEST(0, ...): tapar el dato en vez de
  -- mostrarlo. No puede hacer fallar el cobro, pero tiene que dejar rastro.
  IF COALESCE(v_tc, 0) <= 0 AND v_costo > 0 THEN
    v_meta_costo := v_meta_costo || jsonb_build_object('sin_tipo_de_cambio', true);
    RAISE WARNING 'ledger: la orden % no tiene tipo de cambio; el asiento sale SIN costo de mercaderia y el margen queda mejor de lo que es', v_o.order_number;
  END IF;

  v_costo := public.redondear_moneda(v_costo * COALESCE(v_tc, 0), 'ARS');

  -- Que falte el costo de una linea no puede hacer fallar el cobro, pero
  -- tampoco puede pasar desapercibido: el margen saldria mejor de lo que es.
  -- Queda en la metadata del asiento, que es donde se investiga.
  v_meta_costo := jsonb_build_object(
    'tipo_cambio', v_tc, 'tipo_cambio_fuente', v_tc_fuente,
    'movimientos', v_lineas_mov, 'movimientos_sin_costo', v_sin_costo);

  IF v_lineas_mov = 0 THEN
    v_meta_costo := v_meta_costo || jsonb_build_object('sin_movimientos_de_stock', true);
    RAISE WARNING 'ledger: la orden % no tiene movimientos de stock; se asienta sin costo de ventas',
      v_o.order_number;
  ELSIF v_sin_costo > 0 THEN
    RAISE WARNING 'ledger: % de % lineas de la orden % no tienen costo cargado',
      v_sin_costo, v_lineas_mov, v_o.order_number;
  END IF;

  -- Va ANTES de armar las lineas: `v_meta` se copia dentro de la partida del
  -- cobro, asi que agregarle algo despues no tendria efecto sobre el asiento.
  -- Y tiene que quedar aunque el costo sea cero: "esta orden se asento sin
  -- costo" es exactamente el dato que hay que poder encontrar despues.
  v_meta := v_meta || jsonb_build_object('costo_de_ventas', v_meta_costo);

  IF v_metodo_raro IS NOT NULL THEN
    v_meta := v_meta || jsonb_build_object('metodo_no_mapeado', v_metodo_raro);
  END IF;

  v_lineas := jsonb_build_array(
    jsonb_build_object('cuenta', v_cuenta, 'debe', v_cobrado - v_saldo - v_com_mp - v_com_plat,
                       'detalle', 'Cobro orden ' || v_o.order_number, 'metadata', v_meta),
    jsonb_build_object('cuenta', '1.2.01', 'debe', v_saldo,
                       'detalle', 'Saldo a favor aplicado a la orden ' || v_o.order_number),
    jsonb_build_object('cuenta', '5.2.01', 'debe', v_com_mp,
                       'detalle', 'Comision del medio de pago'),
    jsonb_build_object('cuenta', '5.2.02', 'debe', v_com_plat,
                       'detalle', 'Comision de plataforma'),
    jsonb_build_object('cuenta', '4.1.02', 'haber', v_envio,
                       'detalle', 'Envio facturado'),
    jsonb_build_object('cuenta', '4.1.01', 'haber', v_ventas,
                       'detalle', 'Venta neta de IVA'),
    jsonb_build_object('cuenta', '2.1.02', 'haber', v_iva,
                       'detalle', 'IVA debito fiscal'));

  -- Las dos partidas del costo van en el MISMO asiento y no en uno aparte:
  -- netean entre si, asi que el asiento sigue cuadrando, y la guarda de
  -- idempotencia —que busca un asiento por orden— sigue valiendo. Con un
  -- asiento separado, la guarda creeria que ya se asento todo.
  IF v_costo > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(
      jsonb_build_object('cuenta', '5.1.01', 'debe', v_costo,
                         'detalle', 'Costo de la mercaderia vendida',
                         'metadata', v_meta_costo),
      jsonb_build_object('cuenta', '1.3.01', 'haber', v_costo,
                         'detalle', 'Salida de mercaderia'));
  END IF;


  RETURN public.ledger_asentar(
    p_org         := v_org,
    p_descripcion := 'Venta ' || v_o.order_number || ' cobrada',
    p_lineas      := v_lineas,
    p_fecha       := v_fecha,
    p_ref_tipo    := 'orden',
    p_ref_id      := v_orden);
END;
$function$;

DROP FUNCTION IF EXISTS public.get_store_order_secure(text, text, text, text);
CREATE FUNCTION public.get_store_order_secure(
  p_slug text,
  p_order_number text,
  p_access_token text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS TABLE (
  order_number text,
  customer_name text,
  customer_email text,
  items jsonb,
  subtotal numeric,
  shipping_cost numeric,
  total numeric,
  payment_method text,
  payment_status text,
  fulfillment_status text,
  shipping_address jsonb,
  created_at timestamptz,
  access_token text,
  bank_holder text,
  bank_name text,
  bank_cbu text,
  bank_alias text,
  carrier text,
  shipping_service text,
  saldo_aplicado numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_email text := lower(btrim(COALESCE(p_email, '')));
BEGIN
  IF v_email <> '' AND NOT public.rate_limit_publico(
    'store_order_access',
    lower(COALESCE(p_slug, '?')) || ':' || COALESCE(p_order_number, '?'),
    8,
    interval '10 minutes'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    o.order_number,
    o.customer_name,
    o.customer_email,
    o.items,
    o.subtotal,
    o.shipping_cost,
    o.total,
    o.payment_method,
    o.payment_status,
    o.fulfillment_status,
    o.shipping_address,
    o.created_at,
    o.public_access_token::text,
    NULLIF(btrim(COALESCE(st.bank_holder, '')), ''),
    NULLIF(btrim(COALESCE(st.bank_name, '')), ''),
    NULLIF(btrim(COALESCE(st.bank_cbu, '')), ''),
    NULLIF(btrim(COALESCE(st.bank_alias, '')), ''),
    o.carrier,
    o.shipping_service,
    COALESCE(o.saldo_aplicado_ars, 0)
  FROM public.ecommerce_orders o
  JOIN public.ecommerce_stores s ON s.id = o.store_id
  LEFT JOIN public.settings st ON st.org_id = s.org_id
  WHERE lower(s.slug) = lower(p_slug)
    AND o.order_number = p_order_number
    AND (
      (
        btrim(COALESCE(p_access_token, '')) <> ''
        AND o.public_access_token::text = btrim(p_access_token)
      )
      OR EXISTS (
        SELECT 1
          FROM public.store_customers sc
         WHERE sc.id = o.store_customer_id
           AND sc.user_id = auth.uid()
      )
      OR (
        v_email <> ''
        AND lower(btrim(o.customer_email)) = v_email
      )
    )
  LIMIT 1;
END;
$function$;

COMMENT ON FUNCTION public.get_store_order_secure(text, text, text, text) IS
  'Detalle de un pedido. carrier/shipping_service y saldo_aplicado al final (20261030001400).';
REVOKE ALL ON FUNCTION public.get_store_order_secure(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_order_secure(text, text, text, text) TO anon, authenticated;


-- ── El comprador aplica su saldo a un pedido pendiente ──────────────────
CREATE OR REPLACE FUNCTION public.aplicar_saldo_a_pedido(p_slug text, p_order_number text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_store record;
  v_order public.ecommerce_orders%ROWTYPE;
  v_cliente uuid;
  v_saldo numeric;
  v_aplicar numeric;
  v_total numeric;
  v_nombre text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Ingresá con tu cuenta para usar tu saldo a favor' USING ERRCODE = '42501';
  END IF;
  SELECT s.id, s.org_id INTO v_store FROM public.ecommerce_stores s
   WHERE lower(s.slug) = lower(btrim(p_slug)) AND s.is_active LIMIT 1;
  IF v_store.id IS NULL THEN
    RAISE EXCEPTION 'La tienda no está disponible' USING ERRCODE = '22023';
  END IF;
  v_cliente := public.cliente_del_comprador(v_store.id);
  IF v_cliente IS NULL THEN
    RAISE EXCEPTION 'No tenés saldo a favor en esta tienda' USING ERRCODE = '22023';
  END IF;
  -- La misma cerradura que el checkout: dos pedidos no usan el mismo saldo.
  PERFORM pg_advisory_xact_lock(hashtextextended('saldo_a_favor:' || v_cliente::text, 0));

  SELECT * INTO v_order FROM public.ecommerce_orders
   WHERE store_id = v_store.id AND order_number = btrim(COALESCE(p_order_number, '')) FOR UPDATE;
  -- El pedido tiene que ser suyo: por su cuenta de la tienda o por su email.
  -- Mismo mensaje si no existe o es ajeno: no se averigua qué compró otro.
  IF v_order.id IS NULL OR NOT (
       EXISTS (SELECT 1 FROM public.store_customers sc WHERE sc.id = v_order.store_customer_id AND sc.user_id = auth.uid())
       OR lower(btrim(COALESCE(v_order.customer_email, ''))) = lower(btrim(COALESCE((SELECT u.email FROM auth.users u WHERE u.id = auth.uid()), '-')))) THEN
    RAISE EXCEPTION 'No encontramos ese pedido en tu cuenta' USING ERRCODE = '22023';
  END IF;
  IF v_order.payment_status <> 'pending' THEN
    RAISE EXCEPTION 'El pedido ya no está pendiente de pago' USING ERRCODE = '22023';
  END IF;
  IF lower(btrim(COALESCE(v_order.payment_method, ''))) NOT IN ('transferencia', 'efectivo') THEN
    RAISE EXCEPTION 'El saldo a favor se combina con transferencia o efectivo' USING ERRCODE = '22023';
  END IF;
  v_total := round(COALESCE(v_order.total, 0), 2);
  IF COALESCE(v_order.saldo_aplicado_ars, 0) > 0 THEN
    RETURN jsonb_build_object('ok', true, 'aplicado', v_order.saldo_aplicado_ars,
                              'resta', v_total - v_order.saldo_aplicado_ars, 'ya_aplicado', true);
  END IF;

  SELECT COALESCE(sum(m.monto_ars), 0) INTO v_saldo FROM public.saldo_a_favor_movimientos m
   WHERE m.org_id = v_store.org_id AND m.customer_id = v_cliente;
  v_aplicar := LEAST(round(v_saldo, 2), v_total);
  IF v_aplicar <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'aplicado', 0, 'resta', v_total);
  END IF;

  SELECT c.name INTO v_nombre FROM public.customers c WHERE c.id = v_cliente;
  INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por, ecommerce_order_id)
  VALUES (v_store.org_id, v_cliente, COALESCE(v_nombre, v_order.customer_name), -v_aplicar,
          format('Aplicado al pedido %s', v_order.order_number), auth.uid(), v_order.id);
  UPDATE public.ecommerce_orders SET saldo_aplicado_ars = v_aplicar, updated_at = now() WHERE id = v_order.id;

  -- El saldo cubrió todo: pagado en el acto, como el checkout con saldo.
  IF v_aplicar >= v_total THEN
    PERFORM public.mark_store_order_paid(v_order.id, 'saldo-' || v_order.order_number, 'saldo_a_favor');
  END IF;
  RETURN jsonb_build_object('ok', true, 'aplicado', v_aplicar, 'resta', v_total - v_aplicar, 'pagado', v_aplicar >= v_total);
END;
$fn$;
REVOKE ALL ON FUNCTION public.aplicar_saldo_a_pedido(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aplicar_saldo_a_pedido(text, text) TO authenticated;

-- ── Si el pedido no se paga, el saldo usado vuelve ──────────────────────
CREATE OR REPLACE FUNCTION public.trg_pedido_devuelve_saldo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_neto numeric;
  v_cliente uuid;
  v_nombre text;
BEGIN
  IF NOT (NEW.payment_status IN ('failed', 'refunded', 'charged_back')
          OR (NEW.fulfillment_status = 'cancelled' AND NEW.payment_status IS DISTINCT FROM 'paid')) THEN
    RETURN NEW;
  END IF;
  -- Lo usado de saldo en este pedido, neto de lo ya devuelto: una sola vez.
  SELECT -COALESCE(sum(m.monto_ars), 0),
         (array_agg(m.customer_id ORDER BY m.created_at))[1],
         (array_agg(m.customer_name ORDER BY m.created_at))[1]
    INTO v_neto, v_cliente, v_nombre
    FROM public.saldo_a_favor_movimientos m
   WHERE m.ecommerce_order_id = NEW.id;
  IF COALESCE(v_neto, 0) <= 0 OR v_cliente IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.saldo_a_favor_movimientos (org_id, customer_id, customer_name, monto_ars, motivo, creado_por, ecommerce_order_id)
  VALUES (NEW.org_id, v_cliente, COALESCE(v_nombre, NEW.customer_name), v_neto,
          format('Devolución del saldo aplicado al pedido %s', NEW.order_number), auth.uid(), NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.trg_pedido_devuelve_saldo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_pedido_devuelve_saldo ON public.ecommerce_orders;
CREATE TRIGGER trg_pedido_devuelve_saldo
  AFTER UPDATE OF payment_status, fulfillment_status ON public.ecommerce_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_pedido_devuelve_saldo();

WITH c(function_name, audience, rationale) AS (VALUES
  ('aplicar_saldo_a_pedido', 'public_token', 'El comprador logueado aplica su saldo a su propio pedido pendiente de transferencia o efectivo, una vez y con cerradura por cliente.'),
  ('trg_pedido_devuelve_saldo', 'security_helper', 'Trigger: devuelve una vez el saldo usado por un pedido que falla, se reintegra o se cancela sin pagar.')
)
INSERT INTO public.security_function_contracts(function_name, identity_arguments, audience, rationale, definition_hash, reviewed_on)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), c.audience, c.rationale, md5(pg_get_functiondef(p.oid)), DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN c ON c.function_name = p.proname
 WHERE n.nspname = 'public'
ON CONFLICT (function_name, identity_arguments) DO UPDATE
  SET audience = EXCLUDED.audience, rationale = EXCLUDED.rationale,
      definition_hash = EXCLUDED.definition_hash, reviewed_on = EXCLUDED.reviewed_on;

-- Las funciones redefinidas que ya tenían contrato: misma audiencia, huella nueva.
UPDATE public.security_function_contracts sc
   SET definition_hash = md5(pg_get_functiondef(p.oid)), reviewed_on = DATE '2026-10-30'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
 WHERE sc.function_name = p.proname
   AND sc.identity_arguments = pg_get_function_identity_arguments(p.oid)
   AND p.proname IN ('mark_store_order_paid', 'ledger_asentar_orden_pagada', 'get_store_order_secure');

COMMIT;
