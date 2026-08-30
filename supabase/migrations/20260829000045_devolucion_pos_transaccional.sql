-- POS / Ventas — devolución por ticket, atómica e idempotente
--
-- La pantalla histórica insertaba `returns`, reponía stock, actualizaba
-- `sales` y recién después intentaba escribir Caja. Una falla en el último
-- paso confirmaba una devolución partida. También permitía borrar el registro
-- sin compensar stock ni dinero y llamaba "nota de crédito" a un HTML local
-- que nunca había sido autorizado por ARCA.
--
-- Este slice vuelve al servidor autoridad de la operación interna:
--   * el ticket y sus renglones se bloquean antes de calcular;
--   * cantidades e importes salen de la venta original;
--   * cada parte del reintegro está limitada por el cobro original;
--   * efectivo exige una caja abierta en la sucursal y queda asentado allí;
--   * transferencias/tarjetas/QR quedan pendientes hasta evidencia externa;
--   * stock, devolución, caja, obligación, ledger y auditoría nacen en un
--     único commit;
--   * un client_return_id estable hace seguro cada retry.
--
-- La API de un proveedor es una frontera externa y no puede compartir una
-- transacción PostgreSQL. Por eso un reintegro no efectivo no se presenta como
-- realizado: nace `pending_external` contra una cuenta de pasivo y se completa
-- sólo con `sales_return_refund_complete` o con una futura integración privada.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.sales_return_transactions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_transaction_id   uuid REFERENCES public.sale_transactions(id) ON DELETE RESTRICT,
  legacy_sale_id        uuid REFERENCES public.sales(id) ON DELETE RESTRICT,
  client_return_id      uuid NOT NULL,
  request_fingerprint   text NOT NULL,
  status                text NOT NULL DEFAULT 'pending_refund'
                          CHECK (status IN ('completed', 'pending_refund')),
  reason                text NOT NULL,
  notes                 text,
  restock               boolean NOT NULL DEFAULT true,
  refund_amount         numeric(14,2) NOT NULL CHECK (refund_amount > 0),
  currency              text NOT NULL DEFAULT 'ARS' CHECK (currency = 'ARS'),
  cash_session_id       uuid REFERENCES public.cash_sessions(id) ON DELETE SET NULL,
  credit_note_required  boolean NOT NULL DEFAULT false,
  created_by            uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  CONSTRAINT sales_return_ticket_scope_check CHECK (
    (sale_transaction_id IS NOT NULL AND legacy_sale_id IS NULL)
    OR (sale_transaction_id IS NULL AND legacy_sale_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_return_client_id_uidx
  ON public.sales_return_transactions (org_id, client_return_id);
CREATE INDEX IF NOT EXISTS sales_return_ticket_idx
  ON public.sales_return_transactions (org_id, sale_transaction_id, created_at DESC)
  WHERE sale_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_return_status_idx
  ON public.sales_return_transactions (org_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sales_return_refunds (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  return_transaction_id    uuid NOT NULL REFERENCES public.sales_return_transactions(id) ON DELETE CASCADE,
  payment_transaction_id   uuid REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
  sale_method              text NOT NULL,
  provider                 text NOT NULL,
  method                   text NOT NULL,
  amount                   numeric(14,2) NOT NULL CHECK (amount > 0),
  execution_mode           text NOT NULL
                             CHECK (execution_mode IN ('cash', 'manual_external', 'mercadopago_api')),
  status                   text NOT NULL DEFAULT 'pending_external'
                             CHECK (status IN ('completed', 'pending_external', 'failed')),
  external_reference       text,
  failure_reason           text,
  raw                      jsonb,
  completed_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_return_refund_payment_uidx
  ON public.sales_return_refunds (return_transaction_id, payment_transaction_id)
  WHERE payment_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_return_refund_legacy_method_uidx
  ON public.sales_return_refunds (return_transaction_id, sale_method)
  WHERE payment_transaction_id IS NULL;
CREATE INDEX IF NOT EXISTS sales_return_refund_status_idx
  ON public.sales_return_refunds (org_id, status, created_at DESC);

ALTER TABLE public.returns
  ADD COLUMN IF NOT EXISTS return_transaction_id uuid
  REFERENCES public.sales_return_transactions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS tax_amount_ars numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_amount_ars numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.cash_entries
  ADD COLUMN IF NOT EXISTS return_transaction_id uuid
  REFERENCES public.sales_return_transactions(id) ON DELETE RESTRICT;

-- La inmutabilidad es de permisos/RPC, no impide la baja completa de una
-- organización. El CASCADE sólo opera desde la cabecera o el tenant y evita
-- que una FK circular vuelva a romper la eliminación administrativa.
ALTER TABLE public.returns
  DROP CONSTRAINT IF EXISTS returns_return_transaction_id_fkey;
ALTER TABLE public.returns
  ADD CONSTRAINT returns_return_transaction_id_fkey
  FOREIGN KEY (return_transaction_id)
  REFERENCES public.sales_return_transactions(id) ON DELETE CASCADE;
ALTER TABLE public.cash_entries
  DROP CONSTRAINT IF EXISTS cash_entries_return_transaction_id_fkey;
ALTER TABLE public.cash_entries
  ADD CONSTRAINT cash_entries_return_transaction_id_fkey
  FOREIGN KEY (return_transaction_id)
  REFERENCES public.sales_return_transactions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS returns_transaction_idx
  ON public.returns (return_transaction_id)
  WHERE return_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cash_entries_return_transaction_idx
  ON public.cash_entries (return_transaction_id)
  WHERE return_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cash_entries_one_return_part_idx
  ON public.cash_entries (return_transaction_id, payment_method, entry_type)
  WHERE entry_type = 'refund_out' AND return_transaction_id IS NOT NULL;

COMMENT ON TABLE public.sales_return_transactions IS
  'Cabecera inmutable de una devolución de mostrador/manual. Agrupa líneas, reintegros, stock, caja, ledger y auditoría por ticket.';
COMMENT ON TABLE public.sales_return_refunds IS
  'Partes del reintegro contra los cobros originales. pending_external no significa dinero devuelto.';
COMMENT ON COLUMN public.sales_return_transactions.client_return_id IS
  'Identidad idempotente creada una vez por el cliente y reutilizada en cada retry.';
COMMENT ON COLUMN public.sales_return_transactions.credit_note_required IS
  'True si algún renglón tenía una factura con CAE. Gestiona exige el documento fiscal, pero no lo firma automáticamente en nombre del comercio.';

ALTER TABLE public.sales_return_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_return_refunds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sales_return_transactions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.sales_return_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sales_return_transactions, public.sales_return_refunds TO authenticated;

DROP POLICY IF EXISTS "Sales members read return transactions" ON public.sales_return_transactions;
CREATE POLICY "Sales members read return transactions"
  ON public.sales_return_transactions FOR SELECT TO authenticated
  USING (
    public.is_org_member(org_id, auth.uid())
    AND public.has_permission(org_id, 'sales', 'view')
  );

DROP POLICY IF EXISTS "Sales members read return refunds" ON public.sales_return_refunds;
CREATE POLICY "Sales members read return refunds"
  ON public.sales_return_refunds FOR SELECT TO authenticated
  USING (
    public.is_org_member(org_id, auth.uid())
    AND public.has_permission(org_id, 'sales', 'view')
  );

-- La tabla heredada deja de aceptar una secuencia de escrituras desde el
-- navegador. Los RPC de RMA y de tienda son SECURITY DEFINER y siguen siendo
-- sus puertas autorizadas.
DROP POLICY IF EXISTS returns_org ON public.returns;
DROP POLICY IF EXISTS "Org members read returns" ON public.returns;
CREATE POLICY "Org members read returns"
  ON public.returns FOR SELECT TO authenticated
  USING (
    public.is_org_member(org_id, auth.uid())
    AND public.has_permission(org_id, 'sales', 'view')
  );
REVOKE INSERT, UPDATE, DELETE ON public.returns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.returns TO authenticated;

-- Cambiar `returned_quantity` no mueve stock. El trigger anterior corría ante
-- cualquier UPDATE, devolvía todo y lo descontaba otra vez: neto cero, pero dos
-- asientos falsos en el Kardex por cada devolución.
DROP TRIGGER IF EXISTS trg_sale_stock_movement ON public.sales;
CREATE TRIGGER trg_sale_stock_movement
AFTER INSERT OR DELETE OR UPDATE OF product_id, variant_id, quantity, location_id
ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.trg_sale_stock_movement();

-- La prueba destructiva-cero encontró una deuda anterior a este slice: el
-- libro no tenía FK al tenant. Siete fixtures ya eliminadas habían dejado
-- 175 cuentas, 7 asientos y 16 partidas inaccesibles. El libro sigue siendo
-- inmutable mientras la organización existe; sólo se permite la purga cuando
-- el tenant padre ya no existe (limpieza o CASCADE de una baja completa).
CREATE OR REPLACE FUNCTION public.trg_ledger_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (
       SELECT 1 FROM public.organizations organization
       WHERE organization.id = OLD.org_id
     ) THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'ledger_entries' THEN
    IF OLD.anulado_por IS NULL AND NEW.anulado_por IS NOT NULL
       AND NEW.numero = OLD.numero AND NEW.fecha = OLD.fecha
       AND NEW.descripcion = OLD.descripcion THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION
    'El libro es inmutable: % sobre % no esta permitido. Para corregir, usar ledger_contraasentar().',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END
$function$;

-- Sólo borra datos que ya perdieron su tenant. El orden respeta las FK del
-- libro y no alcanza ninguna organización activa.
DELETE FROM public.ledger_lines line
WHERE NOT EXISTS (
  SELECT 1 FROM public.organizations organization
  WHERE organization.id = line.org_id
);
DELETE FROM public.ledger_entries entry
WHERE NOT EXISTS (
  SELECT 1 FROM public.organizations organization
  WHERE organization.id = entry.org_id
);
DELETE FROM public.ledger_accounts account
WHERE NOT EXISTS (
  SELECT 1 FROM public.organizations organization
  WHERE organization.id = account.org_id
);

ALTER TABLE public.ledger_accounts
  DROP CONSTRAINT IF EXISTS ledger_accounts_org_id_fkey;
ALTER TABLE public.ledger_accounts
  ADD CONSTRAINT ledger_accounts_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_org_id_fkey;
ALTER TABLE public.ledger_entries
  ADD CONSTRAINT ledger_entries_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.ledger_lines
  DROP CONSTRAINT IF EXISTS ledger_lines_org_id_fkey;
ALTER TABLE public.ledger_lines
  ADD CONSTRAINT ledger_lines_org_id_fkey
  FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Una devolución aceptada pero todavía no pagada es una deuda al cliente, no
-- una salida bancaria inventada.
CREATE OR REPLACE FUNCTION public.ledger_plan_default(p_org uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_n int := 0;
BEGIN
  INSERT INTO public.ledger_accounts (org_id, codigo, nombre, tipo, imputable, descripcion)
  VALUES
    (p_org, '1',      'Activo',                     'activo',     false, NULL),
    (p_org, '1.1',    'Disponibilidades',           'activo',     false, NULL),
    (p_org, '1.1.01', 'Caja',                       'activo',     true,  'Efectivo en el mostrador'),
    (p_org, '1.1.02', 'Banco',                      'activo',     true,  'Cuenta bancaria'),
    (p_org, '1.1.03', 'MercadoPago a liquidar',     'activo',     true,  'Cobrado y todavia no acreditado'),
    (p_org, '1.1.04', 'MercadoPago disponible',     'activo',     true,  'Acreditado en la cuenta de MercadoPago'),
    (p_org, '1.2',    'Creditos',                   'activo',     false, NULL),
    (p_org, '1.2.01', 'Deudores por ventas',        'activo',     true,  'Lo que los clientes deben'),
    (p_org, '1.3',    'Bienes de cambio',           'activo',     false, NULL),
    (p_org, '1.3.01', 'Mercaderia',                 'activo',     true,  'Stock valorizado'),

    (p_org, '2',      'Pasivo',                     'pasivo',     false, NULL),
    (p_org, '2.1.01', 'Proveedores',                'pasivo',     true,  'Lo que se debe a proveedores'),
    (p_org, '2.1.02', 'IVA debito fiscal',          'pasivo',     true,  'IVA cobrado que se le debe a ARCA'),
    (p_org, '2.1.03', 'Comision de plataforma a pagar', 'pasivo',  true,  'Comision retenida por la plataforma'),
    (p_org, '2.1.04', 'Reintegros a clientes',      'pasivo',     true,  'Devoluciones aceptadas pendientes de pago externo'),

    (p_org, '3',      'Patrimonio neto',            'patrimonio', false, NULL),
    (p_org, '3.1.01', 'Resultado del ejercicio',    'patrimonio', true,  NULL),

    (p_org, '4',      'Ingresos',                   'ingreso',    false, NULL),
    (p_org, '4.1.01', 'Ventas',                     'ingreso',    true,  'Ventas netas de IVA'),
    (p_org, '4.1.02', 'Fletes cobrados',            'ingreso',    true,  'Envio facturado al comprador'),

    (p_org, '5',      'Gastos',                     'gasto',      false, NULL),
    (p_org, '5.1.01', 'Costo de mercaderia vendida','gasto',      true,  NULL),
    (p_org, '5.2.01', 'Comisiones de medios de pago','gasto',     true,  'Lo que cobra MercadoPago'),
    (p_org, '5.2.02', 'Comision de plataforma',     'gasto',      true,  'El marketplace_fee de Gestiona'),
    (p_org, '5.3.01', 'Fletes pagados',             'gasto',      true,  'Lo que se le paga al correo'),
    (p_org, '5.9.01', 'Otros gastos',               'gasto',      true,  NULL)
  ON CONFLICT (org_id, codigo) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$function$;

INSERT INTO public.ledger_accounts (org_id, codigo, nombre, tipo, imputable, descripcion)
SELECT organization.id, '2.1.04', 'Reintegros a clientes', 'pasivo', true,
       'Devoluciones aceptadas pendientes de pago externo'
FROM public.organizations organization
ON CONFLICT (org_id, codigo) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sales_return_refunds_touch()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_sales_return_refunds_touch ON public.sales_return_refunds;
CREATE TRIGGER trg_sales_return_refunds_touch
BEFORE UPDATE ON public.sales_return_refunds
FOR EACH ROW EXECUTE FUNCTION public.sales_return_refunds_touch();

CREATE OR REPLACE FUNCTION public.sales_return_response(p_return_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'ok', true,
    'return_transaction_id', operation.id,
    'sale_transaction_id', operation.sale_transaction_id,
    'legacy_sale_id', operation.legacy_sale_id,
    'status', operation.status,
    'refund_amount', operation.refund_amount,
    'currency', operation.currency,
    'restock', operation.restock,
    'credit_note_required', operation.credit_note_required,
    'cash_session_id', operation.cash_session_id,
    'created_at', operation.created_at,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'return_id', line.id,
        'sale_id', line.sale_id,
        'product_id', line.product_id,
        'variant_id', line.variant_id,
        'product_name', line.product_name,
        'quantity', line.quantity,
        'amount', line.amount_ars
      ) ORDER BY line.created_at, line.id)
      FROM public.returns line
      WHERE line.return_transaction_id = operation.id
    ), '[]'::jsonb),
    'refunds', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'refund_id', refund.id,
        'payment_transaction_id', refund.payment_transaction_id,
        'sale_method', refund.sale_method,
        'provider', refund.provider,
        'method', refund.method,
        'amount', refund.amount,
        'execution_mode', refund.execution_mode,
        'status', refund.status,
        'external_reference', refund.external_reference
      ) ORDER BY refund.created_at, refund.id)
      FROM public.sales_return_refunds refund
      WHERE refund.return_transaction_id = operation.id
    ), '[]'::jsonb)
  )
  FROM public.sales_return_transactions operation
  WHERE operation.id = p_return_id
