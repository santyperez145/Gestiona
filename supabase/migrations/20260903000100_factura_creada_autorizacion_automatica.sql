-- Autorización ARCA automática desde la outbox durable.
--
-- `factura.creada` ya nace en la misma transacción que la factura de una
-- venta POS/tienda, pero no tenía consumidor. La UI obligaba al dueño a abrir
-- Facturas y pedir cada CAE. Esta suscripción llama al mismo `afip-authorize`:
-- no crea otro motor fiscal ni confía en ids enviados por el navegador.
--
-- Una falta de respuesta de FECAESolicitar no se reintenta a ciegas. Se guarda
-- primero el número candidato y la Edge Function usa FECompUltimoAutorizado +
-- FECompConsultar, que es el procedimiento de recuperación documentado por
-- ARCA, antes de volver a emitir.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS afip_candidate_number integer,
  ADD COLUMN IF NOT EXISTS afip_candidate_set_at timestamptz;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_afip_candidate_number_valido;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_afip_candidate_number_valido
  CHECK (afip_candidate_number IS NULL OR afip_candidate_number > 0);

COMMENT ON COLUMN public.invoices.afip_candidate_number IS
  'Número calculado y persistido antes de FECAESolicitar. Permite reconciliar una respuesta ambigua sin emitir dos comprobantes.';
COMMENT ON COLUMN public.invoices.afip_candidate_set_at IS
  'Instante en que Nerqia reservó el número candidato para consultar su resultado ante ARCA.';

-- La misma reserva sirve para una persona (actor no nulo y rol revalidado) y
-- para la suscripción interna (actor nulo). EXECUTE permanece exclusivamente
-- en service_role: authenticated no puede convertir NULL en un bypass.
CREATE OR REPLACE FUNCTION public.afip_autorizacion_reservar(
  p_invoice_id   uuid,
  p_requested_by uuid,
  p_punto_venta  integer,
  p_tipo_cbte    integer,
  p_environment  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_invoice record;
  v_lock record;
  v_now timestamptz := now();
  v_key bigint;
BEGIN
  SELECT i.id, i.org_id, i.cae, i.cae_vencimiento, i.numero_afip,
         i.afip_status, i.afip_error, i.afip_environment,
         i.afip_authorization_started_at, i.updated_at,
         i.afip_candidate_number
    INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;
  IF p_requested_by IS NOT NULL AND NOT public.has_org_role(
    v_invoice.org_id, p_requested_by, ARRAY['owner', 'admin']
  ) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden autorizar facturas'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NULLIF(btrim(v_invoice.cae), '') IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'status', 'authorized', 'idempotent', true,
      'invoice_id', v_invoice.id, 'cae', v_invoice.cae,
      'cae_vencimiento', v_invoice.cae_vencimiento,
      'numero_afip', v_invoice.numero_afip,
      'environment', v_invoice.afip_environment
    );
  END IF;

  v_key := hashtextextended(
    v_invoice.org_id::text || ':' || p_punto_venta::text || ':' || p_tipo_cbte::text,
    0
  );
  PERFORM pg_advisory_xact_lock(v_key);

  SELECT l.invoice_id, l.expires_at
    INTO v_lock
  FROM public.afip_authorization_locks l
  WHERE l.org_id = v_invoice.org_id
    AND l.punto_venta = p_punto_venta
    AND l.tipo_cbte = p_tipo_cbte
  FOR UPDATE;

  IF v_lock.invoice_id IS NOT NULL
     AND v_lock.expires_at > v_now
     AND v_lock.invoice_id <> p_invoice_id THEN
    RETURN jsonb_build_object(
      'ok', true, 'status', 'processing', 'acquired', false,
      'reason', 'another_invoice_is_using_sequence'
    );
  END IF;

  IF v_invoice.afip_status = 'processing'
     AND v_invoice.updated_at > v_now - interval '15 minutes'
     AND (v_lock.invoice_id IS NULL OR v_lock.invoice_id = p_invoice_id)
  THEN
    RETURN jsonb_build_object(
      'ok', true, 'status', 'processing', 'acquired', false,
      'reason', 'invoice_authorization_in_progress',
      'candidate_number', v_invoice.afip_candidate_number
    );
  END IF;

  INSERT INTO public.afip_authorization_locks (
    org_id, punto_venta, tipo_cbte, invoice_id, acquired_at, expires_at
  ) VALUES (
    v_invoice.org_id, p_punto_venta, p_tipo_cbte, p_invoice_id,
    v_now, v_now + interval '15 minutes'
  )
  ON CONFLICT (org_id, punto_venta, tipo_cbte) DO UPDATE SET
    invoice_id = EXCLUDED.invoice_id,
    acquired_at = EXCLUDED.acquired_at,
    expires_at = EXCLUDED.expires_at;

  UPDATE public.invoices
     SET afip_status = 'processing',
         afip_error = NULL,
         afip_environment = p_environment,
         afip_authorization_started_at = v_now,
         afip_authorization_requested_by = p_requested_by,
         updated_at = v_now
   WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'ok', true, 'status', 'processing', 'acquired', true,
    'invoice_id', p_invoice_id, 'punto_venta', p_punto_venta,
    'tipo_cbte', p_tipo_cbte, 'environment', p_environment,
    'candidate_number', v_invoice.afip_candidate_number,
    'started_at', v_now
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.afip_autorizacion_reservar(uuid, uuid, integer, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_autorizacion_reservar(uuid, uuid, integer, integer, text)
  TO service_role;

-- El candidato se escribe en una operación corta DESPUÉS de consultar el
-- último autorizado y ANTES del request externo. Nunca se sostiene una
-- transacción SQL mientras se espera a ARCA.
CREATE OR REPLACE FUNCTION public.afip_autorizacion_candidato(
  p_invoice_id uuid,
  p_numero_afip integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_invoice public.invoices;
BEGIN
  IF p_numero_afip IS NULL OR p_numero_afip < 1 THEN
    RAISE EXCEPTION 'Número fiscal candidato inválido';
  END IF;

  SELECT * INTO v_invoice
    FROM public.invoices
   WHERE id = p_invoice_id
   FOR UPDATE;
  IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'Factura no encontrada'; END IF;
  IF v_invoice.cae IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'status', 'authorized', 'idempotent', true,
      'numero_afip', v_invoice.numero_afip, 'cae', v_invoice.cae);
  END IF;
  IF v_invoice.afip_status <> 'processing' THEN
    RAISE EXCEPTION 'La factura no tiene una autorización reservada';
  END IF;
  IF v_invoice.afip_candidate_number IS NOT NULL
     AND v_invoice.afip_candidate_number <> p_numero_afip THEN
    RAISE EXCEPTION 'La factura ya reservó el número fiscal %', v_invoice.afip_candidate_number;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.afip_authorization_locks l
     WHERE l.invoice_id = p_invoice_id AND l.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'La reserva fiscal venció antes de guardar el candidato';
  END IF;

  UPDATE public.invoices SET
    afip_candidate_number = COALESCE(afip_candidate_number, p_numero_afip),
    afip_candidate_set_at = COALESCE(afip_candidate_set_at, now()),
    updated_at = now()
  WHERE id = p_invoice_id;

  UPDATE public.afip_authorization_locks
     SET expires_at = now() + interval '15 minutes'
   WHERE invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'ok', true, 'status', 'processing', 'candidate_number', p_numero_afip);
