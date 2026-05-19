-- Add ROI tracking columns to influencer_exchanges
ALTER TABLE public.influencer_exchanges
  ADD COLUMN IF NOT EXISTS goal_notes TEXT,
  ADD COLUMN IF NOT EXISTS sales_generated_ars NUMERIC DEFAULT 0;
