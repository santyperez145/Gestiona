-- AFIP: add environment tracking and expanded error status on invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS afip_environment text
  CHECK (afip_environment IN ('homologacion', 'produccion'));

-- Expand afip_status to cover new error states
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_afip_status_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_afip_status_check
  CHECK (afip_status IN ('pending','authorized','rejected','error','config_error','network_error','validation_error','not_applicable'));
