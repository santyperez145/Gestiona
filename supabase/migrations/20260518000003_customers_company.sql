-- Add company/business name field to customers for B2B support
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS company text;

-- Index for company search
CREATE INDEX IF NOT EXISTS customers_company_idx ON public.customers(org_id, company);
