-- Alertas inteligentes configurables por organización
-- Tipos: stock_low, low_margin, debt_overdue, customer_inactive, high_expense

CREATE TABLE IF NOT EXISTS public.alert_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type              text NOT NULL CHECK (type IN (
                      'stock_low', 'low_margin', 'debt_overdue',
                      'customer_inactive', 'high_expense'
                    )),
  enabled           boolean NOT NULL DEFAULT true,
  -- threshold_value: numeric threshold (stock units, margin %, ARS amount)
  threshold_value   numeric NOT NULL DEFAULT 5,
  -- threshold_days: for time-based alerts (days without purchase, days overdue)
  threshold_days    integer NOT NULL DEFAULT 30,
  -- last_run_at: when the check last fired for this rule
  last_run_at       timestamptz,
  -- last_triggered_at: when it last produced at least one alert
  last_triggered_at timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (org_id, type)
);

ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can manage alert rules" ON public.alert_rules;
CREATE POLICY "org members can manage alert rules"
  ON public.alert_rules
  FOR ALL
  USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

-- Default rules for every new org (seeded via a function called from onboarding)
CREATE OR REPLACE FUNCTION public.seed_default_alert_rules(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.alert_rules (org_id, type, threshold_value, threshold_days) VALUES
    (p_org_id, 'stock_low',          5,    0),
    (p_org_id, 'low_margin',         15,   0),
    (p_org_id, 'debt_overdue',       0,    7),
    (p_org_id, 'customer_inactive',  0,    60),
    (p_org_id, 'high_expense',       50000, 0)
  ON CONFLICT (org_id, type) DO NOTHING;
END;
$$;

-- Index for efficient org lookup
CREATE INDEX IF NOT EXISTS alert_rules_org_idx ON public.alert_rules(org_id);

-- pg_cron: run check-alerts daily at 07:00 UTC
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'check-alerts-daily',
      '0 7 * * *',
      $cron$
        SELECT net.http_post(
          url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL') || '/functions/v1/check-alerts',
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

-- Back-fill default rules for all existing orgs
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    PERFORM public.seed_default_alert_rules(r.id);
  END LOOP;
END $$;
