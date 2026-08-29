-- Verifica `sale.created` sin contactar ningún endpoint externo.
--
-- Recorre la RPC real del POS como `authenticated`, prueba que el ticket, el
-- Domain Event y la entrega del endpoint nazcan juntos, que una reversión no
-- deje cola huérfana y que un miembro no pueda inventar suscripciones por
-- PostgREST. Todo vive dentro de una transacción que termina en ROLLBACK.
--
-- Ejecutar con:
--   npm run db -- --file supabase/verificaciones/20260829_sale_created_outbox_transaccional.sql

BEGIN;

CREATE TEMP TABLE zz_outbox_ctx (
  org_id uuid,
  user_id uuid,
  product_id uuid,
  webhook_id uuid,
  subscription_id uuid,
  transaction_id uuid
) ON COMMIT DROP;
GRANT ALL ON zz_outbox_ctx TO authenticated;

CREATE TEMP TABLE zz_outbox_result (
  paso text,
  esperado text,
  obtenido text
) ON COMMIT DROP;
GRANT ALL ON zz_outbox_result TO authenticated;

INSERT INTO zz_outbox_ctx (org_id, user_id, product_id)
SELECT
  gen_random_uuid(),
  (SELECT user_id FROM public.memberships ORDER BY created_at LIMIT 1),
  gen_random_uuid();

DO $$
BEGIN
  IF (SELECT user_id FROM zz_outbox_ctx) IS NULL THEN
    RAISE EXCEPTION 'La verificación necesita un usuario existente';
  END IF;
END;
$$;

INSERT INTO public.organizations (id, name, slug, owner_user_id)
SELECT
  org_id,
  'ZZ Outbox transaccional',
  'zz-outbox-' || substr(org_id::text, 1, 8),
  user_id
FROM zz_outbox_ctx;

INSERT INTO public.memberships (org_id, user_id, role)
SELECT org_id, user_id, 'owner' FROM zz_outbox_ctx;

INSERT INTO public.products (
  id, org_id, user_id, name, sale_price_ars, stock, is_active
)
SELECT
  product_id, org_id, user_id, 'ZZ Producto outbox', 5000, 10, true
FROM zz_outbox_ctx;

