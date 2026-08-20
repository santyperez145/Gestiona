-- ═══════════════════════════════════════════════════════════════════════════
-- H8 — la venta de mostrador entra al libro
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Medido hoy contra producción: **34 ventas de POS, 6 órdenes online, 0
-- asientos**. El ledger de partida doble tiene 25 cuentas, un consumidor
-- (`ledger_asentar_orden_pagada`) y una reversión — todo para el canal online.
-- El mostrador, que es **el 85% de las ventas**, no lo toca.
--
-- Eso es R11 del ROADMAP con nombre y apellido: un motor que nunca vio el canal
-- donde el negocio realmente vende no está probado, está escrito. Y mientras
-- tanto los números de Finanzas no pueden salir del libro, porque el libro no
-- sabe de la mayoría de las ventas.
--
-- ── Por qué el asiento va por ticket y no por renglón ──────────────────────
--
-- `sales` es **una fila por producto**, no por venta. Un asiento por fila daría
-- tres asientos para un ticket de tres productos, y la caja del día quedaría
-- partida en pedazos que no corresponden a ninguna operación real.
-- `create_sales_transaction` ya agrupa: crea la fila en `sale_transactions` y
-- se la pone a cada renglón.
--
-- ⚠️ Las **34 ventas históricas no se asientan**, a propósito: son anteriores
-- al agrupamiento y tienen `sale_transaction_id` en NULL. Inventarles un ticket
-- por renglón llenaría el libro de operaciones que nunca existieron. El libro
-- arranca desde acá; lo viejo se concilia contando, como el stock.
--
-- ── El IVA no se inventa: se aplica la misma regla que ya existe ───────────
--
-- `sales` no guarda IVA. Se calcula con `discrimina_iva` y `desglosar_iva`, que
-- son **las mismas funciones** que usa `trg_iva_de_orden`. No es un espejo que
-- hay que mantener sincronizado: es la misma regla aplicada a otra forma de
-- fila. Un monotributista no discrimina, y ahí el total es todo "Ventas".
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Dónde entra la plata, en un solo lugar ──────────────────────────────
--
-- `ledger_asentar_orden_pagada` tenía este mapeo escrito adentro con un CASE.
-- Agregar el mostrador con su propio CASE habría dado dos tablas de
-- equivalencias para la misma pregunta, que es el patrón que ya causó tres
-- bugs en este repo. Es una función, y los dos consumidores la llaman.
--
-- Devuelve NULL para un método desconocido en vez de un default: quien llama
-- decide qué hacer, pero **se entera**. Un ELSE silencioso manda un cobro por
-- transferencia a "MercadoPago a liquidar" y la conciliación no cierra nunca.

