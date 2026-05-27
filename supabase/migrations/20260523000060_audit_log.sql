-- Audit Log: immutable event trail for all user actions

CREATE TABLE IF NOT EXISTS audit_logs (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email      text,
  user_role       text,
  action          text        NOT NULL,           -- e.g. 'sale.create', 'product.update', 'user.login'
  entity_type     text        NOT NULL,           -- 'sale', 'product', 'expense', etc.
  entity_id       uuid,
  entity_label    text,                           -- human-readable identifier (order #, product name)
  old_values      jsonb,                          -- snapshot before change
  new_values      jsonb,                          -- snapshot after change
  diff            jsonb,                          -- key-value pairs that changed
  ip_address      inet,
  user_agent      text,
  request_id      uuid        DEFAULT gen_random_uuid(),
  severity        text        NOT NULL DEFAULT 'info' CHECK (severity IN ('debug','info','warning','error','critical')),
  tags            text[]      DEFAULT '{}',
  metadata        jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Partition by month for performance at scale
-- (We define the base table; actual partitioning can be added later via Supabase migrations)

-- Summary function: counts by entity_type and action in a period
CREATE OR REPLACE FUNCTION get_audit_summary(
  p_org_id uuid,
  p_from   timestamptz DEFAULT now() - interval '30 days',
  p_to     timestamptz DEFAULT now()
)
RETURNS TABLE (
  entity_type text,
  action      text,
  event_count bigint,
  unique_users bigint,
  last_event  timestamptz
) LANGUAGE sql STABLE AS $$
  SELECT
    entity_type,
    action,
    COUNT(*)          AS event_count,
    COUNT(DISTINCT user_id) AS unique_users,
    MAX(created_at)   AS last_event
  FROM audit_logs
  WHERE org_id = p_org_id AND created_at BETWEEN p_from AND p_to
  GROUP BY entity_type, action
  ORDER BY event_count DESC;
$$;

-- Helper: log an event from application code
CREATE OR REPLACE FUNCTION log_audit_event(
  p_org_id      uuid,
  p_user_id     uuid,
  p_user_email  text,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid DEFAULT NULL,
  p_entity_label text DEFAULT NULL,
  p_old_values  jsonb DEFAULT NULL,
  p_new_values  jsonb DEFAULT NULL,
  p_severity    text DEFAULT 'info',
  p_metadata    jsonb DEFAULT '{}'
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_diff jsonb := '{}';
  key text;
BEGIN
  -- Compute diff between old and new values
  IF p_old_values IS NOT NULL AND p_new_values IS NOT NULL THEN
    FOR key IN SELECT jsonb_object_keys(p_new_values)
    LOOP
      IF (p_old_values ->> key) IS DISTINCT FROM (p_new_values ->> key) THEN
        v_diff := v_diff || jsonb_build_object(key, jsonb_build_object('from', p_old_values -> key, 'to', p_new_values -> key));
      END IF;
    END LOOP;
  END IF;

  INSERT INTO audit_logs (
    org_id, user_id, user_email, action, entity_type,
    entity_id, entity_label, old_values, new_values, diff,
    severity, metadata
  ) VALUES (
    p_org_id, p_user_id, p_user_email, p_action, p_entity_type,
    p_entity_id, p_entity_label, p_old_values, p_new_values, v_diff,
    p_severity, p_metadata
  );
END;
$$;

-- Indexes (optimized for the most common queries)
CREATE INDEX IF NOT EXISTS idx_audit_org_ts      ON audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_ts     ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity      ON audit_logs(org_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action      ON audit_logs(org_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_severity    ON audit_logs(org_id, severity, created_at DESC);

-- RLS — read-only for org members, no INSERT via RLS (app uses log_audit_event SECURITY DEFINER)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_audit_read" ON audit_logs;

CREATE POLICY "org_audit_read" ON audit_logs
  FOR SELECT
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
