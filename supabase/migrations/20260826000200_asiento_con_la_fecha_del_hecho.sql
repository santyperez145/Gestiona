-- ============================================================================
-- El asiento se fecha cuando pasó la venta, no cuando el outbox lo procesó
-- ============================================================================
--
-- ── Lo que se midió antes de tocar nada (2026-08-26) ──────────────────────
--
-- `ledger_entries` tenía **0 asientos** contra **34 ventas por $1.143.696** y
-- 2 órdenes cobradas. La lectura fácil era "el cableado está roto". No lo
-- está: se probó la cadena entera con una venta `ZZ` dentro de una
-- transacción revertida y funciona —venta → `sale_transactions` → evento
-- `venta.registrada` → outbox → asiento cuadrado, debe = haber = 14.000—.
--
-- El libro está vacío por una razón más simple: **las ventas son de abril a
-- julio y el motor de eventos es del 19 de agosto**. `sale_transactions` tiene
-- 0 filas y las 34 ventas tienen `sale_transaction_id` NULL. Nunca pasó
-- tráfico por el motor. Es lo que el ROADMAP ya anotaba como R11, ahora con la
-- causa exacta.
--
-- ── El bug que sí apareció ────────────────────────────────────────────────
--
-- `ledger_asentar_venta_pos` y `ledger_asentar_orden_pagada` fechaban el
-- asiento con **`CURRENT_DATE`**: el día en que el outbox procesó el evento,
-- no el día en que pasó la venta. La tercera —`ledger_asentar_liquidacion_pos`—
-- ya usaba `released_at`, así que el criterio correcto estaba y estas dos
-- quedaron afuera.
--
-- Consecuencias, en orden de cuánto duelen:
--
-- 1. **El resultado diario sale mal cuando hay un reintento.** El outbox
--    reintenta con backoff; un ticket de las 23:50 despachado a las 00:05
--    quedaba asentado al día siguiente. `ledger_resultado_diario` daba de
--    menos un día y de más el siguiente, sin que nada avisara.
-- 2. **Un backfill era imposible.** Las 34 ventas de abril a julio habrían
--    quedado todas fechadas hoy — inservible como historia contable, y
--    encima irreversible: el libro es inmutable y sólo se corrige
--    contraasentando.
--
-- ── De dónde sale la fecha ────────────────────────────────────────────────
--
-- Del hecho, no del procesamiento. Para el POS, `sale_transactions.occurred_at`.
-- Para la orden no hay columna de fecha de pago —`updated_at` cambia con
-- cualquier edición posterior— así que se usa el `occurred_at` del evento, que
-- lo emite el trigger en el mismo momento en que `payment_status` pasa a
-- `paid` y es inmutable. El payload ya lo traía; nadie lo estaba leyendo.
--
-- Las dos funciones se regeneran desde `pg_get_functiondef` con los cambios
-- insertados, no reescritas de memoria: son de 213 y 240 líneas y así es como
-- casi se rompe `mark_store_order_paid`.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ledger_asentar_venta_pos(p_evento jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org       uuid;
  v_tx        uuid;
  v_ya        uuid;
  v_source    text;
  v_ocurrido  timestamptz;
  v_fecha     date;
  v_emisor    text;
  v_habil     boolean;
  v_tasa_org  numeric;
  v_incluido  boolean;
  v_r         record;
  v_desglose  jsonb;
  v_cobrado   numeric := 0;
  v_iva       numeric := 0;
  v_costo     numeric := 0;
  v_ventas    numeric;
  v_lineas_n  int := 0;
  v_sin_costo int := 0;
  v_split     jsonb := '{}'::jsonb;   -- cuenta -> importe
  v_sp        jsonb;
  v_cuenta    text;
  v_metodo    text;
  v_desconoc  text[] := '{}';
  v_asignado  numeric := 0;
  v_resto     numeric;
  v_princ     text;
  v_lineas    jsonb := '[]'::jsonb;
  v_meta      jsonb;
  v_k         text;
BEGIN
  v_org := NULLIF(p_evento->>'org_id', '')::uuid;
  v_tx  := NULLIF(p_evento#>>'{data,transaction_id}', '')::uuid;
  IF v_org IS NULL OR v_tx IS NULL THEN
    RAISE EXCEPTION 'ledger_asentar_venta_pos: el evento no trae org_id o transaction_id';
  END IF;

  -- ⚠️ La guarda de idempotencia mira el libro, no una bandera en la venta:
  -- la verdad de si ya se asentó está en el libro.
  SELECT e.id INTO v_ya FROM public.ledger_entries e
   WHERE e.org_id = v_org AND e.referencia_tipo = 'venta_pos'
     AND e.referencia_id = v_tx AND e.anulado_por IS NULL AND e.anula_a IS NULL
   LIMIT 1;
  IF v_ya IS NOT NULL THEN RETURN v_ya; END IF;

  SELECT t.source, t.occurred_at INTO v_source, v_ocurrido
    FROM public.sale_transactions t WHERE t.id = v_tx;

  -- La fecha del asiento es la de la VENTA, no la del procesamiento. El
  -- outbox reintenta con backoff: un ticket de las 23:50 que se despacha a
  -- las 00:05 quedaba asentado al dia siguiente, y el resultado diario salia
  -- mal dos dias seguidos. Prioridad: cuando ocurrio la venta, si no cuando
  -- se emitio el evento, y recien despues hoy.
  v_fecha := COALESCE(
    v_ocurrido::date,
    NULLIF(p_evento->>'occurred_at','')::timestamptz::date,
    CURRENT_DATE);

  -- Las ventas que vienen de la tienda ya las asienta
  -- `ledger_asentar_orden_pagada` desde la orden. Asentarlas otra vez desde el
  -- renglón duplicaría el ingreso del mismo dinero.
  IF v_source = 'tienda_online' THEN RETURN NULL; END IF;

  PERFORM public.ledger_plan_default(v_org);

  SELECT s.tax_enabled, s.tax_iva_percent, s.tax_prices_include_iva, s.afip_tipo_emisor
    INTO v_habil, v_tasa_org, v_incluido, v_emisor
    FROM public.settings s WHERE s.org_id = v_org LIMIT 1;
  v_incluido := COALESCE(v_incluido, true);

  FOR v_r IN
    SELECT s.id, s.total_ars, s.cost_of_goods_ars, s.payment_method, s.paid,
           s.split_payments, s.product_id,
           COALESCE(p.tax_rate, v_tasa_org) AS tasa
      FROM public.sales s
      LEFT JOIN public.products p ON p.id = s.product_id
     WHERE s.sale_transaction_id = v_tx
  LOOP
    v_lineas_n := v_lineas_n + 1;
    v_cobrado  := v_cobrado + ROUND(COALESCE(v_r.total_ars, 0), 2);

    IF COALESCE(v_r.cost_of_goods_ars, 0) > 0 THEN
      v_costo := v_costo + ROUND(v_r.cost_of_goods_ars, 2);
    ELSE
      v_sin_costo := v_sin_costo + 1;
    END IF;

    -- El IVA, con la misma regla que las órdenes. Quién emite manda: un
    -- monotributista no discrimina cobre lo que cobre.
    IF public.discrimina_iva(v_emisor)
       AND COALESCE(v_habil, false) AND COALESCE(v_tasa_org, 0) > 0 THEN
      v_desglose := public.desglosar_iva(COALESCE(v_r.total_ars, 0), v_r.tasa, v_incluido);
      v_iva := v_iva + (v_desglose->>'iva')::numeric;
    END IF;

    -- ── Dónde entra la plata ───────────────────────────────────────────────
    --
    -- ⚠️ Fiado NO es caja. Una venta a cuenta corriente asentada como efectivo
    -- infla la caja del día y esconde el crédito: son los dos errores a la vez.
    -- `paid = false` manda sobre el método, siempre.
    IF v_r.paid IS FALSE OR v_r.payment_method = 'fiado' THEN
      v_split := jsonb_set(v_split, ARRAY['1.2.01'],
                   to_jsonb(COALESCE((v_split->>'1.2.01')::numeric, 0) + ROUND(COALESCE(v_r.total_ars,0),2)));
      v_asignado := v_asignado + ROUND(COALESCE(v_r.total_ars,0), 2);
      CONTINUE;
    END IF;

    -- Cobro dividido: se reparte de verdad. La forma es [{method, amount}].
    IF jsonb_typeof(v_r.split_payments) = 'array'
       AND jsonb_array_length(v_r.split_payments) > 0 THEN
      FOR v_sp IN SELECT * FROM jsonb_array_elements(v_r.split_payments) LOOP
        v_metodo := v_sp->>'method';
        v_cuenta := public.cuenta_de_cobro(v_metodo);
        IF v_cuenta IS NULL THEN
          v_desconoc := v_desconoc || v_metodo;
          v_cuenta := '1.1.01';
        END IF;
        v_split := jsonb_set(v_split, ARRAY[v_cuenta],
                     to_jsonb(COALESCE((v_split->>v_cuenta)::numeric, 0)
                              + ROUND(COALESCE((v_sp->>'amount')::numeric, 0), 2)));
        v_asignado := v_asignado + ROUND(COALESCE((v_sp->>'amount')::numeric, 0), 2);
      END LOOP;
    ELSE
      v_cuenta := public.cuenta_de_cobro(v_r.payment_method);
      IF v_cuenta IS NULL THEN
        v_desconoc := v_desconoc || v_r.payment_method;
        v_cuenta := '1.1.01';
      END IF;
      v_split := jsonb_set(v_split, ARRAY[v_cuenta],
                   to_jsonb(COALESCE((v_split->>v_cuenta)::numeric, 0) + ROUND(COALESCE(v_r.total_ars,0),2)));
      v_asignado := v_asignado + ROUND(COALESCE(v_r.total_ars,0), 2);
    END IF;
  END LOOP;

  -- ⚠️ Que el ticket no tenga renglones no es "un asiento en cero": es que el
  -- evento llegó antes que los datos. Se levanta la excepción para que el
  -- outbox reintente, en vez de dejar un asiento vacío que después nadie
  -- entiende.
  IF v_lineas_n = 0 THEN
    RAISE EXCEPTION 'La venta % todavia no tiene renglones', v_tx;
  END IF;

  IF v_cobrado <= 0 THEN
    -- Un ticket en cero no se asienta. Puede ser un canje o una corrección.
    RETURN NULL;
  END IF;

  v_iva    := public.redondear_moneda(v_iva, 'ARS');
  -- Ventas como residuo: los haber suman exactamente lo cobrado sin depender
  -- de que dos redondeos coincidan.
  v_ventas := ROUND(v_cobrado - v_iva, 2);

  -- ⚠️ El cobro dividido del POS reparte con `Math.round` por parte, así que
  -- las partes pueden no sumar el total. El asiento tiene que cuadrar igual:
  -- la diferencia va a la cuenta del método principal y **queda anotada**.
  -- Taparla sería exactamente el `GREATEST(0, ...)` que este repo prohíbe.
  v_resto := ROUND(v_cobrado - v_asignado, 2);
  IF v_resto <> 0 THEN
    SELECT public.cuenta_de_cobro(s.payment_method) INTO v_princ
      FROM public.sales s WHERE s.sale_transaction_id = v_tx LIMIT 1;
    v_princ := COALESCE(v_princ, '1.1.01');
    v_split := jsonb_set(v_split, ARRAY[v_princ],
                 to_jsonb(COALESCE((v_split->>v_princ)::numeric, 0) + v_resto));
    RAISE WARNING 'ledger: el reparto del cobro de la venta % no sumaba el total (dif %)', v_tx, v_resto;
  END IF;

  v_meta := jsonb_build_object(
    'renglones', v_lineas_n,
    'renglones_sin_costo', v_sin_costo,
    'source', v_source,
    'diferencia_de_reparto', v_resto);

  IF array_length(v_desconoc, 1) > 0 THEN
    -- Un método que no está mapeado no puede pasar en silencio: el importe
    -- entra igual pero a una cuenta que quizá no es la suya, y esto es lo
    -- único que permite encontrarlo después.
    v_meta := v_meta || jsonb_build_object('metodos_no_mapeados', to_jsonb(v_desconoc));
    RAISE WARNING 'ledger: metodos de cobro sin cuenta asignada en la venta %: %', v_tx, v_desconoc;
  END IF;

  IF v_sin_costo > 0 THEN
    RAISE WARNING 'ledger: % de % renglones de la venta % no tienen costo; el margen sale mejor de lo que es',
      v_sin_costo, v_lineas_n, v_tx;
  END IF;

  -- El debe: una partida por cuenta de cobro.
  FOR v_k IN SELECT jsonb_object_keys(v_split) LOOP
    IF (v_split->>v_k)::numeric <> 0 THEN
      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
        'cuenta', v_k, 'debe', (v_split->>v_k)::numeric,
        'detalle', 'Cobro venta de mostrador', 'metadata', v_meta));
    END IF;
  END LOOP;

  v_lineas := v_lineas || jsonb_build_array(
    jsonb_build_object('cuenta', '4.1.01', 'haber', v_ventas,
                       'detalle', 'Venta neta de IVA'),
    jsonb_build_object('cuenta', '2.1.02', 'haber', v_iva,
                       'detalle', 'IVA debito fiscal'));

  -- El costo va en el MISMO asiento: netea contra sí mismo, así que sigue
  -- cuadrando, y la guarda de idempotencia —un asiento por ticket— sigue
  -- valiendo. Con un asiento aparte, la guarda creería que ya está todo hecho.
  IF v_costo > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(
      jsonb_build_object('cuenta', '5.1.01', 'debe', v_costo,
                         'detalle', 'Costo de la mercaderia vendida'),
      jsonb_build_object('cuenta', '1.3.01', 'haber', v_costo,
                         'detalle', 'Salida de mercaderia'));
  END IF;

  RETURN public.ledger_asentar(
    p_org         := v_org,
    p_descripcion := 'Venta de mostrador',
    p_lineas      := v_lineas,
    p_fecha       := v_fecha,
    p_ref_tipo    := 'venta_pos',
    p_ref_id      := v_tx);
