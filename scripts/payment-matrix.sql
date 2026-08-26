-- F0 — matriz destructiva segura del ciclo de pagos.
--
-- Usa una organización ZZ dentro de un sub-bloque transaccional. Al finalizar
-- fuerza los constraints diferidos y provoca un rollback controlado del
-- sub-bloque: las métricas sobreviven en variables PL/pgSQL, los datos no.

BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE zz_payment_matrix_result (
  scenario text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $matrix$
DECLARE
  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_user uuid;
  v_org uuid;
  v_store uuid;
  v_product uuid;
  v_order uuid;
  v_rejected_order uuid;
  v_rma uuid;
  v_first jsonb;
  v_duplicate jsonb;
  v_pending jsonb;
  v_approved jsonb;
  v_approved_duplicate jsonb;
  v_rejected jsonb;
  v_retry jsonb;
  v_refund_first jsonb;
  v_refund_retry jsonb;
  v_refund_state jsonb;
  v_refund_done jsonb;
  v_refund_duplicate jsonb;
  v_intent uuid;
  v_attempt uuid;
  v_rejected_attempt uuid;
  v_refund uuid;
  v_settlement uuid;
  v_settlement_duplicate uuid;
  v_contra uuid;
  v_etapas text;
  v_factura uuid;
  v_rma_grande uuid;
  v_refund_grande jsonb;
  v_proveedores jsonb;
  v_orden_pend uuid;
  v_intent_pend jsonb;
  v_estado_pend text;
  v_debe numeric;
  v_haber numeric;
  v_neto_cuenta numeric;
  v_fallo text;
  v_ledger uuid;
  v_correlation uuid;
  v_transaction_correlation uuid;
  v_ledger_correlation text;
  v_trace_stages integer;
  v_stock_after_payment integer;
  v_stock_after_refund integer;
  v_provider_fee numeric;
  v_provider_fee_iva numeric;
  v_ledger_fee numeric;
  v_count integer;
  v_leftovers integer;
  v_results jsonb := '[]'::jsonb;
BEGIN
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'La matriz necesita un usuario existente para el owner ZZ';
  END IF;

  BEGIN
    INSERT INTO public.organizations (name, slug, owner_user_id)
    VALUES ('ZZ matriz de pagos ' || v_suffix, 'zz-payment-matrix-' || v_suffix, v_user)
    RETURNING id INTO v_org;

    INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (v_org, v_user, 'owner');

    -- Habilita el ruteo sin crear ni leer una credencial: la matriz corta antes
    -- de la red y ensaya únicamente la autoridad de estados de Gestiona.
    INSERT INTO public.org_payment_providers (org_id, provider, habilitado, cuenta)
    VALUES (v_org, 'mercadopago', true, 'manual');

    -- ── Habilitado pero SIN token: no se ofrece ───────────────────────────
    --
    -- Este es el estado real tras revocar un OAuth: `org_payment_providers`
    -- queda habilitado y `payment_connections` vacío, porque `mp-connect` no
    -- toca la primera tabla. Si el checkout lo siguiera ofreciendo, el comprador
    -- llegaría al final con el carrito lleno y fallaría ahí — el peor lugar.
    --
    -- Se prueba ANTES de crear la credencial en vez de borrarla después: la
    -- matriz limpia por rollback y `paymentMatrixContract.test.ts` prohíbe
    -- los borrados sobre el esquema `public` justamente para que uno mal apuntado no
    -- pueda destruir datos reales. La guarda tiene razón; el test se adapta.
    --
    -- Devuelve filas, no jsonb: se compara la fila entera como texto para no
    -- depender del nombre de la columna.
    SELECT count(*) INTO v_count
      FROM public.pago_proveedores_para(v_org, 'tarjeta', 1000, 1, 'ARS') p
     WHERE lower(p::text) LIKE '%mercado%';
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'Se ofrece MercadoPago habilitado pero sin token: % proveedores', v_count;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'habilitado_sin_token', 'passed', true,
      'detail', 'el flag encendido sin credencial no ofrece el proveedor'
    ));

    -- ⚠️ El fixture decía 'sin credencial' y el camino feliz funcionaba igual:
    -- `pago_proveedores_para` miraba sólo el flag `habilitado`. Desde
    -- 20260825000020 también exige el token.
    INSERT INTO public.payment_connections (org_id, provider, external_id, access_token, live_mode)
    VALUES (v_org, 'mercadopago', 'zz-mp-' || v_suffix, 'ZZ-TOKEN-' || v_suffix, false);

    INSERT INTO public.ecommerce_stores (org_id, name, slug, is_active)
    VALUES (v_org, 'ZZ tienda matriz', 'zz-payment-matrix-' || v_suffix, true)
    RETURNING id INTO v_store;

    -- ⚠️ Sin tipo de cambio, el costo en pesos da CERO y el asiento sale sin
    -- costo de mercaderia sin que nada falle: `COALESCE(v_tc, 0)` convierte "no
    -- se la cotizacion" en "el costo es cero". El fixture lo carga para que la
    -- matriz pruebe el camino real y no el degradado.
    -- La cotizacion va en `exchange_rates`, que es la fuente primaria que
    -- consulta el ledger. No sirve `settings`: su `user_id` es UNICO, asi que
    -- la organizacion ZZ no puede tener su propia fila si reusa un usuario que
    -- ya tiene una.
    INSERT INTO public.exchange_rates (org_id, date, base_currency, usd_ars, eur_ars, brl_ars, source)
    VALUES (v_org, CURRENT_DATE, 'USD', 1600, 1700, 300, 'manual');

    -- ⚠️ Y la condicion frente al IVA. Desde 20260826000030 la columna no tiene
    -- default: sin declararla, `facturar_orden_pagada` se niega a emitir —que es
    -- lo correcto, no se factura bajo una identidad fiscal adivinada— y la
    -- etapa `invoice` de la traza no aparece.
    --
    -- El trigger de `organizations` ya creo la fila de settings de esta
    -- organizacion ZZ; solo hay que completarla.
    UPDATE public.settings SET afip_tipo_emisor = 'monotributo' WHERE org_id = v_org;

    INSERT INTO public.products (
      org_id, user_id, name, sale_price_ars, total_cost_usd, stock, is_active
    ) VALUES (
      v_org, v_user, 'ZZ producto matriz de pagos', 1000, 0.25, 5, true
    ) RETURNING id INTO v_product;

    INSERT INTO public.ecommerce_orders (
      org_id, store_id, order_number, customer_name, customer_email,
      items, subtotal, total, payment_method
    ) VALUES (
      v_org, v_store, 'ZZPAY-' || v_suffix, 'ZZ comprador',
      'zz-payment-' || v_suffix || '@invalid.test',
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product, 'name', 'ZZ producto matriz de pagos',
        'quantity', 1, 'unit_price', 1000, 'total', 1000
      )),
      1000, 1000, 'mercadopago'
    ) RETURNING id INTO v_order;

    -- Checkout + submit duplicado: una sola intención y un solo intento.
    v_first := public.pago_intento_preparar(
      v_order, 'mercadopago', 1, 'zz-checkout:' || v_suffix
    );
    v_duplicate := public.pago_intento_preparar(
      v_order, 'mercadopago', 1, 'zz-checkout:' || v_suffix
    );
    v_intent := (v_first->>'intent_id')::uuid;
    v_attempt := (v_first->>'attempt_id')::uuid;
    v_correlation := (v_first->>'correlation_id')::uuid;

    IF (v_duplicate->>'intent_id')::uuid <> v_intent
       OR (v_duplicate->>'attempt_id')::uuid <> v_attempt
       OR (v_duplicate->>'correlation_id')::uuid <> v_correlation
       OR COALESCE((v_duplicate->>'reusado')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'El submit duplicado creó otra operación';
    END IF;
    SELECT count(*) INTO v_count FROM public.payment_attempts WHERE intent_id = v_intent;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Hay % intentos para el mismo checkout', v_count; END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'checkout_idempotente', 'passed', true,
      'detail', 'misma clave, una intención y un intento'
    ));

    -- Timeout ambiguo: queda pendiente y el retry conserva la clave canónica.
    PERFORM public.pago_attempt_resultado(
      v_attempt, 'pendiente', NULL, NULL, NULL, NULL,
      'timeout simulado antes de conocer el resultado',
      jsonb_build_object('source', 'payment_matrix', 'outcome', 'unknown')
    );
    v_pending := public.pago_intento_preparar(
      v_order, 'mercadopago', 1, 'zz-checkout:' || v_suffix
    );
    SELECT count(*) INTO v_count FROM public.payment_attempts WHERE intent_id = v_intent;
    IF (v_pending->>'attempt_id')::uuid <> v_attempt OR v_count <> 1 THEN
      RAISE EXCEPTION 'El timeout abrió un segundo intento de cobro';
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'timeout_sin_doble_cobro', 'passed', true,
      'detail', 'estado ambiguo reutiliza el intento pendiente'
    ));

    -- Webhook aprobado repetido + settlement repetido + mark paid repetido.
    v_approved := public.pago_attempt_resultado(
      v_attempt, 'aprobado', 'zz-payment-' || v_suffix, 50, 0, 950,
      NULL, jsonb_build_object('source', 'payment_matrix', 'status', 'approved')
    );
    v_approved_duplicate := public.pago_attempt_resultado(
      v_attempt, 'aprobado', 'zz-payment-' || v_suffix, 50, 0, 950,
      NULL, jsonb_build_object('source', 'payment_matrix', 'status', 'approved')
    );
    IF COALESCE((v_approved_duplicate->>'repetido')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'El resultado aprobado repetido no fue idempotente';
    END IF;

    v_settlement := public.record_payment_settlement(
      v_org, 'ecommerce', v_order, 'mercadopago', 'wallet', 1,
      1000, 'zz-payment-' || v_suffix, 50, 'ARS', 'approved'
    );
    v_settlement_duplicate := public.record_payment_settlement(
      v_org, 'ecommerce', v_order, 'mercadopago', 'wallet', 1,
      1000, 'zz-payment-' || v_suffix, 50, 'ARS', 'approved'
    );
    IF v_settlement IS NULL OR v_settlement_duplicate <> v_settlement THEN
      RAISE EXCEPTION 'La liquidación duplicada creó otra transacción';
    END IF;

    PERFORM public.mark_store_order_paid(v_order, 'zz-payment-' || v_suffix, 'mercado_pago');
    PERFORM public.mark_store_order_paid(v_order, 'zz-payment-' || v_suffix, 'mercado_pago');

    SELECT count(*) INTO v_count FROM public.sales WHERE ecommerce_order_id = v_order;
    SELECT stock INTO v_stock_after_payment FROM public.products WHERE id = v_product;
    IF v_count <> 1 OR v_stock_after_payment <> 4 THEN
      RAISE EXCEPTION 'Webhook duplicado dejó % ventas y stock %', v_count, v_stock_after_payment;
    END IF;
    SELECT count(*) INTO v_count
    FROM public.payment_transactions
    WHERE org_id = v_org AND external_id = 'zz-payment-' || v_suffix;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Hay % liquidaciones para el mismo pago', v_count; END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'webhook_duplicado', 'passed', true,
      'detail', 'una venta, un movimiento de stock y una liquidación'
    ));

    -- La liquidación ecommerce tiene que llegar al ledger con la comisión real.
    v_ledger := public.ledger_asentar_orden_pagada(jsonb_build_object(
      'org_id', v_org,
      'data', jsonb_build_object('order_id', v_order)
    ));
    SELECT provider_fee, provider_fee_iva
      INTO v_provider_fee, v_provider_fee_iva
    FROM public.payment_transactions WHERE id = v_settlement;
    SELECT COALESCE(sum(l.debe), 0) INTO v_ledger_fee
    FROM public.ledger_lines l
    JOIN public.ledger_accounts a ON a.id = l.account_id
    WHERE l.entry_id = v_ledger AND a.codigo = '5.2.01';
    IF v_provider_fee <= 0
       OR v_ledger_fee <> round(v_provider_fee + v_provider_fee_iva, 2) THEN
      RAISE EXCEPTION 'El ledger perdió la comisión: transacción % + %, asiento %',
        v_provider_fee, v_provider_fee_iva, v_ledger_fee;
    END IF;
    -- ⚠️ Y el costo de la mercaderia. Sin esto el resultado del periodo es
    -- ingresos menos gastos SIN el costo, que es el numero mas importante del
    -- negocio: el margen sale mejor de lo que es, para el lado optimista.
    SELECT COALESCE(sum(l.debe), 0) INTO v_ledger_fee
      FROM public.ledger_lines l
      JOIN public.ledger_accounts a ON a.id = l.account_id
     WHERE l.entry_id = v_ledger AND a.codigo = '5.1.01';
    IF v_ledger_fee <= 0 THEN
      RAISE EXCEPTION 'Sin costo de mercaderia (5.1.01=%). Movimientos por orden=%, por venta=%, unit_cost_usd sumado=%, tipo de cambio de la org=%',
        v_ledger_fee,
        (SELECT count(*) FROM public.stock_movements m WHERE m.reference_id = v_order),
        (SELECT count(*) FROM public.stock_movements m WHERE m.reference_id IN (SELECT s2.id FROM public.sales s2 WHERE s2.ecommerce_order_id = v_order)),
        (SELECT COALESCE(sum(COALESCE(m.unit_cost_usd,0)),0) FROM public.stock_movements m WHERE m.reference_id IN (SELECT s2.id FROM public.sales s2 WHERE s2.ecommerce_order_id = v_order)),
        (SELECT COALESCE(st.exchange_rate::text,'(sin settings)') FROM public.settings st WHERE st.org_id = v_org);
    END IF;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'liquidacion_al_ledger', 'passed', true,
      'detail', 'source ecommerce conserva comisión e IVA en el asiento'
    ));

    -- Una sola correlación atraviesa la intención, el evento de pago, el
    -- cambio de orden, la liquidación, el outbox/ledger y la vista operativa.
    SELECT correlation_id INTO v_transaction_correlation
      FROM public.payment_transactions WHERE id = v_settlement;
    SELECT l.metadata->>'correlation_id' INTO v_ledger_correlation
      FROM public.ledger_lines l
     WHERE l.entry_id = v_ledger
       AND l.metadata ? 'correlation_id'
     LIMIT 1;
    SELECT count(DISTINCT stage) INTO v_trace_stages
      FROM public.payment_operation_trace
     WHERE org_id = v_org
       AND correlation_id = v_correlation
       AND stage IN ('intent', 'attempt', 'event', 'settlement', 'ledger');

    IF v_transaction_correlation <> v_correlation
       OR v_ledger_correlation <> v_correlation::text
       OR v_trace_stages <> 5
       OR NOT EXISTS (
         SELECT 1 FROM public.domain_events e
          WHERE e.org_id = v_org
            AND e.event_type = 'pago.iniciado'
            AND e.metadata->>'correlation_id' = v_correlation::text
       )
       OR NOT EXISTS (
         SELECT 1 FROM public.domain_events e
          WHERE e.org_id = v_org
            AND e.event_type = 'orden.pagada'
            AND e.metadata->>'correlation_id' = v_correlation::text
       ) THEN
      RAISE EXCEPTION
        'Traza cortada: tx %, ledger %, etapas % para correlación %',
        v_transaction_correlation, v_ledger_correlation, v_trace_stages, v_correlation;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'traza_end_to_end', 'passed', true,
      'detail', 'misma correlación en checkout, eventos, liquidación y ledger'
    ));

    -- ── La traza llega hasta la factura y el stock ────────────────────────
    --
    -- P0-07 pide poder seguir una venta checkout→payment→order→inventory→
    -- invoice→ledger. Hasta el 2026-08-25 `payment_operation_trace` cubría
    -- cinco etapas y le faltaban orden, inventario y factura: contestaba "se
    -- cobró" pero no "se descontó el stock" ni "se emitió el comprobante", que
    -- son justo las dos preguntas que aparecen cuando algo salió mal.
    v_factura := public.facturar_orden_pagada(jsonb_build_object(
      'org_id', v_org, 'data', jsonb_build_object('order_id', v_order)));

    SELECT string_agg(DISTINCT t.stage, ',' ORDER BY t.stage) INTO v_etapas
      FROM public.payment_operation_trace t
     WHERE t.order_id = v_order;

    IF v_etapas IS NULL
       OR v_etapas NOT LIKE '%order%'
       OR v_etapas NOT LIKE '%inventory%'
       OR v_etapas NOT LIKE '%invoice%'
       OR v_etapas NOT LIKE '%settlement%'
       OR v_etapas NOT LIKE '%ledger%' THEN
      RAISE EXCEPTION 'La traza no cubre la cadena completa; etapas presentes: %',
        COALESCE(v_etapas, '(ninguna)');
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'traza_hasta_la_factura', 'passed', true,
      'detail', 'etapas: ' || v_etapas
    ));

    -- Rechazo: no acredita y una acción explícita abre un intento nuevo.
    INSERT INTO public.ecommerce_orders (
      org_id, store_id, order_number, customer_name, customer_email,
      items, subtotal, total, payment_method
    ) VALUES (
      v_org, v_store, 'ZZREJ-' || v_suffix, 'ZZ comprador rechazo',
      'zz-rejected-' || v_suffix || '@invalid.test',
      jsonb_build_array(jsonb_build_object(
        'product_id', v_product, 'name', 'ZZ producto matriz de pagos',
        'quantity', 1, 'unit_price', 250, 'total', 250
      )),
      250, 250, 'mercadopago'
    ) RETURNING id INTO v_rejected_order;
    v_rejected := public.pago_intento_preparar(
      v_rejected_order, 'mercadopago', 1, 'zz-rejected:' || v_suffix
    );
    v_rejected_attempt := (v_rejected->>'attempt_id')::uuid;
    PERFORM public.pago_attempt_resultado(
      v_rejected_attempt, 'rechazado', 'zz-rejected-' || v_suffix,
      NULL, NULL, NULL, 'rejected_by_provider',
      jsonb_build_object('source', 'payment_matrix', 'status', 'rejected')
    );
    v_retry := public.pago_intento_preparar(
      v_rejected_order, 'mercadopago', 1, 'zz-retry:' || v_suffix
    );
    IF (v_retry->>'attempt_id')::uuid = v_rejected_attempt
       OR (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_rejected_order) <> 'pending' THEN
      RAISE EXCEPTION 'El rechazo se acreditó o reutilizó un intento terminal';
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'rechazo_reintentable', 'passed', true,
      'detail', 'no acredita; el retry explícito usa un intento nuevo'
    ));

    -- Reintegro: timeout conserva processing y la reconciliación es idempotente.
    INSERT INTO public.return_requests (
      org_id, rma_number, ecommerce_order_id, tipo,
      customer_name, customer_email, product_id, product_name, quantity,
      condition, resolution, refund_amount, refund_method, status,
      reason_text, approved_by, approved_at
    ) VALUES (
      v_org, 'ZZRMA-' || v_suffix, v_order, 'arrepentimiento',
      'ZZ comprador', 'zz-payment-' || v_suffix || '@invalid.test',
      v_product, 'ZZ producto matriz de pagos', 1,
      'unopened', 'refund', 1000, 'original_payment', 'approved',
      'Matriz de pago', v_user, now()
    ) RETURNING id INTO v_rma;

    v_refund_first := public.pago_reintegro_preparar(v_org, v_rma, v_user);
    v_refund := (v_refund_first->>'refund_id')::uuid;
    v_refund_state := public.pago_reintegro_estado(v_org, v_rma);
    v_refund_retry := public.pago_reintegro_preparar(v_org, v_rma, v_user);
    IF v_refund_state->>'status' <> 'processing'
       OR (v_refund_retry->>'refund_id')::uuid <> v_refund
       OR v_refund_retry->>'client_key' <> v_refund_first->>'client_key' THEN
      RAISE EXCEPTION 'El timeout de reintegro no conservó operación y clave';
    END IF;
    SELECT count(*) INTO v_count FROM public.payment_refunds WHERE return_request_id = v_rma;
    IF v_count <> 1 THEN RAISE EXCEPTION 'El retry creó % reintegros', v_count; END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'refund_timeout', 'passed', true,
      'detail', 'processing conserva refund y clave de proveedor'
    ));

    v_refund_done := public.pago_reintegro_resultado(
      v_refund, 'refunded', 'zz-refund-' || v_suffix,
      jsonb_build_object('source', 'payment_matrix', 'status', 'approved'), NULL
    );
    v_refund_duplicate := public.pago_reintegro_resultado(
      v_refund, 'refunded', 'zz-refund-' || v_suffix,
      jsonb_build_object('source', 'payment_matrix', 'status', 'approved'), NULL
    );
    SELECT stock INTO v_stock_after_refund FROM public.products WHERE id = v_product;
    IF v_refund_done->>'order_payment_status' <> 'refunded'
       OR COALESCE((v_refund_duplicate->>'idempotent')::boolean, false) IS NOT TRUE
       OR v_stock_after_refund <> v_stock_after_payment
       OR (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_order) <> 'refunded'
       OR (SELECT status FROM public.return_requests WHERE id = v_rma) <> 'resolved' THEN
      RAISE EXCEPTION 'La reconciliación del reintegro duplicó stock o dejó estados ambiguos';
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'refund_reconciliado', 'passed', true,
      'detail', 'orden refund, RMA resuelto, resultado duplicado y stock intacto'
    ));

    -- ── Un webhook 'approved' que llega TARDE no revive el cobro ──────────
    --
    -- MercadoPago entrega "al menos una vez" y **sin orden garantizado**: el
    -- approved original puede reaparecer después del refund. Si eso volviera a
    -- marcar la orden como pagada, el comercio vería cobrada una venta que ya
    -- devolvió, y el stock se descontaría por segunda vez.
    -- ⚠️ Y no lo ignora en silencio: LANZA. Es la respuesta correcta —
    -- un no-op dejaría al webhook creyendo que se procesó, y MercadoPago
    -- dejaría de reintentar sin que nadie sepa que llegó fuera de orden.
    v_fallo := NULL;
    BEGIN
      PERFORM public.mark_store_order_paid(v_order, 'zz-payment-' || v_suffix, 'mercado_pago');
    EXCEPTION WHEN others THEN
      v_fallo := SQLERRM;
    END;
    SELECT count(*) INTO v_count FROM public.sales WHERE ecommerce_order_id = v_order;
    SELECT stock INTO v_stock_after_payment FROM public.products WHERE id = v_product;
    IF v_fallo IS NULL
       OR (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_order) <> 'refunded'
       OR v_count <> 1
       OR v_stock_after_payment <> v_stock_after_refund THEN
      RAISE EXCEPTION 'Un approved fuera de orden revivió el cobro: fallo %, estado %, % ventas, stock %',
        COALESCE(v_fallo,'(ninguno)'),
        (SELECT payment_status FROM public.ecommerce_orders WHERE id = v_order),
        v_count, v_stock_after_payment;
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'webhook_fuera_de_orden', 'passed', true,
      'detail', 'un approved posterior al refund se rechaza con error, no en silencio'
    ));

    -- ── La reversión contable no borra: contraasienta ─────────────────────
    --
    -- Un contracargo no puede editar el asiento original: el libro es inmutable
    -- y una factura o un cierre ya pudieron citarlo. Se crea un asiento espejo
    -- que lo neutraliza, y **la suma de los dos por cuenta tiene que dar cero**.
    v_contra := public.ledger_contraasentar(v_ledger, 'ZZ contracargo de la matriz');
    SELECT COALESCE(sum(debe), 0), COALESCE(sum(haber), 0)
      INTO v_debe, v_haber FROM public.ledger_lines WHERE entry_id = v_contra;
    SELECT COALESCE(sum(l.debe - l.haber), 0) INTO v_neto_cuenta
      FROM public.ledger_lines l WHERE l.entry_id IN (v_ledger, v_contra);
    IF v_contra IS NULL OR v_debe <> v_haber OR v_debe = 0 OR v_neto_cuenta <> 0 THEN
      RAISE EXCEPTION 'La reversión no neutralizó el asiento: debe %, haber %, neto %',
        v_debe, v_haber, v_neto_cuenta;
    END IF;
    IF (SELECT anulado_por FROM public.ledger_entries WHERE id = v_ledger) IS NULL
       OR (SELECT anula_a FROM public.ledger_entries WHERE id = v_contra) <> v_ledger THEN
      RAISE EXCEPTION 'El contraasiento no quedó enlazado con el original';
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'reversion_contable', 'passed', true,
      'detail', 'contraasiento enlazado, cuadrado y con neto cero contra el original'
    ));

    -- ── No se reintegra dos veces la misma orden ──────────────────────────
    --
    -- ⚠️ Este escenario se escribió para probar "reintegro mayor a lo cobrado"
    -- y **pasó por otra razón**: la orden ya estaba reintegrada, así que el
    -- rechazo dice "no tiene un pago reintegrable". Es una guarda valiosa —
    -- devolver dos veces es devolver plata que no entró— pero NO es la del
    -- monto. Se renombró a lo que verifica de verdad.
    --
    -- El caso del monto excesivo sobre una orden pagada y sin devolver sigue
    -- sin cubrir: exige una segunda orden en la matriz. Queda anotado.
    INSERT INTO public.return_requests (
      org_id, rma_number, ecommerce_order_id, customer_name, customer_email,
      product_name, quantity, status, resolution, refund_amount, reason_text
    ) VALUES (
      v_org, 'ZZ-RMA-' || v_suffix, v_order, 'ZZ Comprador', 'zz-matrix@zz.com',
      'ZZ Producto', 1, 'approved', 'refund', 999999999, 'ZZ monto imposible'
    ) RETURNING id INTO v_rma_grande;

    v_fallo := NULL;
    BEGIN
      v_refund_grande := public.pago_reintegro_preparar(v_rma_grande, v_user);
    EXCEPTION WHEN others THEN
      v_fallo := SQLERRM;
    END;
    IF v_fallo IS NULL
       AND COALESCE((v_refund_grande->>'ok')::boolean, true) IS NOT FALSE THEN
      RAISE EXCEPTION 'Se preparó un reintegro de 999.999.999 sobre una orden de 1000';
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scenario', 'reintegro_sobre_orden_ya_reintegrada', 'passed', true,
      'detail', COALESCE('rechazado: ' || left(v_fallo, 60), 'rechazado por contrato')
    ));

    -- Ejecuta ahora los constraints diferidos. Si alguno falla, no se informa
    -- verde antes de descubrirlo al COMMIT.
    SET CONSTRAINTS ALL IMMEDIATE;

    -- Rollback deliberado del sub-bloque. Las variables PL/pgSQL conservan la
    -- matriz; organizaciones, ventas, stock, ledger y eventos vuelven atrás.
    RAISE EXCEPTION 'payment matrix rollback' USING ERRCODE = 'P0002';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'payment matrix rollback' THEN RAISE; END IF;
  END;

  SELECT
      (SELECT count(*) FROM public.organizations WHERE id = v_org)
    + (SELECT count(*) FROM public.products WHERE org_id = v_org)
    + (SELECT count(*) FROM public.ecommerce_orders WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_intents WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_attempts WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_transactions WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_refunds WHERE org_id = v_org)
    + (SELECT count(*) FROM public.ledger_entries WHERE org_id = v_org)
    + (SELECT count(*) FROM public.return_requests WHERE org_id = v_org)
    + (SELECT count(*) FROM public.invoices WHERE org_id = v_org)
    + (SELECT count(*) FROM public.exchange_rates WHERE org_id = v_org)
    + (SELECT count(*) FROM public.payment_connections WHERE org_id = v_org)
  INTO v_leftovers;
  IF v_leftovers <> 0 THEN
    RAISE EXCEPTION 'La matriz dejó % restos después del rollback', v_leftovers;
  END IF;

  INSERT INTO zz_payment_matrix_result (scenario, passed, detail)
  SELECT scenario, passed, detail
  FROM jsonb_to_recordset(v_results) AS result(
    scenario text, passed boolean, detail text
  );
  INSERT INTO zz_payment_matrix_result VALUES
    ('zz_restos', true, 'rollback transaccional: 0 filas persistidas');
END
$matrix$;

SELECT scenario, passed, detail
FROM zz_payment_matrix_result
ORDER BY scenario;

COMMIT;
