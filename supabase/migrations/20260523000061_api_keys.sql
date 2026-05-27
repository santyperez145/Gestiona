-- API Keys & Developer Portal

CREATE TABLE IF NOT EXISTS api_keys (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  name            text        NOT NULL,
  description     text,
  key_prefix      text        NOT NULL,              -- first 8 chars shown (e.g. sk_live_ab12)
  key_hash        text        NOT NULL,              -- bcrypt / sha256 of full key — never stored plain
  environment     text        NOT NULL DEFAULT 'production' CHECK (environment IN ('production','sandbox','development')),
  scopes          text[]      NOT NULL DEFAULT '{}', -- e.g. ['products:read','sales:write']
  rate_limit_rpm  int         NOT NULL DEFAULT 1000, -- requests per minute
  allowed_ips     inet[]      DEFAULT '{}',          -- empty = any IP
  expires_at      timestamptz,
  last_used_at    timestamptz,
  request_count   bigint      NOT NULL DEFAULT 0,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  revoked_by      uuid        REFERENCES auth.users(id)
);

CREATE TABLE IF NOT EXISTS api_key_usage_logs (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  api_key_id      uuid        NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint        text        NOT NULL,
  method          text        NOT NULL DEFAULT 'GET',
  status_code     int         NOT NULL DEFAULT 200,
  response_time_ms int,
  ip_address      inet,
  request_id      uuid        DEFAULT gen_random_uuid(),
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhooks_advanced (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  url             text        NOT NULL,
  secret          text        NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  events          text[]      NOT NULL DEFAULT '{}',  -- ['sale.created','product.updated', ...]
  is_active       boolean     NOT NULL DEFAULT true,
  retry_count     int         NOT NULL DEFAULT 3,
  timeout_ms      int         NOT NULL DEFAULT 10000,
  last_triggered  timestamptz,
  last_status     int,
  success_count   bigint      NOT NULL DEFAULT 0,
  failure_count   bigint      NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  webhook_id      uuid        NOT NULL REFERENCES webhooks_advanced(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type      text        NOT NULL,
  payload         jsonb       NOT NULL DEFAULT '{}',
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed','retrying')),
  attempt_count   int         NOT NULL DEFAULT 0,
  next_retry_at   timestamptz,
  response_code   int,
  response_body   text,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz
);

-- API usage stats per key
CREATE OR REPLACE FUNCTION get_api_key_stats(p_api_key_id uuid, p_days int DEFAULT 30)
RETURNS TABLE (
  date        date,
  total_reqs  bigint,
  success_reqs bigint,
  error_reqs  bigint,
  avg_ms      numeric
) LANGUAGE sql STABLE AS $$
  SELECT
    DATE(created_at)                              AS date,
    COUNT(*)                                      AS total_reqs,
    COUNT(*) FILTER (WHERE status_code < 400)     AS success_reqs,
    COUNT(*) FILTER (WHERE status_code >= 400)    AS error_reqs,
    ROUND(AVG(response_time_ms), 1)               AS avg_ms
  FROM api_key_usage_logs
  WHERE api_key_id = p_api_key_id
    AND created_at >= now() - (p_days || ' days')::interval
  GROUP BY DATE(created_at)
  ORDER BY date;
$$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_org        ON api_keys(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_api_usage_key_ts    ON api_key_usage_logs(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_org_ts    ON api_key_usage_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhooks_adv_org    ON webhooks_advanced(org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries  ON webhook_deliveries(webhook_id, status, created_at DESC);

-- RLS
ALTER TABLE api_keys           ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks_advanced  ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_api_keys"           ON api_keys;
DROP POLICY IF EXISTS "org_api_usage_logs"     ON api_key_usage_logs;
DROP POLICY IF EXISTS "org_webhooks_advanced"  ON webhooks_advanced;
DROP POLICY IF EXISTS "org_webhook_deliveries" ON webhook_deliveries;

CREATE POLICY "org_api_keys"           ON api_keys           USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_api_usage_logs"     ON api_key_usage_logs USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_webhooks_advanced"  ON webhooks_advanced  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
CREATE POLICY "org_webhook_deliveries" ON webhook_deliveries USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
