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
