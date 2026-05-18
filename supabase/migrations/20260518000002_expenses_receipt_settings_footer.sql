-- Add receipt_url column to expenses table
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS receipt_url text DEFAULT NULL;

-- Add receipt_footer column to settings table
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS receipt_footer text DEFAULT NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_expenses_receipt_url ON public.expenses(id) WHERE receipt_url IS NOT NULL;
