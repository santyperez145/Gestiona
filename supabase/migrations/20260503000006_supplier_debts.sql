-- Cuentas a Pagar: deudas con proveedores

CREATE TABLE IF NOT EXISTS public.supplier_debts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id   uuid        REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name text        NOT NULL,
  description   text        NOT NULL,
  amount_ars    numeric     NOT NULL DEFAULT 0,
  paid_ars      numeric     NOT NULL DEFAULT 0,
  remaining_ars numeric     GENERATED ALWAYS AS (amount_ars - paid_ars) STORED,
  due_date      date,
  status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_debts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_manage_supplier_debts" ON public.supplier_debts
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS supplier_debts_org_id_idx    ON public.supplier_debts(org_id);
CREATE INDEX IF NOT EXISTS supplier_debts_status_idx    ON public.supplier_debts(org_id, status);
CREATE INDEX IF NOT EXISTS supplier_debts_due_date_idx  ON public.supplier_debts(org_id, due_date);

-- Tabla de pagos parciales a proveedores
CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_debt_id uuid       NOT NULL REFERENCES public.supplier_debts(id) ON DELETE CASCADE,
  amount_ars      numeric     NOT NULL,
  method          text        NOT NULL DEFAULT 'transferencia',
  note            text,
  paid_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_manage_supplier_payments" ON public.supplier_payments
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );
