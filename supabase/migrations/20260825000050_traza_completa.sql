-- ═══════════════════════════════════════════════════════════════════════════
-- P0-07 — la traza llega hasta la factura y el stock
-- ═══════════════════════════════════════════════════════════════════════════
--
-- El backlog del 2026-08-24 pide: *"Una venta puede seguirse
-- checkout→payment→order→inventory→invoice→ledger."*
--
-- `payment_operation_trace` ya cubría cinco etapas —intent, attempt,
-- settlement, event, ledger— y le faltaban tres de esa lista: **orden,
-- inventario y factura**. Con eso, la traza contestaba "se cobró" pero no "se
-- descontó el stock" ni "se emitió el comprobante", que son las dos preguntas
-- que aparecen cuando algo salió mal.
--
-- ── De dónde sale la correlación ───────────────────────────────────────────
--
-- Ni `ecommerce_orders`, ni `stock_movements`, ni `invoices` tienen
-- `correlation_id`: sólo la tienen `payment_intents`, `payment_attempts` y
-- `payment_transactions`. Las tres etapas nuevas la toman de la intención de
-- pago de la misma orden, con un `LATERAL` que se queda con la más reciente.
--
-- ⚠️ **Consecuencia honesta:** una venta sin intención de pago —el mostrador,
-- que cobra en efectivo y no crea intent— **no aparece en la traza**. No es un
-- descuido de esta vista: es que la correlación nace en el orquestador de pagos
-- y el POS no pasa por ahí. Cerrarlo del todo exige darle correlación propia a
-- la venta de mostrador, y eso es su propio slice.
--
-- La vista se regeneró desde `pg_get_viewdef` con un script, agregando sólo
-- los tres UNION nuevos.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.payment_operation_trace AS
SELECT i.org_id,
    i.correlation_id,
    i.order_id,
    'intent'::text AS stage,
    10 AS stage_order,
    i.id AS record_id,
    i.estado AS status,
    NULL::text AS provider,
    NULL::text AS provider_reference,
    i.created_at AS occurred_at
   FROM payment_intents i
UNION ALL
 SELECT i.org_id,
    i.correlation_id,
    i.order_id,
    'attempt'::text AS stage,
    20 AS stage_order,
    a.id AS record_id,
    a.estado AS status,
    a.provider,
    a.external_id AS provider_reference,
    a.created_at AS occurred_at
   FROM payment_attempts a
     JOIN payment_intents i ON i.id = a.intent_id
UNION ALL
 SELECT t.org_id,
    t.correlation_id,
        CASE
            WHEN t.source = 'ecommerce'::text THEN t.source_id
            ELSE NULL::uuid
        END AS order_id,
    'settlement'::text AS stage,
    40 AS stage_order,
    t.id AS record_id,
    t.status,
    t.provider,
    t.external_id AS provider_reference,
    t.created_at AS occurred_at
   FROM payment_transactions t
UNION ALL
 SELECT e.org_id,
    i.correlation_id,
    i.order_id,
    'event'::text AS stage,
        CASE
            WHEN e.event_type = 'orden.pagada'::text THEN 35
            ELSE 30
        END AS stage_order,
    e.id AS record_id,
    e.event_type AS status,
    NULL::text AS provider,
    NULL::text AS provider_reference,
    e.occurred_at
   FROM domain_events e
     JOIN payment_intents i ON i.org_id = e.org_id AND (e.metadata ->> 'correlation_id'::text) = i.correlation_id::text
UNION ALL
 SELECT le.org_id,
    i.correlation_id,
    i.order_id,
    'ledger'::text AS stage,
    50 AS stage_order,
    le.id AS record_id,
    'asentado'::text AS status,
    NULL::text AS provider,
    NULL::text AS provider_reference,
    le.created_at AS occurred_at
   FROM ledger_entries le
     JOIN payment_intents i ON i.org_id = le.org_id AND i.order_id = le.referencia_id
  WHERE le.referencia_tipo = 'orden'::text AND le.anulado_por IS NULL AND le.anula_a IS NULL
UNION ALL
 -- ── La orden: el eslabón que faltaba entre el cobro y el stock ───────────
 --
 -- La correlación no está en `ecommerce_orders`, así que se toma de la
 -- intención de pago de esa misma orden. Es lo que permite que la traza no se
 -- corte entre "se intentó cobrar" y "la orden quedó paga".
 SELECT o.org_id,
    i.correlation_id,
    o.id AS order_id,
    'order'::text AS stage,
    25 AS stage_order,
    o.id AS record_id,
    o.payment_status AS status,
    o.payment_method AS provider,
    o.order_number AS provider_reference,
    o.created_at AS occurred_at
   FROM ecommerce_orders o
   JOIN LATERAL (
     SELECT pi.correlation_id FROM payment_intents pi
      WHERE pi.order_id = o.id AND pi.correlation_id IS NOT NULL
      ORDER BY pi.created_at DESC LIMIT 1
   ) i ON true
UNION ALL
 -- ── El inventario ────────────────────────────────────────────────────────
 --
 -- Un cobro que no movió stock es una venta que nadie va a despachar, y hoy eso
 -- sólo se descubre mirando el Kardex a mano.
 SELECT m.org_id,
    i.correlation_id,
    o.ord AS order_id,
    'inventory'::text AS stage,
    45 AS stage_order,
    m.id AS record_id,
    m.movement_type AS status,
    NULL::text AS provider,
    m.quantity::text AS provider_reference,
    m.created_at AS occurred_at
   FROM stock_movements m
   -- El movimiento referencia la VENTA, no la orden: se llega a la orden por
   -- `sales.ecommerce_order_id`. Asumir lo contrario es lo que dejaba el asiento
   -- de la orden sin costo de mercaderia (ver 20260825000060).
   JOIN LATERAL (
     SELECT COALESCE(s.ecommerce_order_id, m.reference_id) AS ord
       FROM public.sales s WHERE s.id = m.reference_id
     UNION ALL SELECT m.reference_id LIMIT 1
   ) o ON true
   JOIN LATERAL (
     SELECT pi.correlation_id FROM payment_intents pi
      WHERE pi.order_id = o.ord AND pi.correlation_id IS NOT NULL
      ORDER BY pi.created_at DESC LIMIT 1
   ) i ON true
UNION ALL
 -- ── La factura ───────────────────────────────────────────────────────────
 --
 -- Cierra la cadena que el backlog pide: una venta se puede seguir desde el
 -- checkout hasta el comprobante y el asiento sin salir de una consulta.
 SELECT f.org_id,
    i.correlation_id,
    f.ecommerce_order_id AS order_id,
    'invoice'::text AS stage,
    55 AS stage_order,
    f.id AS record_id,
    f.afip_status AS status,
    NULL::text AS provider,
    f.number AS provider_reference,
    f.created_at AS occurred_at
   FROM invoices f
   JOIN LATERAL (
     SELECT pi.correlation_id FROM payment_intents pi
      WHERE pi.order_id = f.ecommerce_order_id AND pi.correlation_id IS NOT NULL
      ORDER BY pi.created_at DESC LIMIT 1
   ) i ON true;

COMMENT ON VIEW public.payment_operation_trace IS
  'Traza de una operacion por correlation_id: intent, attempt, order, settlement, inventory, invoice, event, ledger. Ordenar por stage_order. Una venta de mostrador no aparece: no crea intencion de pago.';
