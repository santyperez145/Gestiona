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
  webhook_id      uuid        NOT NULL REFERENCES webhook_configs(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type      text        NOT NULL,
  payload         jsonb       NOT NULL DEFAULT '{}',
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','success','failed','retrying')),
  http_status     int,
  response_body   text,
  response_time_ms int,
  attempt         int         NOT NULL DEFAULT 1,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_org       ON webhook_configs(org_id, active);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries ON webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_status    ON webhook_deliveries(org_id, status, created_at DESC);

-- Update counters on delivery
CREATE OR REPLACE FUNCTION update_webhook_counters()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'success' AND (OLD.status IS NULL OR OLD.status != 'success') THEN
    UPDATE webhook_configs
    SET total_deliveries = total_deliveries + 1,
        success_count = success_count + 1,
        last_triggered_at = now(),
        updated_at = now()
    WHERE id = NEW.webhook_id;
  ELSIF NEW.status = 'failed' AND (OLD.status IS NULL OR OLD.status != 'failed') THEN
    UPDATE webhook_configs
    SET total_deliveries = total_deliveries + 1,
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
