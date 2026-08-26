-- ═══════════════════════════════════════════════════════════════════════════
-- La venta de mostrador entra a la traza
-- ═══════════════════════════════════════════════════════════════════════════
--
-- P0-07 pide poder seguir una venta de punta a punta. La traza quedó completa
-- para el canal online, y con un agujero enorme del otro lado: **el POS no crea
-- intención de pago** —cobra en efectivo, no pasa por el orquestador— y la
-- correlación nacía justamente ahí.
--
-- Resultado: el canal con **34 de las 40 ventas** (medido 2026-08-26) era
-- invisible. Si mañana una venta de mostrador no descuenta stock o no llega al
-- libro, no hay una consulta que lo muestre.
--
-- ── La correlación nace en el ticket ───────────────────────────────────────
--
-- `sale_transactions` ya agrupa los renglones de una venta; es el lugar natural
-- para el identificador. Un default `gen_random_uuid()` alcanza: no hace falta
-- que nadie lo pase, y las ventas viejas se completan en esta misma migración.
--
-- ⚠️ No se reusa el id del ticket como correlación. Son cosas distintas: el id
-- identifica una fila, la correlación identifica una **operación** que puede
-- atravesar varias tablas y, más adelante, varios servicios. Mezclarlos hace
-- que el día que una operación tenga dos tickets —una venta partida, un
-- cambio— no haya cómo unirlos.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sale_transactions
  ADD COLUMN IF NOT EXISTS correlation_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS sale_transactions_correlation_idx
  ON public.sale_transactions (correlation_id);

COMMENT ON COLUMN public.sale_transactions.correlation_id IS
  'Identifica la OPERACION de venta de mostrador a traves de las tablas: ticket, stock, factura y asiento. No es el id de la fila.';

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
     JOIN LATERAL ( SELECT pi.correlation_id
           FROM payment_intents pi
          WHERE pi.order_id = o.id AND pi.correlation_id IS NOT NULL
          ORDER BY pi.created_at DESC
         LIMIT 1) i ON true
UNION ALL
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
     JOIN LATERAL ( SELECT COALESCE(s.ecommerce_order_id, m.reference_id) AS ord
           FROM sales s
          WHERE s.id = m.reference_id
        UNION ALL
         SELECT m.reference_id
 LIMIT 1) o ON true
     JOIN LATERAL ( SELECT pi.correlation_id
           FROM payment_intents pi
          WHERE pi.order_id = o.ord AND pi.correlation_id IS NOT NULL
          ORDER BY pi.created_at DESC
         LIMIT 1) i ON true
UNION ALL
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
     JOIN LATERAL ( SELECT pi.correlation_id
           FROM payment_intents pi
          WHERE pi.order_id = f.ecommerce_order_id AND pi.correlation_id IS NOT NULL
          ORDER BY pi.created_at DESC
         LIMIT 1) i ON true
UNION ALL
 -- ── El ticket de mostrador ───────────────────────────────────────────────
 --
 -- El POS no crea intención de pago —cobra en efectivo, no pasa por el
 -- orquestador— así que hasta ahora **el 85% de las ventas era invisible en la
 -- traza**. Desde 20260826000020 el ticket lleva su propia correlación.
 SELECT t.org_id,
    t.correlation_id,
    NULL::uuid AS order_id,
    'sale'::text AS stage,
    15 AS stage_order,
    t.id AS record_id,
    t.source AS status,
    NULL::text AS provider,
    NULL::text AS provider_reference,
    t.occurred_at
   FROM sale_transactions t
  WHERE t.correlation_id IS NOT NULL
UNION ALL
 -- El stock que movió ese ticket. El movimiento referencia la VENTA, y la
 -- venta pertenece al ticket.
 SELECT m.org_id,
    t.correlation_id,
    NULL::uuid AS order_id,
    'inventory'::text AS stage,
    45 AS stage_order,
    m.id AS record_id,
    m.movement_type AS status,
    NULL::text AS provider,
    m.quantity::text AS provider_reference,
    m.created_at AS occurred_at
   FROM stock_movements m
   JOIN sales s ON s.id = m.reference_id
   JOIN sale_transactions t ON t.id = s.sale_transaction_id
  WHERE t.correlation_id IS NOT NULL
UNION ALL
 -- El comprobante, si se emitió: para el mostrador el vínculo es `sale_id`.
 SELECT f.org_id,
    t.correlation_id,
    NULL::uuid AS order_id,
    'invoice'::text AS stage,
    55 AS stage_order,
    f.id AS record_id,
    f.afip_status AS status,
    NULL::text AS provider,
    f.number AS provider_reference,
    f.created_at AS occurred_at
   FROM invoices f
   JOIN sales s ON s.id = f.sale_id
   JOIN sale_transactions t ON t.id = s.sale_transaction_id
  WHERE t.correlation_id IS NOT NULL
UNION ALL
 -- Y el asiento, que desde H8 existe para el mostrador.
 SELECT e.org_id,
    t.correlation_id,
    NULL::uuid AS order_id,
    'ledger'::text AS stage,
    60 AS stage_order,
    e.id AS record_id,
    CASE WHEN e.anulado_por IS NOT NULL THEN 'anulado' ELSE 'asentado' END AS status,
    NULL::text AS provider,
    e.descripcion AS provider_reference,
    e.created_at AS occurred_at
   FROM ledger_entries e
   JOIN sale_transactions t ON t.id = e.referencia_id
  WHERE e.referencia_tipo = 'venta_pos'
    AND t.correlation_id IS NOT NULL;

COMMENT ON VIEW public.payment_operation_trace IS
  'Traza de una operacion por correlation_id. Online: intent, attempt, order, settlement, inventory, invoice, event, ledger. Mostrador: sale, inventory, invoice, ledger. Ordenar por stage_order.';
