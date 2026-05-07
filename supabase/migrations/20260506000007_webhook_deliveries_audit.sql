-- webhook_deliveries: track all outbound webhook delivery attempts
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  event text NOT NULL,
  webhook_url text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  attempt_count int NOT NULL DEFAULT 1,
  last_response_status int,
  last_response_body text,
  delivered boolean NOT NULL DEFAULT false,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read_webhook_deliveries"
  ON webhook_deliveries FOR SELECT
  USING (org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid()));

-- admin_audit_logs: track platform admin actions for accountability
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  admin_email text,
  action text NOT NULL,
  target_org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  target_user_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admins_read_audit_logs"
  ON admin_audit_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()));

-- Add webhook_secret to settings for HMAC signing
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS webhook_secret text;