END;
$fn$;

REVOKE ALL ON FUNCTION public.afip_autorizacion_candidato(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_autorizacion_candidato(uuid, integer)
  TO service_role;

-- Si la identidad o el comprobante son inválidos, el fallo ocurre antes de
-- tomar una reserva. Se persiste con una función estrecha para que Facturas lo
-- muestre y no parezca que la automatización nunca se ejecutó. Una operación
-- ya en curso no se pisa: primero hay que reconciliar su respuesta ambigua.
CREATE OR REPLACE FUNCTION public.afip_autorizacion_preflight_error(
  p_invoice_id uuid,
  p_status text,
  p_error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_invoice public.invoices;
BEGIN
  IF p_status NOT IN ('config_error', 'validation_error') THEN
    RAISE EXCEPTION 'Estado fiscal previo inválido: %', p_status;
  END IF;
  IF NULLIF(btrim(p_error), '') IS NULL THEN
    RAISE EXCEPTION 'El error fiscal previo no puede estar vacío';
  END IF;

  SELECT * INTO v_invoice
    FROM public.invoices
   WHERE id = p_invoice_id
   FOR UPDATE;
  IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'Factura no encontrada'; END IF;
  IF NULLIF(btrim(v_invoice.cae), '') IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'status', 'authorized', 'idempotent', true,
      'invoice_id', p_invoice_id, 'cae', v_invoice.cae);
  END IF;
  IF v_invoice.afip_status = 'processing' THEN
    RETURN jsonb_build_object(
      'ok', true, 'status', 'processing', 'idempotent', true,
      'invoice_id', p_invoice_id);
  END IF;

  UPDATE public.invoices
     SET afip_status = p_status,
         afip_error = left(p_error, 2000),
         updated_at = now()
   WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'ok', true, 'status', p_status, 'invoice_id', p_invoice_id,
    'error', left(p_error, 2000));
END;
$fn$;

