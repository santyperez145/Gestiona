-- Link invoices to the sale they were generated from
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_sale_id_idx ON public.invoices(sale_id) WHERE sale_id IS NOT NULL;

-- Also add invoice_id on sales so we can show "Facturado ✓" badge quickly
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sales_invoice_id_idx ON public.sales(invoice_id) WHERE invoice_id IS NOT NULL;
