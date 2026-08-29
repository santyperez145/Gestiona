-- `sale.created` salía con un fire-and-forget desde el POS. La venta ya estaba
-- confirmada, pero cerrar la pestaña antes de completar el request perdía el
-- webhook para siempre. El Business Core ya tiene una outbox transaccional:
-- esta migración hace que la configuración pública sea un consumidor de ese
-- mismo evento durable en vez de mantener una segunda tubería frágil.
--
-- La suscripción no guarda URL ni secret. Sólo referencia el webhook por id;
-- `dispatch-outbound-webhook` vuelve a leer la configuración server-side. Un
-- evento estable permite al receptor deduplicar aunque la cola reintente.

-- ── 1. Cada entrega sabe qué suscripción la originó ─────────────────────────
--
-- `emitir_evento` fue extendida por migraciones posteriores (correlation_id),
-- por eso se parchea su definición actual en vez de reescribir una versión
-- histórica y perder ese comportamiento.
DO $patch_emitir_evento$
DECLARE
  v_definition text;
  v_old_count integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.emitir_evento(uuid,text,uuid,text,jsonb,jsonb)'::regprocedure
  ) INTO v_definition;

  IF strpos(v_definition, '''subscription_id'', v_sub.id') = 0 THEN
    v_old_count := (
      length(v_definition) - length(replace(
        v_definition,
        '        ''event_id'',       v_id,',
        ''
      ))
    ) / length('        ''event_id'',       v_id,');

    IF v_old_count <> 1 THEN
      RAISE EXCEPTION 'emitir_evento no tiene el payload esperado';
    END IF;

    v_definition := replace(
      v_definition,
      '        ''event_id'',       v_id,',
      E'        ''event_id'',       v_id,\n'
      || '        ''subscription_id'', v_sub.id,'
    );

    IF strpos(v_definition, '''subscription_id'', v_sub.id') = 0 THEN
      RAISE EXCEPTION 'No se pudo agregar subscription_id a emitir_evento';
    END IF;
    EXECUTE v_definition;
  END IF;
END
$patch_emitir_evento$;

-- ── 2. El worker se identifica ante las Edge Functions ─────────────────────
--
-- Desde 20260828000090 las tareas programadas fallan cerrado y exigen
-- BACKUP_CRON_SECRET. La outbox también corre desde pg_cron, así que debe usar
-- la misma identidad; la anon key por sí sola es pública y no autentica nada.
CREATE OR REPLACE FUNCTION public.outbox_despachar(p_limite int DEFAULT 50)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'vault', 'extensions', 'net'
AS $fn$
DECLARE
  v_url         text;
  v_key         text;
  v_cron_secret text;
  v_fila        public.outbox_events;
  v_sub         public.event_subscriptions;
  v_req         bigint;
  v_n           int := 0;
  v_cuerpo      text;
  v_firma       text;
  v_hdrs        jsonb;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY';
  SELECT decrypted_secret INTO v_cron_secret
    FROM vault.decrypted_secrets WHERE name = 'BACKUP_CRON_SECRET';

  FOR v_fila IN SELECT * FROM public.outbox_tomar(p_limite, 'pg_cron') LOOP
    BEGIN
      SELECT * INTO v_sub
        FROM public.event_subscriptions WHERE id = v_fila.subscription_id;
      v_cuerpo := v_fila.payload::text;

      IF v_fila.destino = 'interno' THEN
        EXECUTE format('SELECT %I($1)', v_fila.objetivo) USING v_fila.payload;
        PERFORM public.outbox_entregado(v_fila.id);
        v_n := v_n + 1;
        CONTINUE;
      END IF;

      IF v_fila.destino = 'edge_function' THEN
        IF v_url IS NULL OR v_key IS NULL OR v_cron_secret IS NULL THEN
          PERFORM public.outbox_fallado(
            v_fila.id,
            'faltan SUPABASE_URL, SUPABASE_ANON_KEY o BACKUP_CRON_SECRET en el vault'
          );
          CONTINUE;
        END IF;

        v_hdrs := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key,
          'apikey', v_key,
          'x-cron-secret', v_cron_secret,
          'X-Gestiona-Event', v_fila.event_type,
          'X-Gestiona-Event-Id', v_fila.event_id::text
        );

        v_req := net.http_post(
          url     := v_url || '/functions/v1/' || v_fila.objetivo,
          body    := v_fila.payload,
          headers := v_hdrs,
          timeout_milliseconds := 15000
        );
      ELSE
        v_hdrs := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Gestiona-Event', v_fila.event_type,
          'X-Gestiona-Event-Id', v_fila.event_id::text,
          'X-Gestiona-Delivery', v_fila.id::text
        );

        IF COALESCE(v_sub.config->>'secret', '') <> '' THEN
          v_firma := encode(
            extensions.hmac(v_cuerpo, v_sub.config->>'secret', 'sha256'),
            'hex'
          );
          v_hdrs := v_hdrs || jsonb_build_object(
            'X-Gestiona-Signature', 'sha256=' || v_firma
          );
        END IF;

        v_req := net.http_post(
          url     := v_fila.objetivo,
          body    := v_fila.payload,
          headers := v_hdrs,
          timeout_milliseconds := 15000
        );
      END IF;

      UPDATE public.outbox_events SET request_id = v_req WHERE id = v_fila.id;
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.outbox_fallado(v_fila.id, left(SQLERRM, 500));
    END;
  END LOOP;

  RETURN v_n;
