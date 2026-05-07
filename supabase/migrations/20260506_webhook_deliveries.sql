-- Outbound webhook delivery log for retry tracking and observability
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event                text NOT NULL,
  webhook_url          text NOT NULL,
  payload              jsonb,
  attempt_count        int NOT NULL DEFAULT 1,
  last_response_status int,
  last_response_body   text,
  delivered            boolean NOT NULL DEFAULT false,
  delivered_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhook_deliveries_org" ON public.webhook_deliveries;
CREATE POLICY "webhook_deliveries_org" ON public.webhook_deliveries FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS webhook_deliveries_org_created  ON public.webhook_deliveries(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_delivered    ON public.webhook_deliveries(org_id, delivered, created_at DESC);

-- webhook_secret per org in settings (for outbound HMAC signing)
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS webhook_secret text;

-- integration_logs: generic health/activity log per integration per org
CREATE TABLE IF NOT EXISTS public.integration_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration    text NOT NULL, -- 'tiendanube' | 'mercadopago' | 'stripe' | 'afip' | 'public_api'
  event          text NOT NULL, -- 'sync' | 'webhook' | 'auth' | 'error'
  status         text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','warning')),
  message        text,
  metadata       jsonb,
  duration_ms    int,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integration_logs_org" ON public.integration_logs;
CREATE POLICY "integration_logs_org" ON public.integration_logs FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS integration_logs_org_integration ON public.integration_logs(org_id, integration, created_at DESC);
CREATE INDEX IF NOT EXISTS integration_logs_recent ON public.integration_logs(org_id, created_at DESC);

-- Auto-clean logs older than 30 days (pg_cron job)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'clean-integration-logs',
      '0 3 * * *',
      $$DELETE FROM public.integration_logs WHERE created_at < now() - interval '30 days'$$
    );
    PERFORM cron.schedule(
      'clean-webhook-deliveries',
      '0 3 * * *',
      $$DELETE FROM public.webhook_deliveries WHERE created_at < now() - interval '60 days'$$
    );
    PERFORM cron.schedule(
      'clean-stripe-events',
      '0 4 * * *',
      $$DELETE FROM public.stripe_events WHERE processed_at < now() - interval '30 days'$$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
