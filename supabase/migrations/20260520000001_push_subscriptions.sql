-- Push notification subscriptions (Web Push API)
-- Each row stores a browser PushSubscription for a user/device.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can manage their own subscriptions
CREATE POLICY "push_subs_own"
  ON push_subscriptions
  FOR ALL
  USING (user_id = auth.uid());

-- Service role (edge functions) can access all
-- (already bypasses RLS with service_role key)

COMMENT ON TABLE push_subscriptions IS
  'Web Push API subscriptions per user/device. Used by send-push edge function.';