END;
$fn$;

COMMENT ON FUNCTION public.outbox_despachar(int) IS
  'Despacha la outbox. Las Edge Functions reciben identidad de cron; pg_net se confirma en una segunda pasada.';

-- ── 3. La configuración pública sincroniza una suscripción durable ─────────
CREATE OR REPLACE FUNCTION public.webhook_config_guardar(
  p_org_id uuid,
  p_webhook_id uuid,
  p_name text,
  p_url text,
  p_event_types text[],
  p_active boolean DEFAULT true,
  p_retry_on_fail boolean DEFAULT true,
  p_max_retries integer DEFAULT 2,
  p_timeout_seconds integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_secret text;
  v_url text := btrim(coalesce(p_url, ''));
  v_host text;
  v_supported constant text[] := ARRAY['sale.created', 'automation.triggered'];
  v_sale_active boolean;
  v_max_intentos integer;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo dueños o administradores pueden gestionar webhooks'
      USING ERRCODE = '42501';
  END IF;

  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'El nombre debe tener entre 1 y 120 caracteres'
      USING ERRCODE = '22023';
  END IF;
  IF length(v_url) > 2048
     OR v_url !~* '^https://[^[:space:]/?#]+(?:[/?][^[:space:]#]*)?$'
     OR v_url ~ '#' THEN
    RAISE EXCEPTION 'El endpoint debe ser una URL HTTPS pública válida'
      USING ERRCODE = '22023';
  END IF;
  IF v_url ~* '^https://[^/]*@' THEN
    RAISE EXCEPTION 'El endpoint no puede incluir credenciales'
      USING ERRCODE = '22023';
  END IF;

  v_host := lower((regexp_match(v_url, '^https://([^/:?#]+)'))[1]);
  IF v_host IS NULL
     OR v_host IN ('localhost', 'metadata.google.internal', 'metadata.amazonaws.com')
     OR v_host ~ '\.(local|internal|localhost)$'
     OR v_host ~ '^127\.'
     OR v_host ~ '^10\.'
     OR v_host ~ '^0\.'
     OR v_host ~ '^169\.254\.'
     OR v_host ~ '^192\.168\.'
     OR v_host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.'
     OR v_host ~ '^\[' THEN
    RAISE EXCEPTION 'El endpoint debe resolver a un host público'
      USING ERRCODE = '22023';
  END IF;

  IF coalesce(array_length(p_event_types, 1), 0) = 0
     OR EXISTS (
       SELECT 1 FROM unnest(p_event_types) AS event_name
       WHERE event_name IS NULL OR NOT (event_name = ANY(v_supported))
     ) THEN
    RAISE EXCEPTION 'Seleccioná al menos un evento soportado'
      USING ERRCODE = '22023';
  END IF;
  IF p_max_retries NOT BETWEEN 0 AND 3
     OR p_timeout_seconds NOT BETWEEN 3 AND 15 THEN
    RAISE EXCEPTION 'Reintentos o timeout fuera del rango permitido'
      USING ERRCODE = '22023';
  END IF;

  IF p_webhook_id IS NULL THEN
    INSERT INTO public.webhook_configs (
      org_id, name, url, event_types, active, retry_on_fail,
      max_retries, timeout_seconds
    ) VALUES (
      p_org_id, btrim(p_name), v_url, p_event_types, coalesce(p_active, true),
      coalesce(p_retry_on_fail, true), p_max_retries, p_timeout_seconds
    ) RETURNING id INTO v_id;

    v_secret := 'whsec_' || encode(extensions.gen_random_bytes(32), 'hex');
    INSERT INTO public.webhook_signing_secrets (
      webhook_id, org_id, secret, rotated_by
    ) VALUES (v_id, p_org_id, v_secret, auth.uid());
  ELSE
    UPDATE public.webhook_configs
       SET name = btrim(p_name),
           url = v_url,
           event_types = p_event_types,
           active = coalesce(p_active, true),
           retry_on_fail = coalesce(p_retry_on_fail, true),
           max_retries = p_max_retries,
           timeout_seconds = p_timeout_seconds,
           updated_at = now()
     WHERE id = p_webhook_id AND org_id = p_org_id
     RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Webhook inexistente o fuera de la organización'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  v_sale_active := coalesce(p_active, true)
                   AND 'sale.created' = ANY(p_event_types);
  v_max_intentos := CASE
    WHEN coalesce(p_retry_on_fail, true) THEN 1 + p_max_retries
    ELSE 1
  END;

  INSERT INTO public.event_subscriptions (
    org_id, nombre, patron, destino, objetivo, config,
    is_active, max_intentos, updated_at
  ) VALUES (
    p_org_id,
    'outbound-webhook:' || v_id::text,
    'venta.registrada',
    'edge_function',
    'dispatch-outbound-webhook',
    jsonb_build_object('webhook_id', v_id),
    v_sale_active,
    v_max_intentos,
    now()
  )
  ON CONFLICT (
    COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), nombre
  ) DO UPDATE
     SET patron = EXCLUDED.patron,
         destino = EXCLUDED.destino,
         objetivo = EXCLUDED.objetivo,
         config = EXCLUDED.config,
         is_active = EXCLUDED.is_active,
         max_intentos = EXCLUDED.max_intentos,
         updated_at = now();

  RETURN jsonb_build_object('id', v_id, 'signing_secret', v_secret);
