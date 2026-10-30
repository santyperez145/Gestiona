-- El libro de ventas, correcto para el contador (2026-10-30).
--
-- Revisando el asiento de un pago con saldo a favor (20261030000800) aparecieron
-- tres errores en cómo se asienta cada venta desde agosto. Ninguno cambia la
-- ganancia por producto; los tres cambian el balance, y el primero también el
-- total de ventas.
--
--   1. Pedidos online contados dos veces. Un pedido pagado se asienta como
--      «orden» (el outbox, `orden.pagada` → ledger_asentar_orden_pagada: con
--      envío, IVA y comisiones) y además cada venta que crea
--      mark_store_order_paid disparaba su propio asiento «venta». En un
--      monotributista, Ventas (4.1.01) recibía el pedido dos veces. (En un
--      responsable inscripto el asiento por venta se corta a propósito porque
--      todavía no separa IVA, así que ahí no duplicaba.) Ahora una venta que
--      viene de un pedido online no se asienta sola: la cubre el asiento de la
--      orden. `operaciones_sin_asentar` la sigue mostrando mientras su orden no
--      tenga asiento, así que nada queda sin registrar en silencio.
--   2. Medios que caían en Caja sin serlo. La cuenta de cobro de ventas sólo
--      conocía efectivo, transferencia, crédito, Mercado Pago y fiado; débito,
--      tarjeta, MODO o «deposito» iban a Caja: la caja del balance no
--      coincidía con el arqueo. Siguen la decisión ya medida para el crédito
--      («una tarjeta liquida en banco»): van a Banco (1.1.02). QR y los otros
--      nombres de Mercado Pago, a «MercadoPago a liquidar» (1.1.03), que es lo
--      que baja su liquidación. Lo desconocido sigue yendo a Caja y quedando a
--      la vista en ventas_con_cobro_sin_clasificar.
--   3. Cobros divididos asentados enteros en el medio principal. La caja guarda
--      en cada renglón cuánto se cobró con cada medio (`split_payments`, ya
--      prorrateado); el asiento lo ignoraba. Ahora cada medio va a su cuenta y
--      el redondeo lo absorbe el último, así el asiento cuadra siempre.
--
-- Lo ya asentado no se toca: un contraasiento masivo de asientos históricos es
-- una decisión del dueño, no de una migración.

BEGIN;

-- ── 2. Cuenta de cobro de ventas ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cuenta_de_cobro(p_metodo text, p_paid boolean)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE
    -- Una venta no cobrada es un crédito, sea cual sea el medio previsto.
    WHEN COALESCE(p_paid, true) IS FALSE THEN '1.2.01'
    ELSE CASE lower(btrim(COALESCE(p_metodo, '')))
      WHEN 'efectivo'         THEN '1.1.01'
      WHEN 'cash'             THEN '1.1.01'
      -- Lo que se acredita en el banco: transferencias y tarjetas (se liquidan
      -- ahí; en «a liquidar» quedarían sin bajar nunca).
      WHEN 'transferencia'    THEN '1.1.02'
      WHEN 'transfer'         THEN '1.1.02'
      WHEN 'deposito'         THEN '1.1.02'
      WHEN 'credito'          THEN '1.1.02'
      WHEN 'credit'           THEN '1.1.02'
      WHEN 'debito'           THEN '1.1.02'
      WHEN 'debit'            THEN '1.1.02'
      WHEN 'tarjeta'          THEN '1.1.02'
      WHEN 'modo'             THEN '1.1.02'
      -- Mercado Pago (y su QR): lo baja la liquidación de Mercado Pago.
      WHEN 'mercado_pago'     THEN '1.1.03'
      WHEN 'mercadopago'      THEN '1.1.03'
      WHEN 'gestiona_pay'     THEN '1.1.03'
      WHEN 'qr'               THEN '1.1.03'
      -- Crédito contra el cliente o crédito que ya tenía: no entra plata.
      WHEN 'fiado'            THEN '1.2.01'
      WHEN 'cuenta_corriente' THEN '1.2.01'
      WHEN 'saldo_a_favor'    THEN '1.2.01'
      -- Sin dato de dónde entró: Caja, y se expone en la vista de sin clasificar.
      ELSE '1.1.01'
    END
  END;
$fn$;

COMMENT ON FUNCTION public.cuenta_de_cobro(text, boolean) IS
  'Cuenta contable donde cae el cobro de una venta segun el medio. Afecta el balance, no el resultado. Tarjetas y transferencias a Banco, Mercado Pago a liquidar, fiado/cuenta corriente/saldo a favor a Deudores; lo que no mapea va a Caja y se expone en ventas_con_cobro_sin_clasificar (20261030000900).';