DO $fixture$
DECLARE
  v_config jsonb;
  v_sale jsonb;
  v_rollback_tx uuid := gen_random_uuid();
  v_direct_write_blocked boolean := false;
  v_count integer;
  v_payload_subscription uuid;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', (SELECT user_id FROM zz_outbox_ctx),
      'role', 'authenticated'
    )::text,
    true
  );

  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.webhook_config_guardar(
    (SELECT org_id FROM zz_outbox_ctx),
    NULL,
    'ZZ receptor durable',
    'https://hooks.example.com/gestiona-test',
    ARRAY['sale.created'],
    true,
    true,
    2,
    10
  ) INTO v_config;
  EXECUTE 'RESET ROLE';

  UPDATE zz_outbox_ctx
     SET webhook_id = (v_config->>'id')::uuid;

  SELECT id INTO STRICT v_payload_subscription
  FROM public.event_subscriptions
  WHERE org_id = (SELECT org_id FROM zz_outbox_ctx)
    AND nombre = 'outbound-webhook:' || (SELECT webhook_id FROM zz_outbox_ctx)::text;

  UPDATE zz_outbox_ctx SET subscription_id = v_payload_subscription;

  INSERT INTO zz_outbox_result
  SELECT
    'config sincroniza consumidor durable',
    'edge_function/activa/3 intentos',
    destino || '/' || CASE WHEN is_active THEN 'activa' ELSE 'inactiva' END
      || '/' || max_intentos || ' intentos'
  FROM public.event_subscriptions
  WHERE id = v_payload_subscription;

  -- La tabla ya no es una API de escritura. El RPC anterior sí puede operar
  -- porque es SECURITY DEFINER y conserva la guarda owner/admin.
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.event_subscriptions (
      org_id, nombre, patron, destino, objetivo
    ) VALUES (
      (SELECT org_id FROM zz_outbox_ctx),
      'ZZ suscripción inventada',
      'venta.%',
      'edge_function',
      'dispatch-outbound-webhook'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_direct_write_blocked := true;
  END;
  EXECUTE 'RESET ROLE';

  INSERT INTO zz_outbox_result VALUES (
    'miembro no inventa suscripciones',
    'bloqueado',
    CASE WHEN v_direct_write_blocked THEN 'bloqueado' ELSE 'permitido' END
  );

  -- Camino real del mostrador. La RPC inserta el padre, las líneas, stock y
  -- evidencia de cobro dentro del mismo commit.
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.create_sales_transaction_v3(
    (SELECT org_id FROM zz_outbox_ctx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM zz_outbox_ctx),
      'product_name', 'ZZ Producto outbox',
      'quantity', 1,
      'unit_price_ars', 5000,
      'total_ars', 5000,
      'payment_method', 'efectivo',
      'paid', true
    )),
    'pos'
  ) INTO v_sale;
  EXECUTE 'RESET ROLE';

  UPDATE zz_outbox_ctx
     SET transaction_id = (v_sale->>'transaction_id')::uuid;

  SELECT count(*) INTO v_count
  FROM public.domain_events
  WHERE org_id = (SELECT org_id FROM zz_outbox_ctx)
    AND aggregate_type = 'venta'
    AND aggregate_id = (SELECT transaction_id FROM zz_outbox_ctx)
    AND event_type = 'venta.registrada';
  INSERT INTO zz_outbox_result VALUES (
    'ticket emite una historia durable', '1', v_count::text
  );

  SELECT count(*), max(payload->>'subscription_id')::uuid
    INTO v_count, v_payload_subscription
  FROM public.outbox_events
  WHERE org_id = (SELECT org_id FROM zz_outbox_ctx)
    AND subscription_id = (SELECT subscription_id FROM zz_outbox_ctx)
    AND event_type = 'venta.registrada'
    AND objetivo = 'dispatch-outbound-webhook';
  INSERT INTO zz_outbox_result VALUES (
    'ticket encola el endpoint en el mismo commit',
    '1/misma suscripción',
    v_count::text || '/' || CASE
      WHEN v_payload_subscription = (SELECT subscription_id FROM zz_outbox_ctx)
        THEN 'misma suscripción'
      ELSE 'otra suscripción'
    END
  );

  SELECT count(*) INTO v_count
  FROM public.sales
  WHERE org_id = (SELECT org_id FROM zz_outbox_ctx)
    AND sale_transaction_id = (SELECT transaction_id FROM zz_outbox_ctx);
  INSERT INTO zz_outbox_result VALUES (
    'dispatcher podrá releer líneas confirmadas', '1', v_count::text
  );

  -- Un fallo de la transacción revierte también evento y outbox. Se usa el
  -- trigger real de sale_transactions, dentro de una subtransacción abortada.
  BEGIN
    INSERT INTO public.sale_transactions (
      id, org_id, source, created_by, occurred_at
    ) SELECT
      v_rollback_tx, org_id, 'pos', user_id, now()
    FROM zz_outbox_ctx;
    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'rollback esperado';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;

  SELECT
    (SELECT count(*) FROM public.domain_events WHERE aggregate_id = v_rollback_tx)
    + (SELECT count(*) FROM public.outbox_events o
       JOIN public.domain_events e ON e.id = o.event_id
       WHERE e.aggregate_id = v_rollback_tx)
  INTO v_count;
  INSERT INTO zz_outbox_result VALUES (
    'rollback no deja evento ni cola huérfana', '0', v_count::text
  );

  -- Quitar sale.created desactiva la suscripción, sin borrar historial ni filas
  -- que ya pudieran estar en curso.
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.webhook_config_guardar(
    (SELECT org_id FROM zz_outbox_ctx),
    (SELECT webhook_id FROM zz_outbox_ctx),
    'ZZ receptor durable',
    'https://hooks.example.com/gestiona-test',
    ARRAY['automation.triggered'],
    true,
    true,
    2,
    10
  );
  EXECUTE 'RESET ROLE';

  INSERT INTO zz_outbox_result
  SELECT
    'quitar el evento detiene entregas futuras',
    'inactiva',
    CASE WHEN is_active THEN 'activa' ELSE 'inactiva' END
  FROM public.event_subscriptions
  WHERE id = (SELECT subscription_id FROM zz_outbox_ctx);
END;
$fixture$;

SELECT
  paso,
  esperado,
  obtenido,
  CASE WHEN esperado = obtenido THEN 'OK' ELSE 'FALLA' END AS resultado
FROM zz_outbox_result
ORDER BY paso;

DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM zz_outbox_result
  WHERE esperado IS DISTINCT FROM obtenido;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'La verificación de outbox tiene % pasos fallidos', v_bad;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.outbox_events o
    JOIN public.domain_events e ON e.id = o.event_id
    WHERE o.estado = 'descartado'
      AND o.event_type = 'venta.registrada'
      AND o.objetivo = 'ledger_asentar_venta_pos'
      AND NOT EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.sale_transaction_id = e.aggregate_id
      )
  ) THEN
    RAISE EXCEPTION 'La cola conserva incidentes falsos de tickets vacíos';
  END IF;
END;
$$;

ROLLBACK;

-- La última fila es la prueba de limpieza fuera de la transacción.
SELECT count(*) AS restos_zz
FROM public.organizations
WHERE name = 'ZZ Outbox transaccional';
