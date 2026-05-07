-- Expire trials that ended without upgrading to a paid plan
-- Runs every hour via pg_cron (requires pg_cron extension enabled in Supabase dashboard)

CREATE OR REPLACE FUNCTION public.expire_overdue_trials()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Mark trialing subscriptions as past_due when trial_ends_at has passed
  UPDATE public.subscriptions s
  SET status = 'past_due'
  FROM public.organizations o
  WHERE s.org_id = o.id
    AND s.status = 'trialing'
    AND o.trial_ends_at IS NOT NULL
    AND o.trial_ends_at < now()
    AND s.stripe_subscription_id IS NULL; -- Only orgs that never entered a payment method

  -- For orgs that DID add a payment method (have stripe_subscription_id),
  -- Stripe handles the transition via webhooks — don't override.
END;
$$;

-- Schedule: run every hour (requires pg_cron)
SELECT cron.schedule(
  'expire-overdue-trials',
  '0 * * * *',
  $$ SELECT public.expire_overdue_trials(); $$
) WHERE EXISTS (
  SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
);