CREATE OR REPLACE FUNCTION public.cuenta_de_cobro(p_metodo text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE lower(btrim(COALESCE(p_metodo, '')))
    WHEN 'efectivo'         THEN '1.1.01'
    WHEN 'cash'             THEN '1.1.01'
    WHEN 'transferencia'    THEN '1.1.02'
    WHEN 'deposito'         THEN '1.1.02'
    -- Tarjeta y billetera entran como valores a liquidar: la plata todavía no
    -- está disponible y la comisión aparece recién en la liquidación.
    WHEN 'mercado_pago'     THEN '1.1.03'
    WHEN 'mercadopago'      THEN '1.1.03'
    WHEN 'credito'          THEN '1.1.03'
    WHEN 'debito'           THEN '1.1.03'
    WHEN 'tarjeta'          THEN '1.1.03'
    WHEN 'qr'               THEN '1.1.03'
    WHEN 'modo'             THEN '1.1.03'
    -- Fiado no es plata: es un crédito contra el cliente.
    WHEN 'fiado'            THEN '1.2.01'
    WHEN 'cuenta_corriente' THEN '1.2.01'
    ELSE NULL
  END;
$fn$;

COMMENT ON FUNCTION public.cuenta_de_cobro(text) IS
  'Metodo de cobro -> cuenta del plan. Unica fuente: la usan el consumidor de ordenes online y el de ventas de mostrador. NULL = metodo desconocido, y quien llama tiene que dejar rastro.';

-- ── 1. La venta de mostrador emite evento ──────────────────────────────────
--
-- ⚠️ Va en `sale_transactions` y no en `sales`: `create_sales_transaction`
-- inserta los renglones **uno por uno**, así que un trigger sobre `sales`
-- —de fila o de sentencia— emitiría un evento por producto.
--
-- Cuando este trigger corre, los renglones todavía no existen. No importa y es
-- justamente para lo que sirve el outbox: el evento sólo lleva el id del
-- ticket, y el consumidor lee los renglones cuando se despacha, después del
-- commit. Si los leyera acá adentro, no habría ninguno.

CREATE OR REPLACE FUNCTION public.trg_eventos_de_venta_pos()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  PERFORM public.emitir_evento(
    NEW.org_id, 'venta', NEW.id, 'venta.registrada',
    jsonb_build_object(
      'transaction_id', NEW.id,
      'source',         NEW.source,
      'occurred_at',    NEW.occurred_at));
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_eventos_de_venta_pos ON public.sale_transactions;
CREATE TRIGGER trg_eventos_de_venta_pos
AFTER INSERT ON public.sale_transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_eventos_de_venta_pos();

-- ── 2. El consumidor ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ledger_asentar_venta_pos(p_evento jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_org       uuid;
  v_tx        uuid;
  v_ya        uuid;
  v_source    text;
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

  SELECT t.source INTO v_source FROM public.sale_transactions t WHERE t.id = v_tx;

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
    p_fecha       := CURRENT_DATE,
    p_ref_tipo    := 'venta_pos',
    p_ref_id      := v_tx);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ledger_asentar_venta_pos(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 3. La suscripción ──────────────────────────────────────────────────────

INSERT INTO public.event_subscriptions (org_id, nombre, patron, destino, objetivo, max_intentos)
VALUES (NULL, 'ledger: venta de mostrador', 'venta.registrada', 'interno', 'ledger_asentar_venta_pos', 10)
ON CONFLICT (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), nombre)
DO UPDATE SET patron = EXCLUDED.patron, destino = EXCLUDED.destino,
              objetivo = EXCLUDED.objetivo, is_active = true, updated_at = now();

-- ── 4. Qué quedó sin asentar ───────────────────────────────────────────────
--
-- La lección de C16: un mecanismo que nadie puede ver no se arregla cuando
-- falla. Si el consumidor se queda sin reintentos, la venta queda fuera del
-- libro y el resultado del período sale mal, en silencio.

CREATE OR REPLACE VIEW public.ventas_sin_asentar AS
SELECT
  t.org_id,
  t.id AS transaction_id,
  t.source,
  t.occurred_at,
  (SELECT COALESCE(SUM(s.total_ars), 0) FROM public.sales s WHERE s.sale_transaction_id = t.id) AS total,
  (SELECT count(*) FROM public.sales s WHERE s.sale_transaction_id = t.id) AS renglones
FROM public.sale_transactions t
WHERE t.source <> 'tienda_online'
  AND NOT EXISTS (
    SELECT 1 FROM public.ledger_entries e
     WHERE e.org_id = t.org_id AND e.referencia_tipo = 'venta_pos'
       AND e.referencia_id = t.id AND e.anulado_por IS NULL)
  AND public.is_org_member(t.org_id, auth.uid());

COMMENT ON VIEW public.ventas_sin_asentar IS
  'Tickets de mostrador que no llegaron al libro. Deberia estar vacia: una venta fuera del ledger hace que el resultado del periodo salga mal sin que nada lo diga.';

GRANT SELECT ON public.ventas_sin_asentar TO authenticated;
