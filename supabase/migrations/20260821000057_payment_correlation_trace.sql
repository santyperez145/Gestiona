-- F0 / observabilidad de pagos — una operación, una correlación durable.
--
-- Hasta acá cada evento tenía un correlation_id, pero `emitir_evento` generaba
-- uno nuevo cuando el caller no lo enviaba. El checkout, el webhook, la orden,
-- la liquidación y el ledger quedaban correctos por separado y aun así no se
-- podían reconstruir como una sola historia durante un incidente.
--
-- La intención de pago es la autoridad de la correlación. Intentos, eventos,
-- liquidaciones y asientos la derivan server-side; el navegador nunca decide
-- qué operación se une con cuál.

ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS correlation_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_correlation_unica
  ON public.payment_intents (correlation_id);

COMMENT ON COLUMN public.payment_intents.correlation_id IS
  'Identificador opaco y no personal que une checkout, proveedor, webhook, orden, liquidación y ledger.';

ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS correlation_id uuid NOT NULL DEFAULT gen_random_uuid();

-- Las liquidaciones históricas ecommerce se unen a la intención más reciente
-- de su orden. Otros orígenes conservan una correlación propia: siguen siendo
-- rastreables sin inventar una relación con Commerce.
UPDATE public.payment_transactions t
   SET correlation_id = (
     SELECT i.correlation_id
       FROM public.payment_intents i
      WHERE i.org_id = t.org_id
        AND i.order_id = t.source_id
      ORDER BY i.created_at DESC
      LIMIT 1
   )
 WHERE t.source = 'ecommerce'
   AND t.source_id IS NOT NULL
   AND EXISTS (
     SELECT 1
       FROM public.payment_intents i
      WHERE i.org_id = t.org_id
        AND i.order_id = t.source_id
   );

CREATE INDEX IF NOT EXISTS payment_transactions_correlation_idx
  ON public.payment_transactions (org_id, correlation_id, created_at);

COMMENT ON COLUMN public.payment_transactions.correlation_id IS
  'Correlación operativa; en ecommerce siempre se deriva de payment_intents.';

CREATE OR REPLACE FUNCTION public.trg_payment_transaction_correlation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_correlation uuid;
BEGIN
  IF NEW.source = 'ecommerce' AND NEW.source_id IS NOT NULL THEN
    SELECT i.correlation_id INTO v_correlation
      FROM public.payment_intents i
     WHERE i.org_id = NEW.org_id
       AND i.order_id = NEW.source_id
     ORDER BY i.created_at DESC
     LIMIT 1;

    IF v_correlation IS NOT NULL THEN
      -- La base gana incluso si un caller intentara enviar otra correlación.
      NEW.correlation_id := v_correlation;
    END IF;
  END IF;

  IF NEW.correlation_id IS NULL THEN
    NEW.correlation_id := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_payment_transaction_correlation
  ON public.payment_transactions;
CREATE TRIGGER trg_payment_transaction_correlation
  BEFORE INSERT OR UPDATE OF source, source_id, org_id
  ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_payment_transaction_correlation();

-- Todo evento cuyo agregado es una intención de pago hereda automáticamente
-- su correlación. Así los caminos históricos (`pago_intent_crear`, reintentos)
-- también quedan cubiertos sin confiar en que cada caller recuerde metadata.
DO $patch_emitir_evento$
DECLARE
  v_definition text;
  v_old_count integer;
BEGIN
  SELECT pg_get_functiondef('public.emitir_evento(uuid,text,uuid,text,jsonb,jsonb)'::regprocedure)
    INTO v_definition;

  IF strpos(v_definition, 'v_payment_correlation uuid;') = 0 THEN
    v_old_count := (
      length(v_definition) - length(replace(v_definition, '  v_meta    jsonb;', ''))
    ) / length('  v_meta    jsonb;');
    IF v_old_count <> 1 THEN
      RAISE EXCEPTION 'emitir_evento no tiene la declaración esperada';
    END IF;

    v_definition := replace(
      v_definition,
      '  v_meta    jsonb;',
      E'  v_meta    jsonb;\n  v_payment_correlation uuid;'
    );
    v_definition := replace(
      v_definition,
      E'  v_meta := COALESCE(p_metadata, ''{}''::jsonb);\n  IF v_meta->>''correlation_id'' IS NULL THEN',
      E'  v_meta := COALESCE(p_metadata, ''{}''::jsonb);\n'
      || E'  IF p_aggregate_type = ''pago'' THEN\n'
      || E'    SELECT i.correlation_id INTO v_payment_correlation\n'
      || E'      FROM public.payment_intents i WHERE i.id = p_aggregate_id;\n'
      || E'    IF v_payment_correlation IS NOT NULL THEN\n'
      || E'      v_meta := v_meta || jsonb_build_object(''correlation_id'', v_payment_correlation);\n'
      || E'    END IF;\n'
      || E'  END IF;\n'
      || E'  IF v_meta->>''correlation_id'' IS NULL THEN'
    );
    IF strpos(v_definition, 'v_payment_correlation uuid;') = 0
       OR strpos(v_definition, 'SELECT i.correlation_id INTO v_payment_correlation') = 0 THEN
      RAISE EXCEPTION 'No se pudo inyectar la correlación en emitir_evento';
    END IF;
    EXECUTE v_definition;
  END IF;
