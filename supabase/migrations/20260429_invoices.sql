-- ============================================================
-- INVOICES / FACTURAS
-- ============================================================

CREATE TYPE public.invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'canceled');

CREATE TABLE IF NOT EXISTS public.invoices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number      text NOT NULL,           -- e.g. "FAC-0001"
  customer_name text NOT NULL,
  customer_email text,
  customer_address text,
  customer_tax_id text,               -- CUIT / DNI
  issue_date  date NOT NULL DEFAULT CURRENT_DATE,
  due_date    date,
  status      public.invoice_status NOT NULL DEFAULT 'draft',
  notes       text,
  currency    text NOT NULL DEFAULT 'ARS',
  subtotal    numeric NOT NULL DEFAULT 0,
  tax_pct     numeric NOT NULL DEFAULT 0,
  tax_amount  numeric NOT NULL DEFAULT 0,
  total       numeric NOT NULL DEFAULT 0,
  paid_at     timestamptz,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity    numeric NOT NULL DEFAULT 1,
  unit_price  numeric NOT NULL DEFAULT 0,
  total       numeric NOT NULL DEFAULT 0
);

-- Sequence for invoice numbers per org
CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  org_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0
);

-- RLS
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

-- Policies: members can read; admins/owners can write
CREATE POLICY "invoice_select" ON public.invoices
  FOR SELECT USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );
CREATE POLICY "invoice_insert" ON public.invoices
  FOR INSERT WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );
CREATE POLICY "invoice_update" ON public.invoices
  FOR UPDATE USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );
CREATE POLICY "invoice_delete" ON public.invoices
  FOR DELETE USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );

CREATE POLICY "invoice_items_select" ON public.invoice_items
  FOR SELECT USING (
    invoice_id IN (
      SELECT id FROM public.invoices
      WHERE org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
    )
  );
CREATE POLICY "invoice_items_all" ON public.invoice_items
  FOR ALL USING (
    invoice_id IN (
      SELECT id FROM public.invoices
      WHERE org_id IN (
        SELECT org_id FROM public.memberships
        WHERE user_id = auth.uid() AND role IN ('owner','admin')
      )
    )
  );

CREATE POLICY "invoice_seq_all" ON public.invoice_sequences
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invoices_org ON public.invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(invoice_id);
