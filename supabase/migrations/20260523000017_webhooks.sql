-- Outbound Webhooks — Zapier/Make/n8n integration

CREATE TABLE IF NOT EXISTS webhook_configs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  url             text        NOT NULL,
  event_types     text[]      NOT NULL DEFAULT '{}',
  active          boolean     NOT NULL DEFAULT true,
  secret_header   text,       -- e.g. "X-Gestiona-Secret"
  secret_value    text,       -- shared secret sent in header
  retry_on_fail   boolean     NOT NULL DEFAULT true,
  max_retries     int         NOT NULL DEFAULT 3,
  timeout_seconds int         NOT NULL DEFAULT 10,
  last_triggered_at timestamptz,
  total_deliveries int        NOT NULL DEFAULT 0,
  success_count    int        NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      uuid        REFERENCES webhook_configs(id) ON DELETE SET NULL,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event           text        NOT NULL,
  webhook_url     text        NOT NULL,
  payload         jsonb       NOT NULL DEFAULT '{}',
  delivered       boolean     NOT NULL DEFAULT false,
  last_response_status int,
  last_response_body text,
  duration_ms     int,
  attempt_count   int         NOT NULL DEFAULT 1,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Existing direct-webhook logs remain valid without a configured webhook ID.
-- Keep their event/delivered/attempt authority instead of a parallel status.
ALTER TABLE public.webhook_deliveries
  ADD COLUMN IF NOT EXISTS webhook_id uuid REFERENCES public.webhook_configs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS duration_ms int;

CREATE INDEX IF NOT EXISTS idx_webhooks_org       ON webhook_configs(org_id, active);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries ON webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_status    ON webhook_deliveries(org_id, delivered, created_at DESC);

-- Update counters on delivery
CREATE OR REPLACE FUNCTION update_webhook_counters()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.webhook_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    UPDATE webhook_configs
    SET total_deliveries = total_deliveries + 1,
        success_count = success_count + CASE WHEN NEW.delivered THEN 1 ELSE 0 END,
        last_triggered_at = now(),
        updated_at = now()
    WHERE id = NEW.webhook_id;
  ELSIF NEW.delivered AND NOT OLD.delivered THEN
    UPDATE webhook_configs
    SET success_count = success_count + 1,
        last_triggered_at = now(),
        updated_at = now()
    WHERE id = NEW.webhook_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_webhook_counters ON webhook_deliveries;
CREATE TRIGGER trg_webhook_counters
  AFTER INSERT OR UPDATE ON webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_webhook_counters();

-- updated_at
CREATE OR REPLACE FUNCTION update_webhook_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_webhooks_updated ON webhook_configs;
CREATE TRIGGER trg_webhooks_updated
  BEFORE UPDATE ON webhook_configs
  FOR EACH ROW EXECUTE FUNCTION update_webhook_timestamp();

-- RLS
ALTER TABLE webhook_configs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_webhooks"           ON webhook_configs;
DROP POLICY IF EXISTS "org_webhook_deliveries" ON webhook_deliveries;

CREATE POLICY "org_webhooks" ON webhook_configs
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_webhook_deliveries" ON webhook_deliveries
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
