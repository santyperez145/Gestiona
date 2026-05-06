-- ============================================================================
-- CASH ENTRIES — Movimientos individuales dentro de una sesión de caja
-- Permite auditar cada ingreso/egreso vinculado a ventas, cobros de deuda,
-- gastos y pagos de proveedores dentro de una caja abierta.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cash_entries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id      UUID        REFERENCES public.cash_sessions(id) ON DELETE SET NULL,

  -- Tipo de movimiento
  entry_type      TEXT        NOT NULL,
  -- 'sale_in'        ingreso de venta pagada
  -- 'debt_payment'   cobro de deuda/fiado
  -- 'expense_out'    egreso por gasto
  -- 'supplier_out'   pago a proveedor
  -- 'manual_in'      ingreso manual
  -- 'manual_out'     egreso manual
  -- 'opening'        monto de apertura
  -- 'closing'        monto de cierre

  -- Método de pago
  payment_method  TEXT,       -- efectivo | transferencia | debito | credito | ...

  -- Monto (siempre positivo; la dirección la da entry_type)
  amount_ars      NUMERIC     NOT NULL DEFAULT 0,

  -- Referencia al documento origen
  reference_type  TEXT,       -- 'sale' | 'debt' | 'expense' | 'purchase'
  reference_id    UUID,

  -- Descripción
  description     TEXT,

  -- Meta
  created_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_cash_entries_org     ON public.cash_entries(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_entries_session ON public.cash_entries(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_entries_ref     ON public.cash_entries(reference_type, reference_id);

-- RLS
ALTER TABLE public.cash_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members manage cash entries"
  ON public.cash_entries FOR ALL TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

-- ============================================================================
-- Trigger: cuando se inserta una venta pagada, registrar en caja activa
-- (solo si hay una sesión abierta en esa org)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_sale_cash_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id    UUID;
  v_session   UUID;
BEGIN
  -- Solo ventas pagadas con efectivo o transferencia afectan la caja en efectivo
  IF NOT NEW.paid THEN RETURN NEW; END IF;
  IF NEW.payment_method NOT IN ('efectivo', 'transferencia', 'debito', 'credito', 'mayorista') THEN
    RETURN NEW;
  END IF;

  -- Obtener org_id del vendedor
  SELECT m.org_id INTO v_org_id
  FROM public.memberships m
  WHERE m.user_id = NEW.user_id
  ORDER BY m.joined_at LIMIT 1;

  IF v_org_id IS NULL THEN RETURN NEW; END IF;

  -- Buscar sesión de caja abierta
  SELECT id INTO v_session
  FROM public.cash_sessions
  WHERE org_id = v_org_id AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_session IS NULL THEN RETURN NEW; END IF;

  -- Registrar el ingreso
  INSERT INTO public.cash_entries (
    org_id, session_id, entry_type, payment_method,
    amount_ars, reference_type, reference_id,
    description, created_by
  ) VALUES (
    v_org_id, v_session, 'sale_in', COALESCE(NEW.payment_method, 'efectivo'),
    NEW.total_ars, 'sale', NEW.id,
    'Venta ' || COALESCE(NEW.payment_method, '') || ': ' || NEW.product_name,
    NEW.user_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_cash_entry ON public.sales;
CREATE TRIGGER trg_sale_cash_entry
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_cash_entry();

-- ============================================================================
-- Vista: resumen de una sesión de caja (efectivo neto, transferencias, etc.)
-- ============================================================================
CREATE OR REPLACE VIEW public.cash_session_summary AS
SELECT
  cs.id            AS session_id,
  cs.org_id,
  cs.opened_at,
  cs.closed_at,
  cs.status,
  cs.opening_amount,
  COALESCE(SUM(CASE WHEN ce.payment_method = 'efectivo' AND ce.entry_type IN ('sale_in','debt_payment','manual_in') THEN ce.amount_ars
                    WHEN ce.entry_type IN ('expense_out','supplier_out','manual_out') AND ce.payment_method = 'efectivo' THEN -ce.amount_ars
                    ELSE 0 END), 0)  AS efectivo_neto,
  COALESCE(SUM(CASE WHEN ce.payment_method = 'transferencia' AND ce.entry_type IN ('sale_in','debt_payment') THEN ce.amount_ars ELSE 0 END), 0) AS transferencia_total,
  COALESCE(SUM(CASE WHEN ce.payment_method IN ('debito','credito') AND ce.entry_type IN ('sale_in','debt_payment') THEN ce.amount_ars ELSE 0 END), 0) AS tarjeta_total,
  COALESCE(SUM(CASE WHEN ce.entry_type = 'sale_in' THEN ce.amount_ars ELSE 0 END), 0) AS total_ventas,
  COALESCE(SUM(CASE WHEN ce.entry_type = 'debt_payment' THEN ce.amount_ars ELSE 0 END), 0) AS total_cobros,
  COALESCE(SUM(CASE WHEN ce.entry_type IN ('expense_out','supplier_out','manual_out') THEN ce.amount_ars ELSE 0 END), 0) AS total_egresos,
  COUNT(ce.id)     AS total_movements
FROM public.cash_sessions cs
LEFT JOIN public.cash_entries ce ON ce.session_id = cs.id
GROUP BY cs.id, cs.org_id, cs.opened_at, cs.closed_at, cs.status, cs.opening_amount;

-- ============================================================================
-- Función: registrar pago de deuda en caja
-- (llamada desde DebtsPage cuando se registra un cobro)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_debt_payment_cash_entry(
  p_org_id        UUID,
  p_debt_id       UUID,
  p_amount_ars    NUMERIC,
  p_payment_method TEXT,
  p_description   TEXT,
  p_created_by    UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session   UUID;
  v_entry_id  UUID;
BEGIN
  -- Verificar membresía
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE org_id = p_org_id AND user_id = p_created_by
  ) THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  -- Buscar sesión abierta
  SELECT id INTO v_session
  FROM public.cash_sessions
  WHERE org_id = p_org_id AND status = 'open'
  ORDER BY opened_at DESC LIMIT 1;

  INSERT INTO public.cash_entries (
    org_id, session_id, entry_type, payment_method,
    amount_ars, reference_type, reference_id,
    description, created_by
  ) VALUES (
    p_org_id, v_session, 'debt_payment', p_payment_method,
    p_amount_ars, 'debt', p_debt_id,
    COALESCE(p_description, 'Cobro de deuda'),
    p_created_by
  )
  RETURNING id INTO v_entry_id;

  RETURN v_entry_id;
END;
$$;
