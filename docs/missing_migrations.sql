-- == 20260506_invoice_sale_link.sql ==
-- Link invoices to the sale they were generated from
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_sale_id_idx ON public.invoices(sale_id) WHERE sale_id IS NOT NULL;

-- Also add invoice_id on sales so we can show "Facturado ✓" badge quickly
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sales_invoice_id_idx ON public.sales(invoice_id) WHERE invoice_id IS NOT NULL;

-- == 20260506_org_api_keys.sql ==
-- Rotatable API keys for the Public API
-- Keys are stored as SHA-256 hashes; the plaintext is only shown once at creation.
CREATE TABLE IF NOT EXISTS public.org_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_hash     text NOT NULL UNIQUE,
  label        text,
  revoked      boolean NOT NULL DEFAULT false,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  use_count    bigint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.org_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_api_keys_org_access" ON public.org_api_keys;
CREATE POLICY "org_api_keys_org_access" ON public.org_api_keys FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS org_api_keys_org_idx  ON public.org_api_keys(org_id);
CREATE INDEX IF NOT EXISTS org_api_keys_hash_idx ON public.org_api_keys(key_hash) WHERE NOT revoked;

-- Add source column to sales for API-created entries
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

-- == 20260506_recurring_expenses.sql ==
-- Recurring expenses: frequency + next_due_date + last_auto_created_at
-- The 'recurring' boolean column already exists on the expenses table.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS recurring_frequency text
    CHECK (recurring_frequency IN ('daily','weekly','monthly','yearly'))
    DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS recurring_next_date  date,
  ADD COLUMN IF NOT EXISTS last_auto_created_at timestamptz;

-- Index for efficient lookup in the edge function
CREATE INDEX IF NOT EXISTS expenses_recurring_next
  ON public.expenses(org_id, recurring_next_date)
  WHERE recurring = true AND recurring_next_date IS NOT NULL;

-- Back-fill recurring_next_date for existing recurring expenses
-- Set it to 1st of next month if not already set
UPDATE public.expenses
SET
  recurring_frequency  = COALESCE(recurring_frequency, 'monthly'),
  recurring_next_date  = date_trunc('month', created_at::date + interval '1 month')::date
WHERE recurring = true
  AND recurring_next_date IS NULL;

-- pg_cron: run auto-recurring-expenses edge function daily at 06:00 UTC
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'auto-recurring-expenses',
      '0 6 * * *',
      $cron$
        SELECT net.http_post(
          url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/auto-recurring-expenses',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY')
          ),
          body := '{}'::jsonb
        );
      $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $outer$;

-- == 20260506_webhook_deliveries.sql ==
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
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'clean-integration-logs',
      '0 3 * * *',
      $cron$DELETE FROM public.integration_logs WHERE created_at < now() - interval '30 days'$cron$
    );
    PERFORM cron.schedule(
      'clean-webhook-deliveries',
      '0 3 * * *',
      $cron$DELETE FROM public.webhook_deliveries WHERE created_at < now() - interval '60 days'$cron$
    );
    PERFORM cron.schedule(
      'clean-stripe-events',
      '0 4 * * *',
      $cron$DELETE FROM public.stripe_events WHERE processed_at < now() - interval '30 days'$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $outer$;

-- == 20260506_auto_loyalty_trigger.sql ==
-- Auto-award loyalty points when a sale is created
-- Only fires when: loyalty_enabled = true, customer_name is not blank,
--                  and the calculated points >= 1

CREATE OR REPLACE FUNCTION public.trg_auto_loyalty_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_enabled         boolean;
  v_points_per_1000 integer;
  v_points          integer;
BEGIN
  -- Skip if no customer name
  IF NEW.customer_name IS NULL OR trim(NEW.customer_name) = '' THEN
    RETURN NEW;
  END IF;

  -- Get loyalty config for this org
  SELECT
    COALESCE(loyalty_enabled, false),
    COALESCE(loyalty_points_per_1000, 1)
  INTO v_enabled, v_points_per_1000
  FROM public.settings
  WHERE org_id = NEW.org_id;

  -- Skip if loyalty not enabled or no settings row
  IF NOT FOUND OR NOT v_enabled THEN
    RETURN NEW;
  END IF;

  -- Calculate points: floor(total_ars / 1000) * points_per_1000
  -- Use COALESCE so NULL total_ars = 0 points
  v_points := floor(COALESCE(NEW.total_ars, 0) / 1000.0)::integer * v_points_per_1000;

  IF v_points >= 1 THEN
    INSERT INTO public.loyalty_points (
      org_id, customer_name, delta, reason, reference_id
    ) VALUES (
      NEW.org_id,
      trim(NEW.customer_name),
      v_points,
      'sale',
      NEW.id
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block a sale due to loyalty errors
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_loyalty_on_sale ON public.sales;
CREATE TRIGGER trg_auto_loyalty_on_sale
  AFTER INSERT ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_auto_loyalty_on_sale();

-- Also auto-deduct when a sale is deleted (refund/reversal)
CREATE OR REPLACE FUNCTION public.trg_auto_loyalty_on_sale_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_enabled boolean;
BEGIN
  IF OLD.customer_name IS NULL OR trim(OLD.customer_name) = '' THEN
    RETURN OLD;
  END IF;

  SELECT COALESCE(loyalty_enabled, false) INTO v_enabled
  FROM public.settings WHERE org_id = OLD.org_id;

  -- Reverse the award by deleting the loyalty_points row for this sale
  IF FOUND AND v_enabled THEN
    DELETE FROM public.loyalty_points
    WHERE org_id = OLD.org_id
      AND reference_id = OLD.id
      AND reason = 'sale';
  END IF;

  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_loyalty_on_sale_delete ON public.sales;
CREATE TRIGGER trg_auto_loyalty_on_sale_delete
  AFTER DELETE ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_auto_loyalty_on_sale_delete();

-- == 20260507_sales_source_column.sql ==
-- Add source column to sales table
-- Values: 'manual' | 'pos' | 'tiendanube' | 'api' | 'presupuesto'

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'pos', 'tiendanube', 'api', 'presupuesto'));

