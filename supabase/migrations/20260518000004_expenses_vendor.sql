-- Add vendor/supplier field to expenses for payment tracking
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS vendor text;

-- Index for vendor filtering
CREATE INDEX IF NOT EXISTS expenses_vendor_idx ON public.expenses(org_id, vendor);
