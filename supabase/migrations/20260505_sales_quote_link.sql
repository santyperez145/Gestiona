-- Link sales back to their originating quote
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_quote ON public.sales(quote_id)
  WHERE quote_id IS NOT NULL;