-- ── 3. El asiento de una venta, con el cobro dividido ───────────────────
CREATE OR REPLACE FUNCTION public.ledger_asentar_venta(p_sale_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_s        public.sales;
  v_existing uuid;
  v_emisor   text;
  v_costo    numeric;
  v_lineas   jsonb := '[]'::jsonb;
  v_cuenta   text;
  v_cobros   jsonb := '{}'::jsonb;   -- cuenta -> importe
  v_sp       jsonb;
  v_monto    numeric;
  v_suma     numeric := 0;
  v_ultima   text;
  v_valido   boolean := false;
  v_c        record;
BEGIN
  SELECT * INTO v_s FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'La venta no existe';
  END IF;

  -- Idempotencia: mismo criterio que la liquidación.
  SELECT e.id INTO v_existing
    FROM public.ledger_entries e
   WHERE e.org_id = v_s.org_id
     AND e.referencia_tipo = 'venta'
     AND e.referencia_id = v_s.id
     AND e.anulado_por IS NULL AND e.anula_a IS NULL
   LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF COALESCE(v_s.total_ars, 0) <= 0 THEN
    RAISE EXCEPTION 'La venta % no tiene importe', v_s.id;
  END IF;

  -- ⚠️ Sin el corte de IVA implementado, un responsable inscripto quedaría con
  -- el ingreso inflado. Se corta acá.
  SELECT st.afip_tipo_emisor INTO v_emisor
    FROM public.settings st WHERE st.org_id = v_s.org_id;
  IF COALESCE(v_emisor, 'monotributo') <> 'monotributo' THEN
    RAISE EXCEPTION 'El asiento de venta todavia no separa IVA: el emisor es %', v_emisor;
  END IF;

  -- Cobro dividido (la caja guarda en cada renglón su parte de cada medio):
  -- cada medio a su cuenta; el redondeo lo absorbe el último para que el
  -- asiento cuadre exacto. Una venta no cobrada es crédito entero, como antes.
  IF v_s.paid IS NOT FALSE AND COALESCE(v_s.payment_method, '') <> 'fiado'
     AND jsonb_typeof(v_s.split_payments) = 'array' AND jsonb_array_length(v_s.split_payments) > 0 THEN
    v_valido := true;
    FOR v_sp IN SELECT value FROM jsonb_array_elements(v_s.split_payments) LOOP
      BEGIN
        v_monto := ROUND((v_sp->>'amount')::numeric, 2);
      EXCEPTION WHEN OTHERS THEN
        v_monto := NULL;
      END;
      IF v_monto IS NULL OR v_monto < 0 THEN v_valido := false; EXIT; END IF;
      CONTINUE WHEN v_monto = 0;
      v_cuenta := public.cuenta_de_cobro(v_sp->>'method', true);
      v_cobros := jsonb_set(v_cobros, ARRAY[v_cuenta], to_jsonb(COALESCE((v_cobros->>v_cuenta)::numeric, 0) + v_monto));
      v_suma := v_suma + v_monto;
      v_ultima := v_cuenta;
    END LOOP;
    -- Un reparto que no se parece al total (datos viejos o rotos) no se usa:
    -- se asienta como antes, con el medio principal.
    IF v_valido AND v_ultima IS NOT NULL AND abs(v_suma - ROUND(v_s.total_ars, 2)) <= GREATEST(1, 0.01 * v_s.total_ars) THEN
      v_cobros := jsonb_set(v_cobros, ARRAY[v_ultima],
        to_jsonb((v_cobros->>v_ultima)::numeric + ROUND(v_s.total_ars, 2) - v_suma));
    ELSE
      v_valido := false;
    END IF;
  END IF;

  IF v_valido THEN
    FOR v_c IN SELECT key AS cuenta, value::numeric AS importe FROM jsonb_each_text(v_cobros) WHERE value::numeric <> 0 ORDER BY key LOOP
      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
        'cuenta', v_c.cuenta, 'debe', v_c.importe,
        'detalle', 'Cobro de venta (dividido)',
        'metadata', jsonb_build_object('sale_id', v_s.id, 'split_payments', v_s.split_payments)));
    END LOOP;
  ELSE
    v_cuenta := public.cuenta_de_cobro(v_s.payment_method, v_s.paid);
    v_lineas := jsonb_build_array(jsonb_build_object(
      'cuenta', v_cuenta, 'debe', ROUND(v_s.total_ars, 2),
      'detalle', 'Cobro de venta (' || COALESCE(v_s.payment_method, 'sin medio') || ')',
      'metadata', jsonb_build_object('sale_id', v_s.id, 'payment_method', v_s.payment_method)));
  END IF;

  v_costo  := ROUND(COALESCE(v_s.cost_of_goods_ars, 0), 2);
  v_lineas := v_lineas || jsonb_build_array(
    jsonb_build_object('cuenta', '4.1.01', 'haber', ROUND(v_s.total_ars, 2),
      'detalle', COALESCE(v_s.product_name, 'Venta'))
  );

  -- El costo sólo se asienta si se conoce. Una venta sin costo NO se asienta
  -- con costo cero: eso pondría margen 100% en el libro.
  IF v_costo > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(
      jsonb_build_object('cuenta', '5.1.01', 'debe', v_costo,
        'detalle', 'Costo de lo vendido'),
      jsonb_build_object('cuenta', '1.3.01', 'haber', v_costo,
        'detalle', 'Salida de mercaderia')
    );
  END IF;

  RETURN public.ledger_asentar(
    p_org         := v_s.org_id,
    p_descripcion := 'Venta' || COALESCE(' — ' || v_s.customer_name, ''),
    p_lineas      := v_lineas,
    p_fecha       := COALESCE(v_s.date::date, v_s.created_at::date),
    p_ref_tipo    := 'venta',
    p_ref_id      := v_s.id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ledger_asentar_venta(uuid) FROM PUBLIC, anon, authenticated;

-- ── 1. Una venta de un pedido online la asienta su orden ────────────────
CREATE OR REPLACE FUNCTION public.trg_asentar_venta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.total_ars, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  -- Viene de un pedido de la tienda: la asienta `ledger_asentar_orden_pagada`
  -- (con envío, IVA y comisiones). Asentarla también acá contaba el pedido dos
  -- veces en Ventas (20261030000900).
  IF NEW.ecommerce_order_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.ledger_asentar_venta(NEW.id);
  EXCEPTION WHEN others THEN
    -- La venta se guarda igual. Lo pendiente queda visible en
    -- `operaciones_sin_asentar`, no en un log que nadie mira.
    RAISE WARNING 'la venta % quedo sin asentar: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

-- Una venta de un pedido online está asentada si lo está su orden.
CREATE OR REPLACE VIEW public.operaciones_sin_asentar AS
SELECT 'venta'::text AS tipo, s.id, s.org_id,
       COALESCE(s.date::date, s.created_at::date) AS fecha,
       s.total_ars AS importe,
       s.product_name AS detalle
  FROM public.sales s
 WHERE COALESCE(s.total_ars, 0) > 0
   AND EXISTS (SELECT 1 FROM public.ledger_accounts a WHERE a.org_id = s.org_id)
   AND NOT EXISTS (
     SELECT 1 FROM public.ledger_entries e
      WHERE e.org_id = s.org_id AND e.referencia_tipo = 'venta'
        AND e.referencia_id = s.id
        AND e.anulado_por IS NULL AND e.anula_a IS NULL)
   AND NOT (s.ecommerce_order_id IS NOT NULL AND EXISTS (
     SELECT 1 FROM public.ledger_entries e
      WHERE e.org_id = s.org_id AND e.referencia_tipo = 'orden'
        AND e.referencia_id = s.ecommerce_order_id
        AND e.anulado_por IS NULL AND e.anula_a IS NULL))
   AND public.is_org_member(s.org_id, auth.uid())
UNION ALL
SELECT 'gasto', g.id, g.org_id,
       COALESCE(g.date::date, g.created_at::date),
       g.amount_ars,
       g.description
  FROM public.expenses g
 WHERE COALESCE(g.amount_ars, 0) > 0
   AND EXISTS (SELECT 1 FROM public.ledger_accounts a WHERE a.org_id = g.org_id)
   AND NOT EXISTS (
     SELECT 1 FROM public.ledger_entries e
      WHERE e.org_id = g.org_id AND e.referencia_tipo = 'gasto'
        AND e.referencia_id = g.id
        AND e.anulado_por IS NULL AND e.anula_a IS NULL)
   AND public.is_org_member(g.org_id, auth.uid());

COMMENT ON VIEW public.operaciones_sin_asentar IS
  'Ventas y gastos que no tienen asiento en el ledger. Tiene que estar VACIA: si algo aparece, el trigger fallo y quedo el WARNING — se reasienta con ledger_asentar_venta/gasto. Una venta de un pedido online cuenta como asentada si su orden lo esta (20261030000900).';

REVOKE ALL ON public.operaciones_sin_asentar FROM anon;
GRANT SELECT ON public.operaciones_sin_asentar TO authenticated;

COMMIT;
