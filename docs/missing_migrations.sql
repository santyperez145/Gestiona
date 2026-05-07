-- ============================================================
-- MIGRACIONES FALTANTES — aplicar en hummeopatkniwkyrrhwc
-- Generado: 2026-05-07
-- Nota: bloques cron.schedule() omitidos — no son soportados
--       por el SQL Editor. Los crons se registran via CLI o
--       desde el dashboard de pg_cron si está habilitado.
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

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

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

-- == 20260506_auto_loyalty_trigger.sql ==
CREATE OR REPLACE FUNCTION public.trg_auto_loyalty_on_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  v_enabled         boolean;
  v_points_per_1000 integer;
  v_points          integer;
BEGIN
  IF NEW.customer_name IS NULL OR trim(NEW.customer_name) = '' THEN RETURN NEW; END IF;
  SELECT COALESCE(loyalty_enabled, false), COALESCE(loyalty_points_per_1000, 1)
  INTO v_enabled, v_points_per_1000
  FROM public.settings WHERE org_id = NEW.org_id;
  IF NOT FOUND OR NOT v_enabled THEN RETURN NEW; END IF;
  v_points := floor(COALESCE(NEW.total_ars, 0) / 1000.0)::integer * v_points_per_1000;
  IF v_points >= 1 THEN
    INSERT INTO public.loyalty_points (org_id, customer_name, delta, reason, reference_id)
    VALUES (NEW.org_id, trim(NEW.customer_name), v_points, 'sale', NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_auto_loyalty_on_sale ON public.sales;
CREATE TRIGGER trg_auto_loyalty_on_sale
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_auto_loyalty_on_sale();

CREATE OR REPLACE FUNCTION public.trg_auto_loyalty_on_sale_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $fn2$
DECLARE v_enabled boolean;
BEGIN
  IF OLD.customer_name IS NULL OR trim(OLD.customer_name) = '' THEN RETURN OLD; END IF;
  SELECT COALESCE(loyalty_enabled, false) INTO v_enabled
  FROM public.settings WHERE org_id = OLD.org_id;
  IF FOUND AND v_enabled THEN
    DELETE FROM public.loyalty_points
    WHERE org_id = OLD.org_id AND reference_id = OLD.id AND reason = 'sale';
  END IF;
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN RETURN OLD;
END;
$fn2$;

DROP TRIGGER IF EXISTS trg_auto_loyalty_on_sale_delete ON public.sales;
CREATE TRIGGER trg_auto_loyalty_on_sale_delete
  AFTER DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_auto_loyalty_on_sale_delete();

-- == 20260507_sales_source_column.sql ==
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'pos', 'tiendanube', 'api', 'presupuesto'));
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

CREATE OR REPLACE FUNCTION public.seed_default_alert_rules(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $fn3$
BEGIN
  INSERT INTO public.alert_rules (org_id, type, threshold_value, threshold_days) VALUES
    (p_org_id, 'stock_low',         5,     0),
    (p_org_id, 'low_margin',        15,    0),
    (p_org_id, 'debt_overdue',      0,     7),
    (p_org_id, 'customer_inactive', 0,     60),
    (p_org_id, 'high_expense',      50000, 0)
  ON CONFLICT (org_id, type) DO NOTHING;
END;
$fn3$;

CREATE INDEX IF NOT EXISTS alert_rules_org_idx ON public.alert_rules(org_id);

-- Seed default rules for all existing orgs
DO $seed$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_alert_rules(r.id);
  END LOOP;
END $seed$;

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
