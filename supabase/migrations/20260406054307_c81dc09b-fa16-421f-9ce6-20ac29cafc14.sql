
ALTER TABLE public.settings 
  ADD COLUMN IF NOT EXISTS tax_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_iva_percent numeric NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS tax_iibb_percent numeric NOT NULL DEFAULT 3.5,
  ADD COLUMN IF NOT EXISTS tax_monotributo_monthly numeric NOT NULL DEFAULT 0;
