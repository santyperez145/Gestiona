
-- Add payment_method to sales
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'efectivo';

-- Add image_url to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add discount percentages by payment method to settings
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS discount_cash_percent NUMERIC NOT NULL DEFAULT 10;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS discount_transfer_percent NUMERIC NOT NULL DEFAULT 5;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS discount_debit_percent NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS discount_credit_percent NUMERIC NOT NULL DEFAULT 0;