$function$;

REVOKE ALL ON FUNCTION public.sales_return_response(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.preview_sales_return(
  p_org_id uuid,
  p_sale_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_selected public.sales;
  v_location_id uuid;
  v_location_count integer;
  v_open_session uuid;
  v_lines jsonb;
  v_payments jsonb;
  v_invoices jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_org_member(p_org_id, v_actor) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org_id, 'sales', 'view', 'ver la venta a devolver');

  SELECT * INTO v_selected
  FROM public.sales sale
  WHERE sale.id = p_sale_id AND sale.org_id = p_org_id;
  IF v_selected.id IS NULL THEN
    RAISE EXCEPTION 'La venta no existe en esta organización';
  END IF;
  IF v_selected.source = 'tienda_online' OR v_selected.ecommerce_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'Las órdenes online se devuelven desde RMA para conservar envío, arrepentimiento y reintegro del proveedor';
  END IF;

  SELECT count(DISTINCT sale.location_id), min(sale.location_id::text)::uuid
    INTO v_location_count, v_location_id
  FROM public.sales sale
  WHERE sale.org_id = p_org_id
    AND (
      (v_selected.sale_transaction_id IS NOT NULL AND sale.sale_transaction_id = v_selected.sale_transaction_id)
      OR (v_selected.sale_transaction_id IS NULL AND sale.id = v_selected.id)
    );
  IF v_location_count > 1 THEN
    RAISE EXCEPTION 'El ticket mezcla sucursales y requiere revisión antes de devolver';
  END IF;

  SELECT session.id INTO v_open_session
  FROM public.cash_sessions session
  WHERE session.org_id = p_org_id
    AND session.location_id IS NOT DISTINCT FROM v_location_id
    AND session.status = 'open'
  ORDER BY session.opened_at DESC
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sale_id', sale.id,
    'product_id', sale.product_id,
    'variant_id', sale.variant_id,
    'product_name', sale.product_name,
    'sold_quantity', sale.quantity,
    'returned_quantity', COALESCE(returned.quantity, 0),
    'available_quantity', sale.quantity - COALESCE(returned.quantity, 0),
    'sold_amount', round(sale.total_ars, 2),
    'returned_amount', COALESCE(returned.amount, 0),
    'available_amount', round(sale.total_ars - COALESCE(returned.amount, 0), 2),
    'unit_refund_amount', CASE WHEN sale.quantity > 0
      THEN round(sale.total_ars / sale.quantity, 2) ELSE 0 END,
    'invoice_id', sale.invoice_id,
    'paid', sale.paid
  ) ORDER BY sale.created_at, sale.id), '[]'::jsonb)
  INTO v_lines
  FROM public.sales sale
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(line.quantity), 0)::integer AS quantity,
           round(COALESCE(sum(line.amount_ars), 0), 2) AS amount
    FROM public.returns line
    WHERE line.org_id = p_org_id AND line.sale_id = sale.id
  ) returned ON true
  WHERE sale.org_id = p_org_id
    AND (
      (v_selected.sale_transaction_id IS NOT NULL AND sale.sale_transaction_id = v_selected.sale_transaction_id)
      OR (v_selected.sale_transaction_id IS NULL AND sale.id = v_selected.id)
    );

  IF EXISTS (
    SELECT 1 FROM public.payment_transactions payment
    WHERE payment.org_id = p_org_id
      AND payment.source = 'pos'
      AND payment.source_id = v_selected.sale_transaction_id
      AND payment.status NOT IN ('failed', 'cancelled')
  ) THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'payment_transaction_id', payment.id,
      'sale_method', COALESCE(NULLIF(lower(btrim(payment.raw->>'sale_method')), ''), payment.method),
      'provider', payment.provider,
      'method', payment.method,
      'paid_amount', round(payment.gross_amount, 2),
      'refunded_amount', COALESCE(refunded.amount, 0),
      'available_amount', round(payment.gross_amount - COALESCE(refunded.amount, 0), 2),
      'execution_mode', CASE
        WHEN payment.provider = 'efectivo' OR payment.method = 'cash' THEN 'cash'
        WHEN payment.provider = 'mercadopago'
         AND COALESCE(payment.raw->>'provider_order_id', payment.external_id) IS NOT NULL
          THEN 'mercadopago_api'
        ELSE 'manual_external' END
    ) ORDER BY payment.created_at, payment.id), '[]'::jsonb)
    INTO v_payments
    FROM public.payment_transactions payment
    LEFT JOIN LATERAL (
      SELECT round(COALESCE(sum(refund.amount), 0), 2) AS amount
      FROM public.sales_return_refunds refund
      WHERE refund.payment_transaction_id = payment.id
        AND refund.status <> 'failed'
    ) refunded ON true
    WHERE payment.org_id = p_org_id
      AND payment.source = 'pos'
      AND payment.source_id = v_selected.sale_transaction_id
      AND payment.status NOT IN ('failed', 'cancelled');
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'payment_transaction_id', NULL,
      'sale_method', legacy.sale_method,
      'provider', codes.provider,
      'method', codes.method,
      'paid_amount', legacy.paid_amount,
      'refunded_amount', COALESCE(refunded.amount, 0),
      'available_amount', round(legacy.paid_amount - COALESCE(refunded.amount, 0), 2),
      'execution_mode', CASE WHEN codes.method = 'cash' THEN 'cash' ELSE 'manual_external' END
    ) ORDER BY legacy.sale_method), '[]'::jsonb)
    INTO v_payments
    FROM (
      SELECT lower(btrim(sale.payment_method)) AS sale_method,
             round(sum(sale.total_ars), 2) AS paid_amount
      FROM public.sales sale
      WHERE sale.org_id = p_org_id AND sale.paid
        AND (
          (v_selected.sale_transaction_id IS NOT NULL AND sale.sale_transaction_id = v_selected.sale_transaction_id)
          OR (v_selected.sale_transaction_id IS NULL AND sale.id = v_selected.id)
        )
      GROUP BY lower(btrim(sale.payment_method))
    ) legacy
    CROSS JOIN LATERAL public.pos_payment_method_codes(legacy.sale_method) codes
    LEFT JOIN LATERAL (
      SELECT round(COALESCE(sum(refund.amount), 0), 2) AS amount
      FROM public.sales_return_refunds refund
      JOIN public.sales_return_transactions operation
        ON operation.id = refund.return_transaction_id
      WHERE operation.org_id = p_org_id
        AND operation.sale_transaction_id IS NOT DISTINCT FROM v_selected.sale_transaction_id
        AND operation.legacy_sale_id IS NOT DISTINCT FROM CASE
          WHEN v_selected.sale_transaction_id IS NULL THEN v_selected.id ELSE NULL END
        AND refund.payment_transaction_id IS NULL
        AND refund.sale_method = legacy.sale_method
        AND refund.status <> 'failed'
    ) refunded ON true;
  END IF;

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
    'invoice_id', invoice.id,
    'number', invoice.number,
    'authorized', invoice.cae IS NOT NULL,
    'cae', CASE WHEN invoice.cae IS NULL THEN NULL ELSE 'emitido' END
  )), '[]'::jsonb)
  INTO v_invoices
  FROM public.sales sale
  JOIN public.invoices invoice ON invoice.id = sale.invoice_id
  WHERE sale.org_id = p_org_id
    AND (
      (v_selected.sale_transaction_id IS NOT NULL AND sale.sale_transaction_id = v_selected.sale_transaction_id)
      OR (v_selected.sale_transaction_id IS NULL AND sale.id = v_selected.id)
    );

  RETURN jsonb_build_object(
    'sale_id', v_selected.id,
    'sale_transaction_id', v_selected.sale_transaction_id,
    'ticket_code', upper(right(COALESCE(v_selected.sale_transaction_id, v_selected.id)::text, 8)),
    'source', v_selected.source,
    'customer_name', v_selected.customer_name,
    'sold_at', v_selected.date,
    'location_id', v_location_id,
    'open_cash_session_id', v_open_session,
    'lines', v_lines,
    'payments', v_payments,
    'invoices', v_invoices
  );