END;
$$;

CREATE OR REPLACE FUNCTION public.webhook_config_eliminar(
  p_org_id uuid,
  p_webhook_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_org_role(p_org_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'Sólo dueños o administradores pueden eliminar webhooks'
      USING ERRCODE = '42501';
  END IF;

  -- Se conserva la fila para que un evento ya encolado mantenga su referencia,
  -- pero queda inactiva y el dispatcher trata el destino eliminado como skip.
  UPDATE public.event_subscriptions
     SET is_active = false, updated_at = now()
   WHERE org_id = p_org_id
     AND nombre = 'outbound-webhook:' || p_webhook_id::text
     AND destino = 'edge_function'
     AND objetivo = 'dispatch-outbound-webhook';

  DELETE FROM public.webhook_configs
   WHERE id = p_webhook_id AND org_id = p_org_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.webhook_config_guardar(
  uuid, uuid, text, text, text[], boolean, boolean, integer, integer
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.webhook_config_eliminar(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.webhook_config_guardar(
  uuid, uuid, text, text, text[], boolean, boolean, integer, integer
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.webhook_config_eliminar(uuid, uuid)
  TO authenticated, service_role;

-- Reconstrucción segura: cada configuración existente obtiene exactamente una
-- suscripción. `sale.created` es el único evento que ya nace en Domain Events;
-- automation.triggered conserva por ahora su productor server-side actual.
INSERT INTO public.event_subscriptions (
  org_id, nombre, patron, destino, objetivo, config,
  is_active, max_intentos, updated_at
)
SELECT
  w.org_id,
  'outbound-webhook:' || w.id::text,
  'venta.registrada',
  'edge_function',
  'dispatch-outbound-webhook',
  jsonb_build_object('webhook_id', w.id),
  coalesce(w.active, true) AND 'sale.created' = ANY(w.event_types),
  CASE
    WHEN coalesce(w.retry_on_fail, true)
      THEN 1 + least(greatest(coalesce(w.max_retries, 0), 0), 3)
    ELSE 1
  END,
  now()
FROM public.webhook_configs w
ON CONFLICT (
  COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), nombre
) DO UPDATE
   SET patron = EXCLUDED.patron,
       destino = EXCLUDED.destino,
       objetivo = EXCLUDED.objetivo,
       config = EXCLUDED.config,
       is_active = EXCLUDED.is_active,
       max_intentos = EXCLUDED.max_intentos,
       updated_at = now();

-- ── 4. Una suscripción es infraestructura, no una tabla editable por cliente ─
DROP POLICY IF EXISTS event_subscriptions_org ON public.event_subscriptions;
DROP POLICY IF EXISTS event_subscriptions_lectura_org ON public.event_subscriptions;
CREATE POLICY event_subscriptions_lectura_org ON public.event_subscriptions
  FOR SELECT USING (
    org_id IS NOT NULL AND public.is_org_member(org_id, auth.uid())
  );

REVOKE ALL ON TABLE public.event_subscriptions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.event_subscriptions FROM authenticated;
GRANT SELECT ON TABLE public.event_subscriptions TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON TABLE public.event_subscriptions TO service_role;

-- ── 5. Higiene de la cola ───────────────────────────────────────────────────
--
-- Medido antes de aplicar: 12 descartados de `venta.registrada`, todos de la
-- suscripción del ledger y todos apuntando a tickets sin un solo renglón. Ocho
-- pertenecían a fixtures cuya organización ya no existe y cuatro a padres
-- vacíos; no representan venta, stock ni dinero. Se borra sólo esa intersección
-- comprobable. `domain_events` permanece como historial append-only.
DELETE FROM public.outbox_events o
USING public.domain_events e
WHERE o.event_id = e.id
  AND o.estado = 'descartado'
  AND o.event_type = 'venta.registrada'
  AND o.objetivo = 'ledger_asentar_venta_pos'
  AND e.aggregate_type = 'venta'
  AND NOT EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.sale_transaction_id = e.aggregate_id
  );

-- ── 6. Guardas ejecutables ──────────────────────────────────────────────────
DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.emitir_evento(uuid,text,uuid,text,jsonb,jsonb)'::regprocedure
  ) INTO v_definition;
  ASSERT strpos(v_definition, '''subscription_id'', v_sub.id') > 0,
    'emitir_evento no identifica la suscripción en el payload';

  SELECT pg_get_functiondef('public.outbox_despachar(integer)'::regprocedure)
    INTO v_definition;
  ASSERT strpos(v_definition, '''x-cron-secret'', v_cron_secret') > 0,
    'la outbox no se identifica ante las Edge Functions';

  ASSERT NOT has_table_privilege(
    'authenticated', 'public.event_subscriptions', 'INSERT'
  ), 'authenticated todavía puede crear suscripciones de infraestructura';
  ASSERT NOT has_table_privilege(
    'authenticated', 'public.event_subscriptions', 'UPDATE'
  ), 'authenticated todavía puede modificar suscripciones de infraestructura';

  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.webhook_configs w
    LEFT JOIN public.event_subscriptions s
      ON s.org_id = w.org_id
     AND s.nombre = 'outbound-webhook:' || w.id::text
     AND s.config->>'webhook_id' = w.id::text
    WHERE s.id IS NULL
  ), 'hay configuraciones de webhook sin suscripción durable';

  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.outbox_events o
    JOIN public.domain_events e ON e.id = o.event_id
    WHERE o.estado = 'descartado'
      AND o.event_type = 'venta.registrada'
      AND o.objetivo = 'ledger_asentar_venta_pos'
      AND e.aggregate_type = 'venta'
      AND NOT EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.sale_transaction_id = e.aggregate_id
      )
  ), 'quedaron incidentes falsos de tickets sin renglones';
END;
$$;

COMMENT ON FUNCTION public.webhook_config_guardar(
  uuid, uuid, text, text, text[], boolean, boolean, integer, integer
) IS
  'Crea/edita un endpoint y sincroniza su consumidor durable de venta.registrada; el secret sólo se devuelve al crear.';
COMMENT ON TABLE public.event_subscriptions IS
  'Consumidores server-managed de Domain Events. Los miembros sólo leen; los RPC sincronizan configuraciones públicas.';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829000010', 'sale_created_vive_en_el_outbox')
ON CONFLICT (version) DO NOTHING;