-- Back-fill existing rows
UPDATE public.sales SET source = 'manual' WHERE source IS NULL OR source = '';

CREATE INDEX IF NOT EXISTS sales_source_idx ON public.sales(org_id, source);

-- == 20260507_alert_rules.sql ==
-- Alertas inteligentes configurables por organización
-- Tipos: stock_low, low_margin, debt_overdue, customer_inactive, high_expense

CREATE TABLE IF NOT EXISTS public.alert_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type              text NOT NULL CHECK (type IN (
                      'stock_low', 'low_margin', 'debt_overdue',
                      'customer_inactive', 'high_expense'
                    )),
  enabled           boolean NOT NULL DEFAULT true,
  -- threshold_value: numeric threshold (stock units, margin %, ARS amount)
  threshold_value   numeric NOT NULL DEFAULT 5,
  -- threshold_days: for time-based alerts (days without purchase, days overdue)
  threshold_days    integer NOT NULL DEFAULT 30,
  -- last_run_at: when the check last fired for this rule
  last_run_at       timestamptz,
  -- last_triggered_at: when it last produced at least one alert
  last_triggered_at timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (org_id, type)
);

ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can manage alert rules" ON public.alert_rules;
CREATE POLICY "org members can manage alert rules"
  ON public.alert_rules
  FOR ALL
  USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

-- Default rules for every new org (seeded via a function called from onboarding)
CREATE OR REPLACE FUNCTION public.seed_default_alert_rules(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.alert_rules (org_id, type, threshold_value, threshold_days) VALUES
    (p_org_id, 'stock_low',          5,    0),
    (p_org_id, 'low_margin',         15,   0),
    (p_org_id, 'debt_overdue',       0,    7),
    (p_org_id, 'customer_inactive',  0,    60),
    (p_org_id, 'high_expense',       50000, 0)
  ON CONFLICT (org_id, type) DO NOTHING;
END;
$$;

-- Index for efficient org lookup
CREATE INDEX IF NOT EXISTS alert_rules_org_idx ON public.alert_rules(org_id);

-- pg_cron: run check-alerts daily at 07:00 UTC
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'check-alerts-daily',
      '0 7 * * *',
      $cron$
        SELECT net.http_post(
          url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/check-alerts',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY')
          ),
          body := '{}'::jsonb
        );
      $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $outer$;

-- Back-fill default rules for all existing orgs
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_alert_rules(r.id);
  END LOOP;
END $$;

-- == 20260507_automation_runs.sql ==
-- Automation run history: every time a flow fires, record it here
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  flow_id       uuid NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  trigger_type  text NOT NULL,
  action_type   text NOT NULL,
  status        text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error', 'skipped')),
  -- entities_matched: how many customers/products/debts matched the trigger
  entities_matched integer DEFAULT 0,
  -- actions_taken: how many actions were actually executed
  actions_taken    integer DEFAULT 0,
  error_message    text,
  ran_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can view automation runs" ON public.automation_runs;
CREATE POLICY "org members can view automation runs"
  ON public.automation_runs FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS automation_runs_flow_idx ON public.automation_runs(flow_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS automation_runs_org_idx  ON public.automation_runs(org_id, ran_at DESC);

-- pg_cron: run execute-automations daily at 08:00 UTC
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'execute-automations-daily',
      '0 8 * * *',
      $cron$
        SELECT net.http_post(
          url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/execute-automations',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_ANON_KEY')
          ),
          body := '{}'::jsonb
        );
      $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $outer$;

-- == 20260507_campaign_metrics.sql ==
-- Email campaign metrics: open_count, click_count, unsubscribe_count
-- Resend webhook events table for tracking

ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS open_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS click_count      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unsubscribe_count integer NOT NULL DEFAULT 0;

-- Per-email event tracking (one row per Resend webhook event)
CREATE TABLE IF NOT EXISTS public.email_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id   uuid REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  event_type    text NOT NULL CHECK (event_type IN ('open', 'click', 'bounce', 'complaint', 'unsubscribe', 'delivery')),
  recipient_email text,
  link_url      text,
  resend_email_id text,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can view email events" ON public.email_events;
CREATE POLICY "org members can view email events"
  ON public.email_events FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS email_events_campaign_idx ON public.email_events(campaign_id, occurred_at DESC);

-- Unsubscribes list per org (email addresses that opted out)
CREATE TABLE IF NOT EXISTS public.email_unsubscribes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email         text NOT NULL,
  unsubscribed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can view unsubscribes" ON public.email_unsubscribes;
CREATE POLICY "org members can view unsubscribes"
  ON public.email_unsubscribes FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