END
$function$;

REVOKE ALL ON FUNCTION public.preview_sales_return(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_sales_return(uuid, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.create_sales_return_v1(
  p_org_id uuid,
  p_sale_id uuid,
  p_lines jsonb,
  p_refund_allocations jsonb,
  p_reason text,
  p_notes text DEFAULT NULL,
  p_restock boolean DEFAULT true,
  p_client_return_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_selected public.sales;
  v_existing public.sales_return_transactions;
  v_operation public.sales_return_transactions;
  v_line jsonb;
  v_allocation jsonb;
  v_sale public.sales;
  v_payment public.payment_transactions;
  v_return_id uuid;
  v_refund_id uuid;
  v_variant_name text;
  v_requested_qty integer;
  v_returned_qty integer;
  v_available_qty integer;
  v_returned_amount numeric;
  v_returned_cost numeric;
  v_line_amount numeric;
  v_line_cost numeric;
  v_line_tax numeric;
  v_total numeric := 0;
  v_total_tax numeric := 0;
  v_total_cost numeric := 0;
  v_allocated numeric := 0;
  v_amount numeric;
  v_available_payment numeric;
  v_payment_refunded numeric;
  v_payment_id uuid;
  v_sale_method text;
  v_provider text;
  v_method text;
  v_execution text;
  v_status text;
  v_location_id uuid;
  v_location_count integer;
  v_cash_session uuid;
  v_cash_amount numeric := 0;
  v_fingerprint text;
  v_normalized_lines jsonb := '[]'::jsonb;
  v_normalized_allocations jsonb := '[]'::jsonb;
  v_tax_enabled boolean;
  v_tax_percent numeric;
  v_prices_include_tax boolean;
  v_issuer_type text;
  v_tax_breakdown jsonb;
  v_product_tax numeric;
  v_credit_note_required boolean := false;
  v_ledger_lines jsonb := '[]'::jsonb;
  v_account text;
  v_pending_count integer := 0;
  v_request_id uuid := COALESCE(p_client_return_id, gen_random_uuid());
BEGIN
  IF v_actor IS NULL OR NOT public.is_org_member(p_org_id, v_actor) THEN
    RAISE EXCEPTION 'Sin permiso sobre esta organización'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public.exigir_permiso(p_org_id, 'sales', 'edit', 'registrar la devolución');
  PERFORM public.exigir_permiso(p_org_id, 'payments', 'edit', 'reintegrar el cobro');

  IF p_client_return_id IS NULL THEN
    RAISE EXCEPTION 'Falta la identidad idempotente de la devolución';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Elegí un motivo para la devolución';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_lines) = 0
     OR jsonb_array_length(p_lines) > 100 THEN
    RAISE EXCEPTION 'La devolución debe incluir entre 1 y 100 renglones';
  END IF;
  IF jsonb_typeof(p_refund_allocations) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_refund_allocations) = 0
     OR jsonb_array_length(p_refund_allocations) > 20 THEN
    RAISE EXCEPTION 'Indicá cómo se reparte el reintegro sobre el cobro original';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_lines))
     <> (SELECT count(DISTINCT value->>'sale_id') FROM jsonb_array_elements(p_lines)) THEN
    RAISE EXCEPTION 'Un renglón de venta no puede repetirse en la devolución';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'sales-return:' || p_org_id::text || ':' || v_request_id::text, 0
  ));

  -- La identidad se resuelve antes de mirar saldos mutables. Un retry de una
  -- devolución total encuentra primero su resultado; no falla diciendo que ya
  -- no quedan unidades, que es justamente el efecto del primer intento.
  v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'sale_id', p_sale_id,
    'lines', (SELECT jsonb_agg(value ORDER BY value->>'sale_id') FROM jsonb_array_elements(p_lines)),
    'allocations', (SELECT jsonb_agg(value ORDER BY COALESCE(value->>'payment_transaction_id', value->>'sale_method')) FROM jsonb_array_elements(p_refund_allocations)),
    'reason', btrim(p_reason),
    'notes', NULLIF(btrim(COALESCE(p_notes, '')), ''),
    'restock', COALESCE(p_restock, true)
  )::text, 'UTF8'), 'sha256'::text), 'hex');

  SELECT * INTO v_existing
  FROM public.sales_return_transactions operation
  WHERE operation.org_id = p_org_id
    AND operation.client_return_id = v_request_id
  FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'La identidad de devolución ya fue usada con otro contenido'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN public.sales_return_response(v_existing.id)
      || jsonb_build_object('reused', true);
  END IF;

  SELECT * INTO v_selected
  FROM public.sales sale
  WHERE sale.id = p_sale_id AND sale.org_id = p_org_id
  FOR UPDATE;
  IF v_selected.id IS NULL THEN
    RAISE EXCEPTION 'La venta no existe en esta organización';
  END IF;
  IF v_selected.source = 'tienda_online' OR v_selected.ecommerce_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'Las órdenes online se devuelven desde RMA';
  END IF;
  IF NOT v_selected.paid THEN
    RAISE EXCEPTION 'La venta no figura cobrada; corregí la cobranza antes de reintegrar';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'sales-return-ticket:' || COALESCE(v_selected.sale_transaction_id, v_selected.id)::text, 0
  ));

  SELECT count(DISTINCT sale.location_id), min(sale.location_id::text)::uuid
    INTO v_location_count, v_location_id
  FROM public.sales sale
  WHERE sale.org_id = p_org_id
    AND (
      (v_selected.sale_transaction_id IS NOT NULL AND sale.sale_transaction_id = v_selected.sale_transaction_id)
      OR (v_selected.sale_transaction_id IS NULL AND sale.id = v_selected.id)
    );
  IF v_location_count > 1 THEN
    RAISE EXCEPTION 'El ticket mezcla sucursales y requiere revisión antes de devolver';
  END IF;

  SELECT settings.tax_enabled, settings.tax_iva_percent,
         settings.tax_prices_include_iva, settings.afip_tipo_emisor
    INTO v_tax_enabled, v_tax_percent, v_prices_include_tax, v_issuer_type
  FROM public.settings settings
  WHERE settings.org_id = p_org_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF COALESCE(v_line->>'sale_id', '') !~* '^[0-9a-f-]{36}$'
       OR COALESCE(v_line->>'quantity', '') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Cada renglón necesita una venta y una cantidad entera positiva';
    END IF;
    v_requested_qty := (v_line->>'quantity')::integer;
    SELECT * INTO v_sale
    FROM public.sales sale
    WHERE sale.id = (v_line->>'sale_id')::uuid
      AND sale.org_id = p_org_id
      AND (
        (v_selected.sale_transaction_id IS NOT NULL AND sale.sale_transaction_id = v_selected.sale_transaction_id)
        OR (v_selected.sale_transaction_id IS NULL AND sale.id = v_selected.id)
      )
    FOR UPDATE;
    IF v_sale.id IS NULL THEN
      RAISE EXCEPTION 'Un renglón no pertenece al ticket seleccionado';
    END IF;
    IF NOT v_sale.paid OR v_sale.quantity <= 0 OR v_sale.total_ars <= 0 THEN
      RAISE EXCEPTION 'El renglón % no tiene cantidad e importe cobrados válidos', v_sale.product_name;
    END IF;

    SELECT COALESCE(sum(line.quantity), 0)::integer,
           round(COALESCE(sum(line.amount_ars), 0), 2),
           round(COALESCE(sum(line.cost_amount_ars), 0), 2)
      INTO v_returned_qty, v_returned_amount, v_returned_cost
    FROM public.returns line
    WHERE line.org_id = p_org_id AND line.sale_id = v_sale.id;

    v_available_qty := v_sale.quantity - v_returned_qty;
    IF v_requested_qty > v_available_qty THEN
      RAISE EXCEPTION 'De % se vendieron %, ya se devolvieron % y quedan %',
        v_sale.product_name, v_sale.quantity, v_returned_qty, v_available_qty;
    END IF;

    v_line_amount := CASE WHEN v_requested_qty = v_available_qty
      THEN round(v_sale.total_ars - v_returned_amount, 2)
      ELSE round(v_sale.total_ars * v_requested_qty / v_sale.quantity, 2) END;
    v_line_cost := CASE WHEN v_requested_qty = v_available_qty
      THEN round(v_sale.cost_of_goods_ars - v_returned_cost, 2)
      ELSE round(v_sale.cost_of_goods_ars * v_requested_qty / v_sale.quantity, 2) END;
    IF v_line_amount <= 0 OR v_line_cost < 0 THEN
      RAISE EXCEPTION 'Los importes restantes de % no son conciliables', v_sale.product_name;
    END IF;

    SELECT product.tax_rate INTO v_product_tax
    FROM public.products product
    WHERE product.id = v_sale.product_id AND product.org_id = p_org_id;
    IF public.discrimina_iva(v_issuer_type) AND COALESCE(v_tax_enabled, false) THEN
      v_tax_breakdown := public.desglosar_iva(
        v_line_amount, COALESCE(v_product_tax, v_tax_percent, 0),
        COALESCE(v_prices_include_tax, true)
      );
      v_line_tax := round(COALESCE((v_tax_breakdown->>'iva')::numeric, 0), 2);
    ELSE
      v_line_tax := 0;
    END IF;

    v_total := v_total + v_line_amount;
    v_total_tax := v_total_tax + v_line_tax;
    v_total_cost := v_total_cost + v_line_cost;
    v_normalized_lines := v_normalized_lines || jsonb_build_array(jsonb_build_object(
      'sale_id', v_sale.id,
      'product_id', v_sale.product_id,
      'variant_id', v_sale.variant_id,
      'product_name', v_sale.product_name,
      'quantity', v_requested_qty,
      'amount', v_line_amount,
      'tax', v_line_tax,
      'cost', v_line_cost,
      'location_id', v_sale.location_id,
      'unit_price', v_sale.unit_price_ars
    ));
    v_credit_note_required := v_credit_note_required OR EXISTS (
      SELECT 1 FROM public.invoices invoice
      WHERE invoice.id = v_sale.invoice_id AND invoice.cae IS NOT NULL
    );
  END LOOP;

  v_total := round(v_total, 2);
  v_total_tax := round(v_total_tax, 2);
  v_total_cost := round(v_total_cost, 2);

  FOR v_allocation IN SELECT value FROM jsonb_array_elements(p_refund_allocations)
  LOOP
    IF COALESCE(v_allocation->>'amount', '') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Cada parte del reintegro necesita un importe positivo con hasta dos decimales';
    END IF;
    v_amount := round((v_allocation->>'amount')::numeric, 2);
    IF v_amount <= 0 THEN RAISE EXCEPTION 'El importe a reintegrar debe ser mayor que cero'; END IF;

    v_payment_id := NULLIF(v_allocation->>'payment_transaction_id', '')::uuid;
    IF v_payment_id IS NOT NULL THEN
      SELECT * INTO v_payment
      FROM public.payment_transactions payment
      WHERE payment.id = v_payment_id
        AND payment.org_id = p_org_id
        AND payment.source = 'pos'
        AND payment.source_id = v_selected.sale_transaction_id
        AND payment.status NOT IN ('failed', 'cancelled')
      FOR UPDATE;
      IF v_payment.id IS NULL THEN
        RAISE EXCEPTION 'Una parte del reintegro no pertenece al cobro original';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_normalized_allocations) normalized
        WHERE normalized->>'payment_transaction_id' = v_payment.id::text
      ) THEN
        RAISE EXCEPTION 'Una parte del cobro original no puede repetirse';
      END IF;
      SELECT round(COALESCE(sum(refund.amount), 0), 2)
        INTO v_payment_refunded
      FROM public.sales_return_refunds refund
      WHERE refund.payment_transaction_id = v_payment.id
        AND refund.status <> 'failed';
      v_available_payment := round(v_payment.gross_amount - v_payment_refunded, 2);
      v_sale_method := COALESCE(NULLIF(lower(btrim(v_payment.raw->>'sale_method')), ''), v_payment.method);
      v_provider := v_payment.provider;
      v_method := v_payment.method;
      v_execution := CASE
        WHEN v_provider = 'efectivo' OR v_method = 'cash' THEN 'cash'
        WHEN v_provider = 'mercadopago'
         AND COALESCE(v_payment.raw->>'provider_order_id', v_payment.external_id) IS NOT NULL
          THEN 'mercadopago_api'
        ELSE 'manual_external' END;
    ELSE
      v_sale_method := lower(btrim(COALESCE(v_allocation->>'sale_method', '')));
      IF v_sale_method = '' THEN
        RAISE EXCEPTION 'Falta el medio original del reintegro';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.payment_transactions payment
        WHERE payment.org_id = p_org_id
          AND payment.source = 'pos'
          AND payment.source_id = v_selected.sale_transaction_id
          AND payment.status NOT IN ('failed', 'cancelled')
      ) THEN
        RAISE EXCEPTION 'El ticket tiene evidencia de cobro: usá sus identificadores, no un medio manual';
      END IF;
      SELECT codes.provider, codes.method INTO v_provider, v_method
      FROM public.pos_payment_method_codes(v_sale_method) codes;
      SELECT round(COALESCE(sum(sale.total_ars), 0), 2)
        - round(COALESCE((
          SELECT sum(refund.amount)
          FROM public.sales_return_refunds refund
          JOIN public.sales_return_transactions operation
            ON operation.id = refund.return_transaction_id
          WHERE operation.org_id = p_org_id
            AND operation.sale_transaction_id IS NOT DISTINCT FROM v_selected.sale_transaction_id
            AND operation.legacy_sale_id IS NOT DISTINCT FROM CASE
              WHEN v_selected.sale_transaction_id IS NULL THEN v_selected.id ELSE NULL END
            AND refund.payment_transaction_id IS NULL
            AND refund.sale_method = v_sale_method
            AND refund.status <> 'failed'
        ), 0), 2)
        INTO v_available_payment
      FROM public.sales sale
      WHERE sale.org_id = p_org_id AND sale.paid
        AND lower(btrim(sale.payment_method)) = v_sale_method
        AND (
          (v_selected.sale_transaction_id IS NOT NULL AND sale.sale_transaction_id = v_selected.sale_transaction_id)
          OR (v_selected.sale_transaction_id IS NULL AND sale.id = v_selected.id)
        );
      v_execution := CASE WHEN v_method = 'cash' THEN 'cash' ELSE 'manual_external' END;
    END IF;

    IF v_amount > COALESCE(v_available_payment, 0) + 0.01 THEN
      RAISE EXCEPTION 'El reintegro por % supera el saldo original disponible de %',
        v_sale_method, v_available_payment;
    END IF;
    v_allocated := v_allocated + v_amount;
    v_normalized_allocations := v_normalized_allocations || jsonb_build_array(jsonb_build_object(
      'payment_transaction_id', v_payment_id,
      'sale_method', v_sale_method,
      'provider', v_provider,
      'method', v_method,
      'amount', v_amount,
      'execution_mode', v_execution
    ));
    IF v_execution = 'cash' THEN v_cash_amount := v_cash_amount + v_amount; END IF;
  END LOOP;

  IF abs(round(v_allocated, 2) - v_total) > 0.01 THEN
    RAISE EXCEPTION 'El reintegro suma % y los productos devueltos suman %',
      round(v_allocated, 2), v_total;
  END IF;

  IF v_cash_amount > 0 THEN
    IF v_location_id IS NULL THEN
      RAISE EXCEPTION 'El efectivo requiere una sucursal en la venta original';
    END IF;
    SELECT session.id INTO v_cash_session
    FROM public.cash_sessions session
    WHERE session.org_id = p_org_id
      AND session.location_id = v_location_id
      AND session.status = 'open'
    FOR UPDATE;
    IF v_cash_session IS NULL THEN
      RAISE EXCEPTION 'Abrí la caja de la sucursal antes de devolver efectivo';
    END IF;
  END IF;

  INSERT INTO public.sales_return_transactions (
    org_id, sale_transaction_id, legacy_sale_id, client_return_id,
    request_fingerprint, status, reason, notes, restock, refund_amount,
    currency, cash_session_id, credit_note_required, created_by
  ) VALUES (
    p_org_id, v_selected.sale_transaction_id,
    CASE WHEN v_selected.sale_transaction_id IS NULL THEN v_selected.id ELSE NULL END,
    v_request_id, v_fingerprint, 'pending_refund', left(btrim(p_reason), 300),
    NULLIF(left(btrim(COALESCE(p_notes, '')), 2000), ''),
    COALESCE(p_restock, true), v_total, 'ARS', v_cash_session,
    v_credit_note_required, v_actor
  ) RETURNING * INTO v_operation;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_normalized_lines)
  LOOP
    INSERT INTO public.returns (
      org_id, user_id, sale_id, product_id, variant_id, product_name,
      quantity, amount_ars, reason, refund_method, notes,
      return_transaction_id, tax_amount_ars, cost_amount_ars
    ) VALUES (
      p_org_id, v_actor, (v_line->>'sale_id')::uuid,
      NULLIF(v_line->>'product_id', '')::uuid,
      NULLIF(v_line->>'variant_id', '')::uuid,
      v_line->>'product_name', (v_line->>'quantity')::integer,
      (v_line->>'amount')::numeric, left(btrim(p_reason), 300),
      'original_payment', NULLIF(left(btrim(COALESCE(p_notes, '')), 2000), ''),
      v_operation.id, (v_line->>'tax')::numeric, (v_line->>'cost')::numeric
    ) RETURNING id INTO v_return_id;

    IF COALESCE(p_restock, true) AND NULLIF(v_line->>'product_id', '') IS NOT NULL THEN
      SELECT variant.variant_name INTO v_variant_name
      FROM public.product_variants variant
      WHERE variant.id = NULLIF(v_line->>'variant_id', '')::uuid;
      PERFORM public.record_stock_movement(
        p_org_id => p_org_id,
        p_product_id => NULLIF(v_line->>'product_id', '')::uuid,
        p_variant_id => NULLIF(v_line->>'variant_id', '')::uuid,
        p_product_name => v_line->>'product_name',
        p_variant_name => v_variant_name,
        p_movement_type => 'return_in',
        p_quantity => (v_line->>'quantity')::integer,
        p_reference_type => 'sales_return',
        p_reference_id => v_operation.id,
        p_unit_price_ars => (v_line->>'unit_price')::numeric,
        p_notes => 'Devolución: ' || left(btrim(p_reason), 300),
        p_created_by => v_actor,
        p_location_id => NULLIF(v_line->>'location_id', '')::uuid
      );
    END IF;

    SELECT COALESCE(sum(line.quantity), 0)::integer INTO v_returned_qty
    FROM public.returns line
    WHERE line.org_id = p_org_id AND line.sale_id = (v_line->>'sale_id')::uuid;
    UPDATE public.sales
    SET returned_quantity = v_returned_qty,
        returned = v_returned_qty >= quantity,
        return_id = v_return_id
    WHERE id = (v_line->>'sale_id')::uuid AND org_id = p_org_id;
  END LOOP;

  FOR v_allocation IN SELECT value FROM jsonb_array_elements(v_normalized_allocations)
  LOOP
    v_execution := v_allocation->>'execution_mode';
    v_status := CASE WHEN v_execution = 'cash' THEN 'completed' ELSE 'pending_external' END;
    INSERT INTO public.sales_return_refunds (
      org_id, return_transaction_id, payment_transaction_id, sale_method,
      provider, method, amount, execution_mode, status,
      completed_by, completed_at
    ) VALUES (
      p_org_id, v_operation.id,
      NULLIF(v_allocation->>'payment_transaction_id', '')::uuid,
      v_allocation->>'sale_method', v_allocation->>'provider',
      v_allocation->>'method', (v_allocation->>'amount')::numeric,
      v_execution, v_status,
      CASE WHEN v_status = 'completed' THEN v_actor ELSE NULL END,
      CASE WHEN v_status = 'completed' THEN now() ELSE NULL END
    ) RETURNING id INTO v_refund_id;

    IF v_status = 'completed' THEN
      INSERT INTO public.cash_entries (
        org_id, session_id, entry_type, payment_method, amount_ars,
        reference_type, reference_id, sale_transaction_id,
        return_transaction_id, description, created_by
      ) VALUES (
        p_org_id, v_cash_session, 'refund_out', v_allocation->>'sale_method',
        (v_allocation->>'amount')::numeric, 'sales_return', v_operation.id,
        v_selected.sale_transaction_id, v_operation.id,
        'Reintegro de devolución · ticket ' || upper(right(COALESCE(v_selected.sale_transaction_id, v_selected.id)::text, 8)),
        v_actor
      )
      ON CONFLICT (return_transaction_id, payment_method, entry_type)
        WHERE entry_type = 'refund_out' AND return_transaction_id IS NOT NULL
      DO NOTHING;
    ELSE
      v_pending_count := v_pending_count + 1;
    END IF;
  END LOOP;

  PERFORM public.ledger_plan_default(p_org_id);
  IF v_total - v_total_tax > 0 THEN
    v_ledger_lines := v_ledger_lines || jsonb_build_array(jsonb_build_object(
      'cuenta', '4.1.01', 'debe', round(v_total - v_total_tax, 2),
      'detalle', 'Reversión de venta por devolución'));
  END IF;
  IF v_total_tax > 0 THEN
    v_ledger_lines := v_ledger_lines || jsonb_build_array(jsonb_build_object(
      'cuenta', '2.1.02', 'debe', v_total_tax,
      'detalle', 'Reversión de IVA débito fiscal'));
  END IF;
  FOR v_allocation IN SELECT value FROM jsonb_array_elements(v_normalized_allocations)
  LOOP
    v_account := CASE
      WHEN v_allocation->>'execution_mode' <> 'cash' THEN '2.1.04'
      WHEN v_allocation->>'method' = 'cash' THEN '1.1.01'
      WHEN v_allocation->>'method' = 'transfer' THEN '1.1.02'
      ELSE '1.1.03' END;
    v_ledger_lines := v_ledger_lines || jsonb_build_array(jsonb_build_object(
      'cuenta', v_account, 'haber', (v_allocation->>'amount')::numeric,
      'detalle', CASE WHEN v_account = '2.1.04'
        THEN 'Reintegro externo pendiente' ELSE 'Reintegro completado' END,
      'metadata', jsonb_build_object(
        'return_transaction_id', v_operation.id,
        'sale_method', v_allocation->>'sale_method'
      )
    ));
  END LOOP;
  IF COALESCE(p_restock, true) AND v_total_cost > 0 THEN
    v_ledger_lines := v_ledger_lines || jsonb_build_array(
      jsonb_build_object('cuenta', '1.3.01', 'debe', v_total_cost,
        'detalle', 'Mercadería repuesta por devolución'),
      jsonb_build_object('cuenta', '5.1.01', 'haber', v_total_cost,
        'detalle', 'Reversión del costo de mercadería vendida')
    );
  END IF;
  PERFORM public.ledger_asentar(
    p_org := p_org_id,
    p_descripcion := 'Devolución de ticket ' || upper(right(COALESCE(v_selected.sale_transaction_id, v_selected.id)::text, 8)),
    p_lineas := v_ledger_lines,
    p_fecha := CURRENT_DATE,
    p_ref_tipo := 'devolucion_pos',
    p_ref_id := v_operation.id
  );

  UPDATE public.sales_return_transactions
  SET status = CASE WHEN v_pending_count = 0 THEN 'completed' ELSE 'pending_refund' END,
      completed_at = CASE WHEN v_pending_count = 0 THEN now() ELSE NULL END
  WHERE id = v_operation.id;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id, details, severity, tags
  ) VALUES (
    v_actor, p_org_id, 'create', 'sales_return', v_operation.id::text,
    jsonb_build_object(
      'sale_transaction_id', v_selected.sale_transaction_id,
      'legacy_sale_id', CASE WHEN v_selected.sale_transaction_id IS NULL THEN v_selected.id ELSE NULL END,
      'refund_amount', v_total,
      'restock', COALESCE(p_restock, true),
      'pending_refunds', v_pending_count,
      'credit_note_required', v_credit_note_required,
      'line_count', jsonb_array_length(v_normalized_lines)
    ),
    CASE WHEN v_pending_count > 0 OR v_credit_note_required THEN 'warning' ELSE 'info' END,
    ARRAY['sales', 'return', 'payments', 'inventory']::text[]
  );

  PERFORM public.emitir_evento(
    p_org_id, 'sales_return', v_operation.id, 'venta.devolucion_registrada',
    jsonb_build_object(
      'return_transaction_id', v_operation.id,
      'sale_transaction_id', v_selected.sale_transaction_id,
      'refund_amount', v_total,
      'status', CASE WHEN v_pending_count = 0 THEN 'completed' ELSE 'pending_refund' END
    )
  );

  RETURN public.sales_return_response(v_operation.id)
    || jsonb_build_object('reused', false);