REVOKE ALL ON FUNCTION public.afip_autorizacion_preflight_error(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_autorizacion_preflight_error(uuid, text, text)
  TO service_role;

-- El candidato también forma parte de la historia de un comprobante con CAE.
CREATE OR REPLACE FUNCTION public.trg_factura_autorizada_inmutable()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF OLD.cae IS NULL THEN RETURN NEW; END IF;

  IF NEW.total IS DISTINCT FROM OLD.total
     OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
     OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
     OR NEW.tax_pct IS DISTINCT FROM OLD.tax_pct
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
     OR NEW.customer_tax_id IS DISTINCT FROM OLD.customer_tax_id
     OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
     OR NEW.tipo_comprobante IS DISTINCT FROM OLD.tipo_comprobante
     OR NEW.condicion_iva_receptor IS DISTINCT FROM OLD.condicion_iva_receptor
     OR NEW.numero_afip IS DISTINCT FROM OLD.numero_afip
     OR NEW.cae IS DISTINCT FROM OLD.cae
     OR NEW.cae_vencimiento IS DISTINCT FROM OLD.cae_vencimiento
     OR NEW.emisor_razon_social IS DISTINCT FROM OLD.emisor_razon_social
     OR NEW.emisor_cuit IS DISTINCT FROM OLD.emisor_cuit
     OR NEW.emisor_domicilio IS DISTINCT FROM OLD.emisor_domicilio
     OR NEW.emisor_condicion_iva IS DISTINCT FROM OLD.emisor_condicion_iva
     OR NEW.emisor_ingresos_brutos IS DISTINCT FROM OLD.emisor_ingresos_brutos
     OR NEW.emisor_inicio_actividades IS DISTINCT FROM OLD.emisor_inicio_actividades
     OR NEW.punto_venta IS DISTINCT FROM OLD.punto_venta
     OR NEW.receptor_tipo_documento IS DISTINCT FROM OLD.receptor_tipo_documento
     OR NEW.moneda_cotizacion IS DISTINCT FROM OLD.moneda_cotizacion
     OR NEW.codigo_autorizacion_tipo IS DISTINCT FROM OLD.codigo_autorizacion_tipo
     OR NEW.arca_qr_payload IS DISTINCT FROM OLD.arca_qr_payload
     OR NEW.fiscal_snapshot_source IS DISTINCT FROM OLD.fiscal_snapshot_source
     OR NEW.fiscal_issued_at IS DISTINCT FROM OLD.fiscal_issued_at
     OR NEW.afip_candidate_number IS DISTINCT FROM OLD.afip_candidate_number
     OR NEW.afip_candidate_set_at IS DISTINCT FROM OLD.afip_candidate_set_at THEN
    RAISE EXCEPTION
      'La factura % ya fue autorizada por ARCA (CAE %) y no se puede modificar. Para corregirla, emitir una nota de credito.',
      OLD.number, OLD.cae USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

INSERT INTO public.event_subscriptions (
  org_id, nombre, patron, destino, objetivo, config, is_active, max_intentos, updated_at
)
VALUES (
  NULL,
  'facturacion: autorizar comprobante creado',
  'factura.creada',
  'edge_function',
  'afip-authorize',
  jsonb_build_object('mode', 'automatic', 'authority', 'outbox'),
  true,
  10,
  now()
), (
  NULL,
  'facturacion: autorizar nota de credito creada',
  'nota_credito.creada',
  'edge_function',
  'afip-authorize',
  jsonb_build_object('mode', 'automatic', 'authority', 'outbox'),
  true,
  10,
  now()
)
ON CONFLICT (
  COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid), nombre
)
DO UPDATE SET
  patron = EXCLUDED.patron,
  destino = EXCLUDED.destino,
  objetivo = EXCLUDED.objetivo,
  config = EXCLUDED.config,
  is_active = true,
  max_intentos = EXCLUDED.max_intentos,
  updated_at = now();

DO $guard$
DECLARE v_subscriptions int; v_columns int;
BEGIN
  SELECT count(*) INTO v_columns
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'invoices'
     AND column_name IN ('afip_candidate_number', 'afip_candidate_set_at');
  SELECT count(*) INTO v_subscriptions
    FROM public.event_subscriptions
   WHERE org_id IS NULL
     AND (
       (nombre = 'facturacion: autorizar comprobante creado' AND patron = 'factura.creada')
       OR (nombre = 'facturacion: autorizar nota de credito creada' AND patron = 'nota_credito.creada')
     )
     AND destino = 'edge_function'
     AND objetivo = 'afip-authorize'
     AND is_active;

  IF v_columns <> 2 OR v_subscriptions <> 2 THEN
    RAISE EXCEPTION 'autorización fiscal automática incompleta: columnas %, suscripciones %',
      v_columns, v_subscriptions;
  END IF;
  IF has_function_privilege(
    'authenticated', 'public.afip_autorizacion_candidato(uuid,integer)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated puede fijar un número fiscal candidato';
  END IF;
  IF has_function_privilege(
    'authenticated', 'public.afip_autorizacion_reservar(uuid,uuid,integer,integer,text)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated puede reservar una autorización fiscal';
  END IF;
  IF has_function_privilege(
    'authenticated', 'public.afip_autorizacion_preflight_error(uuid,text,text)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated puede escribir un error fiscal previo';
  END IF;
END;
$guard$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260903000100', 'factura_creada_autorizacion_automatica')
ON CONFLICT DO NOTHING;
