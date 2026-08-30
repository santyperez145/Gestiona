-- POS / Caja — un turno real por organización y ubicación
--
-- El POS mantenía un "turno" en memoria del navegador mientras la ruta
-- /caja/turno escribía cash_sessions. Además, el trigger histórico buscaba la
-- organización por la primera membresía del usuario y creaba un cash_entry por
-- renglón de venta. Un usuario multi-organización podía terminar con el
-- movimiento en el tenant equivocado y un ticket de tres productos parecía
-- tres ventas de caja.
--
-- Este slice no obliga a abrir caja para vender: primero vuelve visible y
-- autoritativa la sesión. Un ticket sin sesión sigue siendo una venta válida y
-- queda con cash_session_id NULL; la UI lo declara como "sin turno" en vez de
-- bloquear el mostrador durante la adopción.

ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS location_id uuid
  REFERENCES public.locations(id) ON DELETE RESTRICT;

ALTER TABLE public.sale_transactions
  ADD COLUMN IF NOT EXISTS cash_session_id uuid
  REFERENCES public.cash_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.cash_entries
  ADD COLUMN IF NOT EXISTS sale_transaction_id uuid
  REFERENCES public.sale_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seller_name text;

CREATE INDEX IF NOT EXISTS cash_sessions_org_location_history_idx
  ON public.cash_sessions (org_id, location_id, opened_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open_per_location_idx
  ON public.cash_sessions (
    org_id,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS sale_transactions_cash_session_idx
  ON public.sale_transactions (cash_session_id, occurred_at DESC)
  WHERE cash_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cash_entries_sale_transaction_idx
  ON public.cash_entries (sale_transaction_id)
  WHERE sale_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cash_entries_one_sale_part_idx
  ON public.cash_entries (
    session_id, sale_transaction_id, payment_method, entry_type
  )
  WHERE entry_type = 'sale_in' AND sale_transaction_id IS NOT NULL;

COMMENT ON COLUMN public.cash_sessions.location_id IS
  'Ubicación física del turno. La unicidad parcial impide dos cajas abiertas sobre el mismo alcance.';
COMMENT ON COLUMN public.sale_transactions.cash_session_id IS
  'Sesión de caja abierta a la que quedó vinculado el ticket POS al confirmarse.';
COMMENT ON COLUMN public.cash_entries.sale_transaction_id IS
  'Ticket comercial autoritativo. Evita representar cada renglón como una venta de caja.';

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cash_sessions'::regclass
      AND conname = 'cash_sessions_status_check'
  ) THEN
    ALTER TABLE public.cash_sessions
      ADD CONSTRAINT cash_sessions_status_check
      CHECK (status IN ('open', 'closed')) NOT VALID;
  END IF;

  -- expected_cash puede ser negativo si un turno devuelve más efectivo del que
  -- ingresó: es una excepción operativa que hay que mostrar, no rechazar.
  ALTER TABLE public.cash_sessions
    DROP CONSTRAINT IF EXISTS cash_sessions_amounts_nonnegative_check;
  ALTER TABLE public.cash_sessions
    ADD CONSTRAINT cash_sessions_amounts_nonnegative_check
    CHECK (
      opening_amount >= 0
      AND (closing_amount IS NULL OR closing_amount >= 0)
    ) NOT VALID;
END
$constraints$;

ALTER TABLE public.cash_sessions VALIDATE CONSTRAINT cash_sessions_status_check;
ALTER TABLE public.cash_sessions VALIDATE CONSTRAINT cash_sessions_amounts_nonnegative_check;

-- Las lecturas respetan la matriz POS. Abrir/cerrar pasa exclusivamente por
-- RPC para que concurrencia, ubicación, importe y auditoría sean server-side.
DROP POLICY IF EXISTS "cash_sessions_org" ON public.cash_sessions;
DROP POLICY IF EXISTS "Org members read cash sessions" ON public.cash_sessions;
CREATE POLICY "Org members read cash sessions"
  ON public.cash_sessions FOR SELECT TO authenticated
  USING (
    public.is_org_member(org_id, auth.uid())
    AND public.has_permission(org_id, 'pos', 'view')
  );

REVOKE INSERT, UPDATE, DELETE ON public.cash_sessions FROM anon, authenticated;
GRANT SELECT ON public.cash_sessions TO authenticated;

-- cash_entries conserva ingreso manual/devolución por ahora, pero ya no basta
-- con ser miembro: lectura requiere POS view y escritura POS edit.
DROP POLICY IF EXISTS "org members manage cash entries" ON public.cash_entries;
DROP POLICY IF EXISTS "Org members read cash entries" ON public.cash_entries;
DROP POLICY IF EXISTS "POS operators create cash entries" ON public.cash_entries;
CREATE POLICY "Org members read cash entries"
  ON public.cash_entries FOR SELECT TO authenticated
  USING (
    public.is_org_member(org_id, auth.uid())
    AND public.has_permission(org_id, 'pos', 'view')
  );
CREATE POLICY "POS operators create cash entries"
  ON public.cash_entries FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(org_id, auth.uid())
    AND created_by = auth.uid()
    AND public.has_permission(org_id, 'pos', 'edit')
  );
