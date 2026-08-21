-- P0.4 groundwork — reserve ARCA authorization server-side.
--
-- FECompUltimoAutorizado + FECAESolicitar is not an idempotent API. The
-- invoice row alone is not enough: two different invoices can read the same
-- next number for one point of sale and receipt type. Keep a short-lived
-- lease for that ARCA sequence and make the invoice transition explicit.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS afip_authorization_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS afip_authorization_requested_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_afip_status_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_afip_status_check
  CHECK (afip_status IN (
    'pending', 'processing', 'authorized', 'rejected', 'error',
    'config_error', 'network_error', 'validation_error', 'not_applicable'
  ));

CREATE TABLE IF NOT EXISTS public.afip_authorization_locks (
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  punto_venta   integer NOT NULL CHECK (punto_venta > 0),
  tipo_cbte     integer NOT NULL CHECK (tipo_cbte > 0),
  invoice_id    uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  acquired_at   timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  PRIMARY KEY (org_id, punto_venta, tipo_cbte)
);

CREATE UNIQUE INDEX IF NOT EXISTS afip_authorization_locks_invoice_idx
  ON public.afip_authorization_locks(invoice_id);

ALTER TABLE public.afip_authorization_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.afip_authorization_locks FROM PUBLIC, anon, authenticated;

-- Reserve one invoice and one ARCA sequence at a time. The edge function
-- authenticates the user, while this function rechecks the role because the
-- service-role client would otherwise bypass the organization's RLS policy.
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
         i.afip_authorization_started_at, i.updated_at
    INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;
  IF NOT public.has_org_role(
    v_invoice.org_id, p_requested_by, ARRAY['owner', 'admin']
  ) THEN
    RAISE EXCEPTION 'Sólo el dueño o un administrador pueden autorizar facturas'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A retry after a successful provider response is a read, never another
  -- request to ARCA.
  IF NULLIF(btrim(v_invoice.cae), '') IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'status', 'authorized', 'idempotent', true,
      'invoice_id', v_invoice.id, 'cae', v_invoice.cae,
      'cae_vencimiento', v_invoice.cae_vencimiento,
      'numero_afip', v_invoice.numero_afip,
      'environment', v_invoice.afip_environment
    );
  END IF;

  -- Advisory locking makes the lock-row read/insert atomic even when two
  -- invoices try to reserve a previously unused point/type pair together.
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

  -- A live processing state is authoritative for the current attempt. The
  -- 15-minute lease is the recovery window for a crashed edge invocation.
  IF v_invoice.afip_status = 'processing'
     AND v_invoice.updated_at > v_now - interval '15 minutes'
     AND (v_lock.invoice_id IS NULL OR v_lock.invoice_id = p_invoice_id)
  THEN
    RETURN jsonb_build_object(
      'ok', true, 'status', 'processing', 'acquired', false,
      'reason', 'invoice_authorization_in_progress'
    );
  END IF;

  INSERT INTO public.afip_authorization_locks (
    org_id, punto_venta, tipo_cbte, invoice_id, acquired_at, expires_at
  )
  VALUES (
    v_invoice.org_id, p_punto_venta, p_tipo_cbte, p_invoice_id,
    v_now, v_now + interval '15 minutes'
  )
  ON CONFLICT (org_id, punto_venta, tipo_cbte) DO UPDATE
    SET invoice_id = EXCLUDED.invoice_id,
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
    'started_at', v_now
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.afip_autorizacion_reservar(uuid, uuid, integer, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_autorizacion_reservar(uuid, uuid, integer, integer, text)
  TO service_role;

-- Finish or keep an authorization attempt. A processing result deliberately
-- keeps the sequence lease: an unknown network response must be reconciled or
-- allowed to expire, never immediately retried as a new ARCA request.
CREATE OR REPLACE FUNCTION public.afip_autorizacion_resultado(
  p_invoice_id      uuid,
  p_status          text,
  p_cae             text DEFAULT NULL,
  p_cae_vencimiento date DEFAULT NULL,
  p_numero_afip     integer DEFAULT NULL,
  p_environment     text DEFAULT NULL,
  p_error           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_invoice record;
BEGIN
  IF p_status NOT IN (
    'processing', 'authorized', 'rejected', 'error', 'config_error',
    'network_error', 'validation_error'
  ) THEN
    RAISE EXCEPTION 'Estado AFIP no válido: %', p_status;
  END IF;

  -- Never turn an ambiguous provider response into a free retry. The edge
  -- function already maps this value, but the database keeps the invariant
  -- for every future service-role caller too.
  IF p_status = 'network_error' THEN
    p_status := 'processing';
  END IF;

  IF p_status = 'authorized'
     AND (NULLIF(btrim(p_cae), '') IS NULL OR p_numero_afip IS NULL) THEN
    RAISE EXCEPTION 'Una autorización AFIP necesita CAE y número de comprobante';
  END IF;

  SELECT i.id, i.afip_status, i.cae, i.cae_vencimiento, i.numero_afip,
         i.afip_environment, i.afip_error
    INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Factura no encontrada';
  END IF;

  IF NULLIF(btrim(v_invoice.cae), '') IS NOT NULL THEN
    DELETE FROM public.afip_authorization_locks WHERE invoice_id = p_invoice_id;
    RETURN jsonb_build_object(
      'ok', true, 'status', 'authorized', 'idempotent', true,
      'invoice_id', p_invoice_id, 'cae', v_invoice.cae,
      'cae_vencimiento', v_invoice.cae_vencimiento,
      'numero_afip', v_invoice.numero_afip,
      'environment', v_invoice.afip_environment
    );
  END IF;

  IF v_invoice.afip_status <> 'processing' THEN
    RETURN jsonb_build_object(
      'ok', true, 'status', v_invoice.afip_status, 'idempotent', true,
      'invoice_id', p_invoice_id, 'error', v_invoice.afip_error
    );
  END IF;

  UPDATE public.invoices
     SET afip_status = p_status,
         cae = CASE WHEN p_status = 'authorized' THEN p_cae ELSE NULL END,
         cae_vencimiento = CASE WHEN p_status = 'authorized' THEN p_cae_vencimiento ELSE NULL END,
         numero_afip = CASE WHEN p_status = 'authorized' THEN p_numero_afip ELSE NULL END,
         afip_environment = COALESCE(p_environment, afip_environment),
         afip_error = p_error,
         updated_at = now()
   WHERE id = p_invoice_id;

  IF p_status <> 'processing' THEN
    DELETE FROM public.afip_authorization_locks WHERE invoice_id = p_invoice_id;
  ELSE
    UPDATE public.afip_authorization_locks
       SET expires_at = now() + interval '15 minutes'
     WHERE invoice_id = p_invoice_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'status', p_status, 'invoice_id', p_invoice_id,
    'cae', p_cae, 'cae_vencimiento', p_cae_vencimiento,
    'numero_afip', p_numero_afip, 'error', p_error
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.afip_autorizacion_resultado(uuid, text, text, date, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.afip_autorizacion_resultado(uuid, text, text, date, integer, text, text)
  TO service_role;

COMMENT ON TABLE public.afip_authorization_locks IS
  'Short-lived server-side leases preventing duplicate ARCA numbers per org, point of sale and receipt type.';