END
$function$;

REVOKE ALL ON FUNCTION public.create_sales_return_v1(
  uuid, uuid, jsonb, jsonb, text, text, boolean, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_return_v1(
  uuid, uuid, jsonb, jsonb, text, text, boolean, uuid
) TO authenticated;

CREATE OR REPLACE FUNCTION public.sales_return_refund_complete(
  p_refund_id uuid,
  p_external_reference text,
  p_raw jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_service boolean := auth.uid() IS NULL AND auth.role() IS NOT DISTINCT FROM 'service_role';
  v_refund public.sales_return_refunds;
  v_operation public.sales_return_transactions;
  v_account text;
  v_session uuid;
  v_pending integer;
BEGIN
  SELECT * INTO v_refund
  FROM public.sales_return_refunds refund
  WHERE refund.id = p_refund_id
  FOR UPDATE;
  IF v_refund.id IS NULL THEN RAISE EXCEPTION 'El reintegro no existe'; END IF;

  SELECT * INTO v_operation
  FROM public.sales_return_transactions operation
  WHERE operation.id = v_refund.return_transaction_id
  FOR UPDATE;
  IF NOT v_service THEN
    IF v_actor IS NULL OR NOT public.is_org_member(v_refund.org_id, v_actor) THEN
      RAISE EXCEPTION 'Sin permiso sobre esta organización'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM public.exigir_permiso(v_refund.org_id, 'payments', 'edit', 'confirmar el reintegro');
    IF v_refund.execution_mode = 'mercadopago_api' THEN
      RAISE EXCEPTION 'El reintegro de Mercado Pago sólo se confirma consultando al proveedor';
    END IF;
  END IF;
  IF v_refund.status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'reused', true, 'refund_id', v_refund.id, 'status', 'completed');
  END IF;
  IF v_refund.status <> 'pending_external' THEN
    RAISE EXCEPTION 'El reintegro está en estado %', v_refund.status;
  END IF;
  IF COALESCE(btrim(p_external_reference), '') = '' THEN
    RAISE EXCEPTION 'La confirmación externa necesita una referencia verificable';
  END IF;

  UPDATE public.sales_return_refunds
  SET status = 'completed',
      external_reference = left(btrim(p_external_reference), 250),
      raw = CASE WHEN p_raw IS NULL THEN raw ELSE p_raw END,
      failure_reason = NULL,
      completed_by = CASE WHEN v_service THEN completed_by ELSE v_actor END,
      completed_at = now()
  WHERE id = v_refund.id;

  v_account := CASE
    WHEN v_refund.method = 'cash' THEN '1.1.01'
    WHEN v_refund.method = 'transfer' THEN '1.1.02'
    ELSE '1.1.03' END;
  PERFORM public.ledger_asentar(
    p_org := v_refund.org_id,
    p_descripcion := 'Pago de reintegro externo',
    p_lineas := jsonb_build_array(
      jsonb_build_object('cuenta', '2.1.04', 'debe', v_refund.amount,
        'detalle', 'Cancela reintegro pendiente'),
      jsonb_build_object('cuenta', v_account, 'haber', v_refund.amount,
        'detalle', 'Salida por reintegro', 'metadata', jsonb_build_object(
          'sales_return_refund_id', v_refund.id,
          'external_reference', left(btrim(p_external_reference), 250)))
    ),
    p_fecha := CURRENT_DATE,
    p_ref_tipo := 'reintegro_pos',
    p_ref_id := v_refund.id
  );

  SELECT session.id INTO v_session
  FROM public.cash_sessions session
  JOIN public.sales sale ON sale.id = COALESCE(
    v_operation.legacy_sale_id,
    (SELECT min(line.sale_id::text)::uuid FROM public.returns line
     WHERE line.return_transaction_id = v_operation.id)
  )
  WHERE session.org_id = v_refund.org_id
    AND session.location_id IS NOT DISTINCT FROM sale.location_id
    AND session.status = 'open'
  ORDER BY session.opened_at DESC LIMIT 1;

  INSERT INTO public.cash_entries (
    org_id, session_id, entry_type, payment_method, amount_ars,
    reference_type, reference_id, sale_transaction_id,
    return_transaction_id, description, created_by
  ) VALUES (
    v_refund.org_id, v_session, 'refund_out', v_refund.sale_method,
    v_refund.amount, 'sales_return', v_operation.id,
    v_operation.sale_transaction_id, v_operation.id,
    'Reintegro externo confirmado', COALESCE(v_actor, v_operation.created_by)
  )
  ON CONFLICT (return_transaction_id, payment_method, entry_type)
    WHERE entry_type = 'refund_out' AND return_transaction_id IS NOT NULL
  DO UPDATE SET
    amount_ars = public.cash_entries.amount_ars + EXCLUDED.amount_ars,
    session_id = COALESCE(public.cash_entries.session_id, EXCLUDED.session_id),
    description = EXCLUDED.description;

  SELECT count(*) INTO v_pending
  FROM public.sales_return_refunds refund
  WHERE refund.return_transaction_id = v_operation.id
    AND refund.status = 'pending_external';
  IF v_pending = 0 THEN
    UPDATE public.sales_return_transactions
    SET status = 'completed', completed_at = now()
    WHERE id = v_operation.id;
  END IF;

  INSERT INTO public.audit_logs (
    user_id, org_id, action, entity_type, entity_id, details, severity, tags
  ) VALUES (
    COALESCE(v_actor, v_operation.created_by), v_refund.org_id,
    'confirm', 'sales_return_refund', v_refund.id::text,
    jsonb_build_object(
      'return_transaction_id', v_operation.id,
      'amount', v_refund.amount,
      'sale_method', v_refund.sale_method,
      'external_reference', left(btrim(p_external_reference), 250),
      'confirmed_by_service', v_service
    ), 'info', ARRAY['sales', 'return', 'payments']::text[]
  );

  RETURN jsonb_build_object(
    'ok', true, 'reused', false, 'refund_id', v_refund.id,
    'status', 'completed',
    'return_status', CASE WHEN v_pending = 0 THEN 'completed' ELSE 'pending_refund' END
  );
END
$function$;

REVOKE ALL ON FUNCTION public.sales_return_refund_complete(uuid, text, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_return_refund_complete(uuid, text, jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE VIEW public.sales_return_operations
WITH (security_invoker = true)
AS
SELECT
  operation.id,
  operation.org_id,
  operation.sale_transaction_id,
  operation.legacy_sale_id,
  operation.status,
  operation.reason,
  operation.notes,
  operation.restock,
  operation.refund_amount,
  operation.currency,
  operation.cash_session_id,
  operation.credit_note_required,
  operation.created_by,
  operation.created_at,
  operation.completed_at,
  COALESCE(lines.line_count, 0) AS line_count,
  COALESCE(lines.units, 0) AS units,
  COALESCE(lines.product_names, '') AS product_names,
  COALESCE(refunds.completed_amount, 0) AS completed_amount,
  COALESCE(refunds.pending_amount, 0) AS pending_amount,
  COALESCE(refunds.payment_summary, '') AS payment_summary
FROM public.sales_return_transactions operation
LEFT JOIN LATERAL (
  SELECT count(*)::integer AS line_count,
         COALESCE(sum(line.quantity), 0)::integer AS units,
         string_agg(line.product_name, ', ' ORDER BY line.created_at, line.id) AS product_names
  FROM public.returns line
  WHERE line.return_transaction_id = operation.id
) lines ON true
LEFT JOIN LATERAL (
  SELECT round(COALESCE(sum(refund.amount) FILTER (WHERE refund.status = 'completed'), 0), 2) AS completed_amount,
         round(COALESCE(sum(refund.amount) FILTER (WHERE refund.status = 'pending_external'), 0), 2) AS pending_amount,
         string_agg(
           refund.sale_method || ': ' || refund.status,
           ', ' ORDER BY refund.created_at, refund.id
         ) AS payment_summary
  FROM public.sales_return_refunds refund
  WHERE refund.return_transaction_id = operation.id
) refunds ON true;

GRANT SELECT ON public.sales_return_operations TO authenticated;

-- Guardas estructurales: una pantalla no puede volver a abrir las escrituras
-- directas ni una función interna quedar expuesta a anon.
DO $guards$
BEGIN
  IF has_table_privilege('authenticated', 'public.returns', 'INSERT')
     OR has_table_privilege('authenticated', 'public.returns', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.returns', 'DELETE') THEN
    RAISE EXCEPTION 'returns volvió a aceptar mutaciones directas';
  END IF;
  IF has_table_privilege('authenticated', 'public.sales_return_transactions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.sales_return_refunds', 'UPDATE') THEN
    RAISE EXCEPTION 'las devoluciones transaccionales quedaron escribibles sin RPC';
  END IF;
  IF has_function_privilege('anon', 'public.create_sales_return_v1(uuid,uuid,jsonb,jsonb,text,text,boolean,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.create_sales_return_v1(uuid,uuid,jsonb,jsonb,text,text,boolean,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL inválida en create_sales_return_v1';
  END IF;
END
$guards$;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829000045', 'devolucion_pos_transaccional')
ON CONFLICT DO NOTHING;
