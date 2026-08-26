-- ═══════════════════════════════════════════════════════════════════════════
-- Sin cotizacion, el costo no es cero: es desconocido
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Complemento de 20260825000060. Al arreglar el lookup del costo de mercaderia
-- quedo a la vista la otra mitad: `COALESCE(v_tc, 0)` convierte "no hay tipo de
-- cambio cargado" en "el costo es cero", y el asiento sale sin costo sin que
-- nada lo diga. Es el mismo antipatron que `GREATEST(0, ...)`, que este repo
-- prohibe porque fue lo que dejo pasar el descuento de stock duplicado.
--
-- No puede hacer fallar el cobro —que falte una cotizacion no es motivo para
-- rechazar plata— pero ahora avisa y queda anotado en la metadata del asiento,
-- que es donde se investiga.
--
-- Se descubrio con la matriz de pagos: la organizacion ZZ no tenia cotizacion y
-- el asiento daba 5.1.01 = 0 sin ningun error.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

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
BEGIN
  v_org   := NULLIF(p_evento->>'org_id', '')::uuid;
  v_orden := NULLIF(p_evento#>>'{data,order_id}', '')::uuid;

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
    jsonb_build_object('cuenta', v_cuenta, 'debe', v_cobrado - v_com_mp - v_com_plat,
                       'detalle', 'Cobro orden ' || v_o.order_number, 'metadata', v_meta),
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
    p_fecha       := CURRENT_DATE,
    p_ref_tipo    := 'orden',
    p_ref_id      := v_orden);
END;
$function$
;
