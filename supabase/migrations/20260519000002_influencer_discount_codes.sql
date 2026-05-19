-- Add discount_code to influencer_exchanges for automatic sale attribution
ALTER TABLE public.influencer_exchanges
  ADD COLUMN IF NOT EXISTS discount_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_influencer_exchanges_discount_code
  ON public.influencer_exchanges (discount_code)
  WHERE discount_code IS NOT NULL;