END
$patch_emitir_evento$;

-- El Edge Function necesita enviar al proveedor el mismo identificador. Se
-- agrega a todas las respuestas del preparador, incluidas las idempotentes.
DO $patch_preparar$
DECLARE
  v_definition text;
  v_old_count integer;
BEGIN
  SELECT pg_get_functiondef('public.pago_intento_preparar(uuid,text,integer,text)'::regprocedure)
    INTO v_definition;

  IF strpos(v_definition, '''correlation_id'', v_intent.correlation_id') = 0 THEN
    v_old_count := (
      length(v_definition) - length(replace(v_definition, '''intent_id'', v_intent.id,', ''))
    ) / length('''intent_id'', v_intent.id,');
    IF v_old_count <> 5 THEN
      RAISE EXCEPTION 'pago_intento_preparar cambió de forma: % retornos encontrados', v_old_count;
    END IF;
    v_definition := replace(
      v_definition,
      '''intent_id'', v_intent.id,',
      E'''intent_id'', v_intent.id,\n        ''correlation_id'', v_intent.correlation_id,'
    );
    EXECUTE v_definition;
  END IF;
END
$patch_preparar$;

-- Los cambios de pago de la orden ocurren dentro de mark_store_order_paid o
-- su reversión. El trigger deriva la correlación por order_id y la entrega al
-- outbox; no depende del orden en que el Edge Function llame sus helpers.
CREATE OR REPLACE FUNCTION public.trg_eventos_de_orden()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_datos jsonb;
  v_correlation uuid;
  v_metadata jsonb := '{}'::jsonb;
BEGIN
  v_datos := jsonb_build_object(
    'order_id', NEW.id, 'order_number', NEW.order_number,
    'total', NEW.total, 'subtotal', NEW.subtotal,
    'shipping_cost', NEW.shipping_cost, 'discount_amount', NEW.discount_amount,
    'tax_amount', NEW.tax_amount, 'currency', 'ARS',
    'customer_email', NEW.customer_email, 'customer_name', NEW.customer_name,
    'payment_method', NEW.payment_method, 'coupon_code', NEW.coupon_code,
    'items', NEW.items);

  IF TG_OP = 'INSERT' THEN
    PERFORM public.emitir_evento(
      NEW.org_id, 'orden', NEW.id, 'orden.creada', v_datos);
    RETURN NEW;
  END IF;

  SELECT i.correlation_id INTO v_correlation
    FROM public.payment_intents i
   WHERE i.org_id = NEW.org_id AND i.order_id = NEW.id
   ORDER BY i.created_at DESC
   LIMIT 1;
  IF v_correlation IS NOT NULL THEN
    v_metadata := jsonb_build_object('correlation_id', v_correlation);
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    PERFORM public.emitir_evento(
      NEW.org_id, 'orden', NEW.id,
      CASE NEW.payment_status
        WHEN 'paid'     THEN 'orden.pagada'
        WHEN 'refunded' THEN 'orden.reembolsada'
        WHEN 'failed'   THEN 'orden.fallida'
        ELSE 'orden.pago_actualizado'
      END,
      v_datos || jsonb_build_object(
        'payment_status', NEW.payment_status,
        'payment_status_anterior', OLD.payment_status,
        'payment_id', NEW.payment_id),
      v_metadata);
  END IF;

  IF NEW.fulfillment_status IS DISTINCT FROM OLD.fulfillment_status THEN
    PERFORM public.emitir_evento(
      NEW.org_id, 'orden', NEW.id,
      CASE NEW.fulfillment_status
        WHEN 'shipped'   THEN 'orden.despachada'
        WHEN 'delivered' THEN 'orden.entregada'
        ELSE 'orden.entrega_actualizada'
      END,
      v_datos || jsonb_build_object(
        'fulfillment_status', NEW.fulfillment_status,
        'tracking_number', NEW.tracking_number,
        'carrier', NEW.carrier),
      v_metadata);
  END IF;

  RETURN NEW;
END;
$fn$;

-- La correlación queda en la metadata de la partida de cobro. El ledger sigue
-- inmutable: no se agrega una columna que después alguien pueda editar.
DO $patch_ledger$
DECLARE
  v_definition text;
  v_old_count integer;
BEGIN
  SELECT pg_get_functiondef('public.ledger_asentar_orden_pagada(jsonb)'::regprocedure)
    INTO v_definition;

  IF strpos(v_definition, '''correlation_id'', v_pt.correlation_id') = 0 THEN
    v_old_count := (
      length(v_definition) - length(replace(v_definition, '''provider'', v_pt.provider);', ''))
    ) / length('''provider'', v_pt.provider);');
    IF v_old_count <> 1 THEN
      RAISE EXCEPTION 'ledger_asentar_orden_pagada cambió de forma: % metadata encontradas', v_old_count;
    END IF;
    v_definition := replace(
      v_definition,
      '''provider'', v_pt.provider);',
      E'''provider'', v_pt.provider,\n      ''correlation_id'', v_pt.correlation_id);'
    );
    EXECUTE v_definition;
  END IF;
END
$patch_ledger$;

-- Contrato de lectura operativo. No expone comprador, payloads, credenciales,
-- costos de producto ni raw del proveedor. security_invoker hace que cada
-- tabla subyacente conserve RLS; ser staff de plataforma no da acceso a la org.
CREATE OR REPLACE VIEW public.payment_operation_trace
WITH (security_invoker = true)
AS
  SELECT
    i.org_id,
    i.correlation_id,
    i.order_id,
    'intent'::text AS stage,
    10 AS stage_order,
    i.id AS record_id,
    i.estado AS status,
    NULL::text AS provider,
    NULL::text AS provider_reference,
    i.created_at AS occurred_at
  FROM public.payment_intents i

  UNION ALL

  SELECT
    i.org_id,
    i.correlation_id,
    i.order_id,
    'attempt'::text,
    20,
    a.id,
    a.estado,
    a.provider,
    a.external_id,
    a.created_at
  FROM public.payment_attempts a
  JOIN public.payment_intents i ON i.id = a.intent_id

  UNION ALL

  SELECT
    t.org_id,
    t.correlation_id,
    CASE WHEN t.source = 'ecommerce' THEN t.source_id ELSE NULL END,
    'settlement'::text,
    40,
    t.id,
    t.status,
    t.provider,
    t.external_id,
    t.created_at
  FROM public.payment_transactions t

  UNION ALL

  SELECT
    e.org_id,
    i.correlation_id,
    i.order_id,
    'event'::text,
    CASE WHEN e.event_type = 'orden.pagada' THEN 35 ELSE 30 END,
    e.id,
    e.event_type,
    NULL::text,
    NULL::text,
    e.occurred_at
  FROM public.domain_events e
  JOIN public.payment_intents i
    ON i.org_id = e.org_id
   AND e.metadata->>'correlation_id' = i.correlation_id::text

  UNION ALL

  SELECT
    le.org_id,
    i.correlation_id,
    i.order_id,
    'ledger'::text,
    50,
    le.id,
    'asentado'::text,
    NULL::text,
    NULL::text,
    le.created_at
  FROM public.ledger_entries le
  JOIN public.payment_intents i
    ON i.org_id = le.org_id
   AND i.order_id = le.referencia_id
  WHERE le.referencia_tipo = 'orden'
    AND le.anulado_por IS NULL
    AND le.anula_a IS NULL;

REVOKE ALL ON public.payment_operation_trace FROM PUBLIC, anon;
GRANT SELECT ON public.payment_operation_trace TO authenticated;

COMMENT ON VIEW public.payment_operation_trace IS
  'Timeline segura de una operación de pago; respeta RLS y omite PII, payloads raw y credenciales.';

DO $verify$
DECLARE
  v_emit text := pg_get_functiondef(
    'public.emitir_evento(uuid,text,uuid,text,jsonb,jsonb)'::regprocedure
  );
  v_prepare text := pg_get_functiondef(
    'public.pago_intento_preparar(uuid,text,integer,text)'::regprocedure
  );
  v_ledger text := pg_get_functiondef(
    'public.ledger_asentar_orden_pagada(jsonb)'::regprocedure
  );
BEGIN
  IF strpos(v_emit, 'SELECT i.correlation_id INTO v_payment_correlation') = 0
     OR strpos(v_prepare, '''correlation_id'', v_intent.correlation_id') = 0
     OR strpos(v_ledger, '''correlation_id'', v_pt.correlation_id') = 0 THEN
    RAISE EXCEPTION 'La correlación no quedó conectada de intent a eventos y ledger';
  END IF;
  IF has_table_privilege('anon', 'public.payment_operation_trace', 'SELECT') THEN
    RAISE EXCEPTION 'La traza de pagos quedó expuesta a anon';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.payment_operation_trace', 'SELECT') THEN
    RAISE EXCEPTION 'La organización no puede leer su traza de pagos';
  END IF;
END
$verify$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260821000057', 'payment_correlation_trace') ON CONFLICT DO NOTHING;
