-- Stripe event deduplication table
-- Stores processed event IDs so retries are safely ignored.
CREATE TABLE IF NOT EXISTS public.stripe_events (
  event_id     text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- No browser role may read/write deduplication IDs, including on fresh replay.
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stripe_events_no_client_access" ON public.stripe_events;
CREATE POLICY "stripe_events_no_client_access" ON public.stripe_events
  AS RESTRICTIVE FOR ALL TO authenticated USING (false);

-- Auto-expire old events after 30 days (pg_cron cleans up)
CREATE INDEX IF NOT EXISTS stripe_events_processed_at ON public.stripe_events(processed_at);

-- Add stripe_customer_id to subscriptions if missing (needed for portal/dunning)
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS trial_end          timestamptz;