REVOKE UPDATE, DELETE ON public.cash_entries FROM anon, authenticated;
GRANT SELECT, INSERT ON public.cash_entries TO authenticated;

CREATE OR REPLACE FUNCTION public.cash_session_expected_cash(
  p_session_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT round(
    session.opening_amount + COALESCE(sum(
      CASE
        WHEN lower(COALESCE(entry.payment_method, 'efectivo')) IN ('efectivo', 'cash')
         AND entry.entry_type IN ('sale_in', 'debt_payment', 'manual_in')
          THEN entry.amount_ars
        WHEN lower(COALESCE(entry.payment_method, 'efectivo')) IN ('efectivo', 'cash')
         AND entry.entry_type IN ('refund_out', 'expense_out', 'supplier_out', 'manual_out')
          THEN -entry.amount_ars
        ELSE 0
      END
    ), 0),
    2
  )
  FROM public.cash_sessions session
  LEFT JOIN public.cash_entries entry ON entry.session_id = session.id
  WHERE session.id = p_session_id
  GROUP BY session.id, session.opening_amount
$function$;

REVOKE ALL ON FUNCTION public.cash_session_expected_cash(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pos_cash_session_open(
  p_org_id uuid,
  p_location_id uuid,
  p_opening_amount numeric DEFAULT 0,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.cash_sessions;
BEGIN
  IF v_actor IS NULL OR NOT public.is_org_member(p_org_id, v_actor) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org_id, 'pos', 'create', 'abrir la caja');

  IF p_opening_amount IS NULL OR p_opening_amount < 0 THEN
    RAISE EXCEPTION 'El monto inicial no puede ser negativo'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_location_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.locations location
    WHERE location.id = p_location_id
      AND location.org_id = p_org_id
      AND location.active
  ) THEN
    RAISE EXCEPTION 'Elegí una sucursal activa de esta organización'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('cash-session:' || p_org_id::text || ':' || p_location_id::text, 0)
  );

  SELECT * INTO v_session
  FROM public.cash_sessions session
  WHERE session.org_id = p_org_id
    AND session.location_id = p_location_id
    AND session.status = 'open'
  FOR UPDATE;

  IF v_session.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'session_id', v_session.id,
      'status', v_session.status,
      'opened_at', v_session.opened_at,
      'reused', true
    );
  END IF;

  INSERT INTO public.cash_sessions (
    org_id, location_id, opened_by, opening_amount, notes, status
  ) VALUES (
    p_org_id, p_location_id, v_actor, round(p_opening_amount, 2),
    NULLIF(left(btrim(COALESCE(p_notes, '')), 1000), ''), 'open'
  ) RETURNING * INTO v_session;

  INSERT INTO public.cash_entries (
    org_id, session_id, entry_type, payment_method, amount_ars,
    reference_type, reference_id, description, created_by
  ) VALUES (
    p_org_id, v_session.id, 'opening', 'efectivo',
    round(p_opening_amount, 2), 'cash_session', v_session.id,
    'Apertura de caja', v_actor
  );

  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
  VALUES (
    v_actor, p_org_id, 'create', 'cash_session', v_session.id,
    jsonb_build_object(
      'location_id', p_location_id,
      'opening_amount', round(p_opening_amount, 2)
    )
  );

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'opened_at', v_session.opened_at,
    'reused', false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.pos_cash_session_open(uuid, uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_cash_session_open(uuid, uuid, numeric, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_cash_session_close(
  p_session_id uuid,
  p_closing_amount numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.cash_sessions;
  v_expected numeric;
  v_difference numeric;
BEGIN
  SELECT * INTO v_session
  FROM public.cash_sessions session
  WHERE session.id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL OR v_actor IS NULL
     OR NOT public.is_org_member(v_session.org_id, v_actor) THEN
    RAISE EXCEPTION 'La sesión no existe o no pertenece a tu organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(v_session.org_id, 'pos', 'edit', 'cerrar la caja');

  IF p_closing_amount IS NULL OR p_closing_amount < 0 THEN
    RAISE EXCEPTION 'El monto de cierre no puede ser negativo'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_session.status = 'closed' THEN
    IF abs(COALESCE(v_session.closing_amount, 0) - round(p_closing_amount, 2)) <= 0.01 THEN
      RETURN jsonb_build_object(
        'session_id', v_session.id,
        'status', 'closed',
        'expected_cash', v_session.expected_cash,
        'difference', v_session.difference,
        'reused', true
      );
    END IF;
    RAISE EXCEPTION 'La caja ya fue cerrada con otro importe'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  v_expected := public.cash_session_expected_cash(v_session.id);
  v_difference := round(p_closing_amount, 2) - v_expected;

  UPDATE public.cash_sessions
  SET closed_by = v_actor,
      closed_at = now(),
      closing_amount = round(p_closing_amount, 2),
      expected_cash = v_expected,
      difference = v_difference,
      notes = COALESCE(NULLIF(left(btrim(COALESCE(p_notes, '')), 1000), ''), notes),
      status = 'closed'
  WHERE id = v_session.id;

  INSERT INTO public.cash_entries (
    org_id, session_id, entry_type, payment_method, amount_ars,
    reference_type, reference_id, description, created_by
  ) VALUES (
    v_session.org_id, v_session.id, 'closing', 'efectivo',
    round(p_closing_amount, 2), 'cash_session', v_session.id,
    'Cierre de caja', v_actor
  );

  INSERT INTO public.audit_logs (user_id, org_id, action, entity_type, entity_id, details)
  VALUES (
    v_actor, v_session.org_id, 'update', 'cash_session', v_session.id,
    jsonb_build_object(
      'location_id', v_session.location_id,
      'expected_cash', v_expected,
      'closing_amount', round(p_closing_amount, 2),
      'difference', v_difference
    )
  );

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'status', 'closed',
    'expected_cash', v_expected,
    'difference', v_difference,
    'reused', false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.pos_cash_session_close(uuid, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_cash_session_close(uuid, numeric, text)
  TO authenticated;

-- Se ejecuta después de capture_pos_payment_transactions dentro de v3. La
-- evidencia de cobro ya está agrupada por medio, por lo que Caja recibe una
-- entrada por ticket/medio y no por producto.
CREATE OR REPLACE FUNCTION public.capture_pos_cash_session(
  p_org_id uuid,
  p_transaction_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_transaction public.sale_transactions;
  v_location_id uuid;
  v_location_count integer;
  v_session public.cash_sessions;
  v_seller text;
  v_lines integer;
  v_part record;
  v_entries integer := 0;
BEGIN
  SELECT * INTO v_transaction
  FROM public.sale_transactions transaction
  WHERE transaction.id = p_transaction_id
    AND transaction.org_id = p_org_id
    AND transaction.source = 'pos'
  FOR UPDATE;

  IF v_transaction.id IS NULL THEN
    RAISE EXCEPTION 'El ticket POS no existe en esta organización';
  END IF;

  SELECT count(DISTINCT sale.location_id), min(sale.location_id::text)::uuid,
         max(NULLIF(btrim(sale.seller_name), '')), count(*)
  INTO v_location_count, v_location_id, v_seller, v_lines
  FROM public.sales sale
  WHERE sale.org_id = p_org_id
    AND sale.sale_transaction_id = p_transaction_id;

  IF v_location_count > 1 THEN
    RAISE EXCEPTION 'Un ticket POS no puede mezclar sucursales';
  END IF;
  IF v_location_id IS NULL THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'location_missing');
  END IF;

  SELECT * INTO v_session
  FROM public.cash_sessions session
  WHERE session.org_id = p_org_id
    AND session.location_id = v_location_id
    AND session.status = 'open'
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object(
      'linked', false,
      'reason', 'no_open_session',
      'location_id', v_location_id
    );
  END IF;

  IF v_transaction.cash_session_id IS NOT NULL
     AND v_transaction.cash_session_id <> v_session.id THEN
    RAISE EXCEPTION 'El ticket ya pertenece a otra sesión de caja';
  END IF;

  UPDATE public.sale_transactions
  SET cash_session_id = v_session.id
  WHERE id = p_transaction_id
    AND cash_session_id IS NULL;

  FOR v_part IN
    SELECT
      COALESCE(NULLIF(lower(btrim(payment.raw->>'sale_method')), ''), payment.method) AS sale_method,
      round(sum(payment.gross_amount), 2) AS amount_ars
    FROM public.payment_transactions payment
    WHERE payment.org_id = p_org_id
      AND payment.source = 'pos'
      AND payment.source_id = p_transaction_id
      AND payment.status NOT IN ('failed', 'cancelled')
    GROUP BY COALESCE(NULLIF(lower(btrim(payment.raw->>'sale_method')), ''), payment.method)
    HAVING round(sum(payment.gross_amount), 2) > 0
  LOOP
    INSERT INTO public.cash_entries (
      org_id, session_id, entry_type, payment_method, amount_ars,
      reference_type, reference_id, sale_transaction_id, description,
      created_by, seller_name
    ) VALUES (
      p_org_id, v_session.id, 'sale_in', v_part.sale_method, v_part.amount_ars,
      'sale_transaction', p_transaction_id, p_transaction_id,
      format('Ticket POS · %s renglón%s', v_lines, CASE WHEN v_lines = 1 THEN '' ELSE 'es' END),
      v_transaction.created_by, v_seller
    )
    ON CONFLICT (session_id, sale_transaction_id, payment_method, entry_type)
      WHERE entry_type = 'sale_in' AND sale_transaction_id IS NOT NULL
    DO UPDATE SET
      amount_ars = EXCLUDED.amount_ars,
      description = EXCLUDED.description,
      seller_name = EXCLUDED.seller_name;
    v_entries := v_entries + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'linked', true,
    'session_id', v_session.id,
    'location_id', v_location_id,
    'entries', v_entries
  );
END
$function$;

REVOKE ALL ON FUNCTION public.capture_pos_cash_session(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- El trigger histórico sigue cubriendo ventas legacy sin sale_transaction_id,
-- pero nunca vuelve a decidir el tenant por la primera membresía.
CREATE OR REPLACE FUNCTION public.trg_sale_cash_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_session uuid;
BEGIN
  IF NEW.sale_transaction_id IS NOT NULL OR NOT NEW.paid THEN
    RETURN NEW;
  END IF;
  IF NEW.payment_method NOT IN ('efectivo', 'transferencia', 'debito', 'credito', 'mayorista') THEN
    RETURN NEW;
  END IF;

  SELECT session.id INTO v_session
  FROM public.cash_sessions session
  WHERE session.org_id = NEW.org_id
    AND session.location_id IS NOT DISTINCT FROM NEW.location_id
    AND session.status = 'open'
  ORDER BY session.opened_at DESC
  LIMIT 1;

  IF v_session IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.cash_entries (
    org_id, session_id, entry_type, payment_method, amount_ars,
    reference_type, reference_id, description, created_by, seller_name
  ) VALUES (
    NEW.org_id, v_session, 'sale_in', COALESCE(NEW.payment_method, 'efectivo'),
    NEW.total_ars, 'sale', NEW.id,
    'Venta legacy: ' || NEW.product_name, NEW.user_id, NEW.seller_name
  );
  RETURN NEW;
END
$function$;

-- v3 conserva precio, stock y payment evidence; suma el enlace de Caja en el
-- mismo commit. Si no hay turno abierto devuelve linked=false sin invalidar la
-- venta.
CREATE OR REPLACE FUNCTION public.create_sales_transaction_v3(
  p_org_id uuid,
  p_sales jsonb,
  p_source text DEFAULT 'pos'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
  v_transaction_id uuid;
  v_payments jsonb;
  v_cash_session jsonb;
BEGIN
  v_result := public.create_sales_transaction_v2(p_org_id, p_sales, p_source);
  v_transaction_id := NULLIF(v_result->>'transaction_id', '')::uuid;

  IF lower(btrim(COALESCE(p_source, 'pos'))) = 'pos' THEN
    v_payments := public.capture_pos_payment_transactions(p_org_id, v_transaction_id);
    v_cash_session := public.capture_pos_cash_session(p_org_id, v_transaction_id);
  ELSE
    v_payments := jsonb_build_object('inserted', 0, 'parts', 0, 'pending', 0);
    v_cash_session := jsonb_build_object('linked', false, 'reason', 'not_pos');
  END IF;

  RETURN v_result || jsonb_build_object(
    'payment_evidence', v_payments,
    'cash_session', v_cash_session
  );
END
$function$;

COMMENT ON FUNCTION public.create_sales_transaction_v3(uuid, jsonb, text) IS
  'Venta autoritativa, evidencia de cobro y vínculo idempotente a la sesión física de la sucursal, en un solo commit.';

REVOKE ALL ON FUNCTION public.create_sales_transaction_v3(uuid, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_transaction_v3(uuid, jsonb, text)
  TO authenticated;

CREATE OR REPLACE VIEW public.cash_session_summary
WITH (security_invoker = true)
AS
SELECT
  session.id AS session_id,
  session.org_id,
  session.opened_at,
  session.closed_at,
  session.status,
  session.opening_amount,
  COALESCE(entries.efectivo_neto, 0) AS efectivo_neto,
  COALESCE(entries.transferencia_total, 0) AS transferencia_total,
  COALESCE(entries.tarjeta_total, 0) AS tarjeta_total,
  COALESCE(entries.total_ventas, 0) AS total_ventas,
  COALESCE(entries.total_cobros, 0) AS total_cobros,
  COALESCE(entries.total_egresos, 0) AS total_egresos,
  COALESCE(entries.total_movements, 0) AS total_movements,
  -- CREATE OR REPLACE VIEW exige conservar nombre y posición de las columnas
  -- históricas. Los campos nuevos se agregan al final para no romper lectores.
  session.location_id,
  session.opened_by,
  session.closed_by,
  session.closing_amount,
  session.expected_cash,
  session.difference,
  COALESCE(tickets.ticket_count, 0) AS ticket_count
FROM public.cash_sessions session
LEFT JOIN LATERAL (
  SELECT
    COALESCE(sum(CASE
      WHEN lower(COALESCE(entry.payment_method, 'efectivo')) IN ('efectivo', 'cash')
       AND entry.entry_type IN ('sale_in', 'debt_payment', 'manual_in') THEN entry.amount_ars
      WHEN lower(COALESCE(entry.payment_method, 'efectivo')) IN ('efectivo', 'cash')
       AND entry.entry_type IN ('refund_out', 'expense_out', 'supplier_out', 'manual_out') THEN -entry.amount_ars
      ELSE 0 END), 0) AS efectivo_neto,
    COALESCE(sum(CASE
      WHEN lower(COALESCE(entry.payment_method, '')) IN ('transferencia', 'transfer', 'bank_transfer')
       AND entry.entry_type IN ('sale_in', 'debt_payment') THEN entry.amount_ars ELSE 0 END), 0) AS transferencia_total,
    COALESCE(sum(CASE
      WHEN lower(COALESCE(entry.payment_method, '')) IN ('debito', 'credito', 'card', 'credit', 'debit')
       AND entry.entry_type IN ('sale_in', 'debt_payment') THEN entry.amount_ars ELSE 0 END), 0) AS tarjeta_total,
    COALESCE(sum(CASE WHEN entry.entry_type = 'sale_in' THEN entry.amount_ars ELSE 0 END), 0) AS total_ventas,
    COALESCE(sum(CASE WHEN entry.entry_type = 'debt_payment' THEN entry.amount_ars ELSE 0 END), 0) AS total_cobros,
    COALESCE(sum(CASE WHEN entry.entry_type IN ('refund_out', 'expense_out', 'supplier_out', 'manual_out') THEN entry.amount_ars ELSE 0 END), 0) AS total_egresos,
    count(*) AS total_movements
  FROM public.cash_entries entry
  WHERE entry.session_id = session.id
) entries ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS ticket_count
  FROM public.sale_transactions transaction
  WHERE transaction.cash_session_id = session.id
) tickets ON true;

GRANT SELECT ON public.cash_session_summary TO authenticated;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829000044', 'pos_turno_autoritativo')
ON CONFLICT DO NOTHING;
