-- Add Mercado Pago webhook tracking columns to payment_links
ALTER TABLE public.payment_links ADD COLUMN IF NOT EXISTS mp_payment_id text;
ALTER TABLE public.payment_links ADD COLUMN IF NOT EXISTS external_ref  text;

-- Allow 'rejected' as a valid status for MP-rejected payments
ALTER TABLE public.payment_links DROP CONSTRAINT IF EXISTS payment_links_status_check;
ALTER TABLE public.payment_links ADD CONSTRAINT payment_links_status_check
  CHECK (status IN ('pending','pending_confirmation','paid','cancelled','rejected'));

-- Settings: add MP webhook secret column (optional per-org override)
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS mp_webhook_secret text;