END;
$function$;

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
    p_fecha       := v_fecha,
    p_ref_tipo    := 'orden',
    p_ref_id      := v_orden);
END;
$function$;

-- ── Verificación ────────────────────────────────────────────────────────────
DO $verif$
DECLARE v_n int;
BEGIN
  -- 1. Ninguna de las dos vuelve a fechar con CURRENT_DATE en la llamada.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('ledger_asentar_venta_pos','ledger_asentar_orden_pagada')
     AND p.prosrc LIKE '%p_fecha       := CURRENT_DATE%';
  ASSERT v_n = 0, 'alguna sigue fechando con CURRENT_DATE: ' || v_n;

  -- 2. Las dos leen la fecha del hecho.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('ledger_asentar_venta_pos','ledger_asentar_orden_pagada')
     AND p.prosrc LIKE '%p_fecha       := v_fecha%';
  ASSERT v_n = 2, 'esperaba las 2 funciones fechando por el hecho, hay ' || v_n;

  -- 3. La de venta prioriza la fecha de la transaccion sobre la del evento.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='ledger_asentar_venta_pos'
     AND p.prosrc LIKE '%v_ocurrido::date%';
  ASSERT v_n = 1, 'la venta no usa sale_transactions.occurred_at';

  -- 4. La guarda de idempotencia sigue en pie: se mira el libro, no una bandera.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='ledger_asentar_venta_pos'
     AND p.prosrc LIKE '%referencia_tipo = ''venta_pos''%';
  ASSERT v_n = 1, 'se perdio la guarda de idempotencia al regenerar';

  RAISE NOTICE 'ZZ_OK el asiento se fecha por el hecho';
END
$verif$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260826000200', 'asiento_con_la_fecha_del_hecho') ON CONFLICT DO NOTHING;
