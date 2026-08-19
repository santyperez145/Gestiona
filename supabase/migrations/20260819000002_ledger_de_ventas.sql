-- ═══════════════════════════════════════════════════════════════════════════
-- H3b — La venta cobrada se asienta sola, por el outbox
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Acá se ve para qué servía H2. El checkout **no sabe que existe la
-- contabilidad**: emite `orden.pagada` y sigue. El ledger escucha ese evento y
-- registra el asiento. Si mañana hay que asentar distinto, se toca el
-- consumidor y no el checkout; si el ledger falla, la venta ya está cobrada
-- igual y el evento se reintenta.
--
-- Es literalmente el problema que `docs/ARQUITECTURA.md` describía: "quien
-- confirma una orden tiene que acordarse de avisarle a stock, al CRM, a
-- marketing y a los emails". Ahora no tiene que acordarse de nada.
--
-- ── El asiento de una venta cobrada ───────────────────────────────────────
--
--   DEBE   MercadoPago a liquidar / Caja / Banco   lo que efectivamente entra
--   DEBE   Comisiones de medios de pago            lo que se queda MercadoPago
--   DEBE   Comision de plataforma                  el marketplace_fee
--   HABER  Fletes cobrados                         el envio facturado
--   HABER  Ventas                                  la mercaderia, neta de IVA
--   HABER  IVA debito fiscal                       lo que se le debe a ARCA
--
-- Los dos lados suman el total cobrado. Que cuadre no es una convención: es lo
-- que permite descubrir que una comisión cambió sin avisar.
--
-- ── ⚠️ El consumidor TIENE que ser idempotente ────────────────────────────
--
-- H2 garantiza **al menos una vez**, no exactamente una vez — eso no existe
-- sobre HTTP. Si el worker reintenta, este consumidor corre de nuevo. Sin la
-- guarda de abajo, un reintento asentaría la misma venta dos veces y el libro
-- diria que se cobro el doble. Es el mismo error que ya costo meses con el
-- stock, en otro disfraz.
--
-- La guarda es la referencia: un asiento vivo con `referencia = (orden, id)` ya
-- existe ⇒ no se hace nada.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ledger_asentar_orden_pagada(p_evento jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
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
  v_cuenta := CASE v_o.payment_method
    WHEN 'efectivo'      THEN '1.1.01'
    WHEN 'transferencia' THEN '1.1.02'
    ELSE '1.1.03'
  END;

  -- Las comisiones reales, si hay registro del cobro. Sin registro son cero, y
  -- queda anotado en el asiento que se asentó sin datos del procesador.
  SELECT * INTO v_pt FROM public.payment_transactions
   WHERE org_id = v_org AND source = 'ecommerce_order' AND source_id = v_orden
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
      'provider', v_pt.provider);
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

  RETURN public.ledger_asentar(
    p_org         := v_org,
    p_descripcion := 'Venta ' || v_o.order_number || ' cobrada',
    p_lineas      := v_lineas,
    p_fecha       := CURRENT_DATE,
    p_ref_tipo    := 'orden',
    p_ref_id      := v_orden);
END;
$fn$;

COMMENT ON FUNCTION public.ledger_asentar_orden_pagada IS
  'Consumidor del evento orden.pagada. Idempotente: si ya hay un asiento vivo para esa orden, no hace nada.';

-- Una devolución no borra la venta: la compensa. El contraasiento deja las dos
-- operaciones en el libro, que es lo que un contador necesita ver.
CREATE OR REPLACE FUNCTION public.ledger_revertir_orden(p_evento jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_org   uuid;
  v_orden uuid;
  v_e     uuid;
BEGIN
  v_org   := NULLIF(p_evento->>'org_id', '')::uuid;
  v_orden := NULLIF(p_evento#>>'{data,order_id}', '')::uuid;
  IF v_org IS NULL OR v_orden IS NULL THEN RETURN NULL; END IF;

  SELECT e.id INTO v_e FROM public.ledger_entries e
   WHERE e.org_id = v_org AND e.referencia_tipo = 'orden'
     AND e.referencia_id = v_orden AND e.anulado_por IS NULL AND e.anula_a IS NULL
   LIMIT 1;

  -- Sin asiento original no hay nada que revertir, y no es un error: una orden
  -- que se reembolsa sin haberse llegado a asentar es un caso normal.
  IF v_e IS NULL THEN RETURN NULL; END IF;

  RETURN public.ledger_contraasentar(v_e, 'reembolso de la orden');
END;
$fn$;

-- ── Las suscripciones ──────────────────────────────────────────────────────
--
-- Son globales (`org_id` NULL): el ledger es del sistema, no de un comercio en
-- particular, y una fila por organización se olvidaría al dar de alta la
-- siguiente.

INSERT INTO public.event_subscriptions (org_id, nombre, patron, destino, objetivo, max_intentos)
VALUES
  (NULL, 'ledger: venta cobrada',  'orden.pagada',       'interno', 'ledger_asentar_orden_pagada', 10),
  (NULL, 'ledger: venta revertida','orden.reembolsada',  'interno', 'ledger_revertir_orden',       10)
ON CONFLICT (COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), nombre)
DO UPDATE SET patron = EXCLUDED.patron, destino = EXCLUDED.destino,
              objetivo = EXCLUDED.objetivo, is_active = true, updated_at = now();
