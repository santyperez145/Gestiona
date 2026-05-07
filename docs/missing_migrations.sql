-- ============================================================
-- MIGRACIONES FALTANTES — aplicar en hummeopatkniwkyrrhwc
-- Generado: 2026-05-07
-- Ejecutar en el SQL Editor de Supabase (una sola vez).
-- ============================================================

-- == 20260506_invoice_sale_link.sql ==
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS invoices_sale_id_idx ON public.invoices(sale_id) WHERE sale_id IS NOT NULL;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sales_invoice_id_idx ON public.sales(invoice_id) WHERE invoice_id IS NOT NULL;

-- == 20260506_org_api_keys.sql ==
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

-- == 20260506_recurring_expenses.sql ==
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS recurring_frequency text
    CHECK (recurring_frequency IN ('daily','weekly','monthly','yearly'))
    DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS recurring_next_date  date,
  ADD COLUMN IF NOT EXISTS last_auto_created_at timestamptz;

CREATE INDEX IF NOT EXISTS expenses_recurring_next
  ON public.expenses(org_id, recurring_next_date)
  WHERE recurring = true AND recurring_next_date IS NOT NULL;

UPDATE public.expenses
SET
  recurring_frequency = COALESCE(recurring_frequency, 'monthly'),
  recurring_next_date = date_trunc('month', created_at::date + interval '1 month')::date
WHERE recurring = true
  AND recurring_next_date IS NULL;

-- == 20260506_webhook_deliveries.sql ==
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
CREATE INDEX IF NOT EXISTS webhook_deliveries_org_created ON public.webhook_deliveries(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_delivered   ON public.webhook_deliveries(org_id, delivered, created_at DESC);

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS webhook_secret text;

CREATE TABLE IF NOT EXISTS public.integration_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  integration  text NOT NULL,
  event        text NOT NULL,
  status       text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','warning')),
  message      text,
  metadata     jsonb,
  duration_ms  int,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.integration_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "integration_logs_org" ON public.integration_logs;
CREATE POLICY "integration_logs_org" ON public.integration_logs FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);
CREATE INDEX IF NOT EXISTS integration_logs_org_integration ON public.integration_logs(org_id, integration, created_at DESC);
CREATE INDEX IF NOT EXISTS integration_logs_recent          ON public.integration_logs(org_id, created_at DESC);

-- == 20260507_sales_source_column.sql ==
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
UPDATE public.sales SET source = 'manual' WHERE source IS NULL OR source = '';
CREATE INDEX IF NOT EXISTS sales_source_idx ON public.sales(org_id, source);

-- == 20260507_alert_rules.sql ==
CREATE TABLE IF NOT EXISTS public.alert_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type              text NOT NULL CHECK (type IN (
                      'stock_low','low_margin','debt_overdue','customer_inactive','high_expense'
                    )),
  enabled           boolean NOT NULL DEFAULT true,
  threshold_value   numeric NOT NULL DEFAULT 5,
  threshold_days    integer NOT NULL DEFAULT 30,
  last_run_at       timestamptz,
  last_triggered_at timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (org_id, type)
);
ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org members can manage alert rules" ON public.alert_rules;
CREATE POLICY "org members can manage alert rules" ON public.alert_rules FOR ALL
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS alert_rules_org_idx ON public.alert_rules(org_id);

-- == 20260507_automation_runs.sql ==
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  flow_id          uuid NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  trigger_type     text NOT NULL,
  action_type      text NOT NULL,
  status           text NOT NULL DEFAULT 'success' CHECK (status IN ('success','error','skipped')),
  entities_matched integer DEFAULT 0,
  actions_taken    integer DEFAULT 0,
  error_message    text,
  ran_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org members can view automation runs" ON public.automation_runs;
CREATE POLICY "org members can view automation runs" ON public.automation_runs FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS automation_runs_flow_idx ON public.automation_runs(flow_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS automation_runs_org_idx  ON public.automation_runs(org_id, ran_at DESC);

-- == 20260507_campaign_metrics.sql ==
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS open_count        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS click_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unsubscribe_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.email_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id     uuid REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  event_type      text NOT NULL CHECK (event_type IN ('open','click','bounce','complaint','unsubscribe','delivery')),
  recipient_email text,
  link_url        text,
  resend_email_id text,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org members can view email events" ON public.email_events;
CREATE POLICY "org members can view email events" ON public.email_events FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS email_events_campaign_idx ON public.email_events(campaign_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.email_unsubscribes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email           text NOT NULL,
  unsubscribed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);
ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org members can view unsubscribes" ON public.email_unsubscribes;
CREATE POLICY "org members can view unsubscribes" ON public.email_unsubscribes FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));
