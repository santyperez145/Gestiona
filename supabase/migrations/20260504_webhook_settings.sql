-- Outbound webhook configuration for Zapier/N8N/Make.com integrations
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS webhook_url text,
  ADD COLUMN IF NOT EXISTS webhook_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS webhook_events text[] DEFAULT ARRAY['sale.created', 'stock.low', 'debt.overdue'];
