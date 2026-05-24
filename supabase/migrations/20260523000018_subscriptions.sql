-- Subscription Plans & Recurring Billing

CREATE TABLE IF NOT EXISTS subscription_plans (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  price           numeric(12,2) NOT NULL DEFAULT 0,
  currency        text        NOT NULL DEFAULT 'ARS',
  billing_interval text       NOT NULL DEFAULT 'monthly'
                              CHECK (billing_interval IN ('weekly','monthly','quarterly','semiannual','annual')),
  trial_days      int         NOT NULL DEFAULT 0,
  features        text[],     -- list of features included
  is_public       boolean     NOT NULL DEFAULT false,
  active          boolean     NOT NULL DEFAULT true,
  subscriber_count int        NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id         uuid        NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   text        NOT NULL,
  customer_email  text,
  status          text        NOT NULL DEFAULT 'trial'
                              CHECK (status IN ('trial','active','past_due','cancelled','paused','expired')),
  current_period_start date   NOT NULL DEFAULT CURRENT_DATE,
  current_period_end   date   NOT NULL,
  trial_end       date,
  cancelled_at    timestamptz,
  cancel_reason   text,
  payment_method  text,
  amount_override numeric(12,2), -- overrides plan price if set
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  notes           text,
  auto_renew      boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_number  text        NOT NULL,
  amount          numeric(12,2) NOT NULL,
  currency        text        NOT NULL DEFAULT 'ARS',
  status          text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','paid','failed','void')),
  period_start    date        NOT NULL,
  period_end      date        NOT NULL,
  due_date        date        NOT NULL,
  paid_at         timestamptz,
  payment_method  text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_plans_org    ON subscription_plans(org_id, active);
CREATE INDEX IF NOT EXISTS idx_subs_org         ON subscriptions(org_id, status, current_period_end);
CREATE INDEX IF NOT EXISTS idx_subs_customer    ON subscriptions(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_sub_invoices     ON subscription_invoices(subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_inv_due      ON subscription_invoices(org_id, status, due_date);

-- Calculate next period end date
CREATE OR REPLACE FUNCTION next_period_end(start_date date, interval_type text)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE interval_type
    WHEN 'weekly'     THEN start_date + INTERVAL '7 days'
    WHEN 'monthly'    THEN start_date + INTERVAL '1 month'
    WHEN 'quarterly'  THEN start_date + INTERVAL '3 months'
    WHEN 'semiannual' THEN start_date + INTERVAL '6 months'
    WHEN 'annual'     THEN start_date + INTERVAL '1 year'
    ELSE start_date + INTERVAL '1 month'
  END;
$$;

-- Renew subscription (advance period)
CREATE OR REPLACE FUNCTION renew_subscription(p_sub_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  sub subscriptions%ROWTYPE;
  plan subscription_plans%ROWTYPE;
  new_start date;
  new_end date;
  inv_num text;
  amount numeric;
BEGIN
  SELECT * INTO sub FROM subscriptions WHERE id = p_sub_id;
  SELECT * INTO plan FROM subscription_plans WHERE id = sub.plan_id;

  new_start := sub.current_period_end;
  new_end := next_period_end(new_start, plan.billing_interval);
  amount := COALESCE(sub.amount_override, plan.price) * (1 - sub.discount_percent / 100);

  UPDATE subscriptions
  SET current_period_start = new_start,
      current_period_end = new_end,
      status = 'active',
      updated_at = now()
  WHERE id = p_sub_id;

  -- Generate invoice
  SELECT 'SINV-' || TO_CHAR(now(), 'YYYYMMDD') || '-' || LPAD(
    (SELECT COUNT(*) + 1 FROM subscription_invoices WHERE org_id = sub.org_id)::text, 4, '0'
  ) INTO inv_num;

  INSERT INTO subscription_invoices(
    subscription_id, org_id, invoice_number, amount, currency,
    period_start, period_end, due_date
  ) VALUES (
    p_sub_id, sub.org_id, inv_num, amount, plan.currency,
    new_start, new_end, new_start + INTERVAL '3 days'
  );
END;
$$;

-- Subscriber count triggers
CREATE OR REPLACE FUNCTION update_plan_subscriber_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE subscription_plans SET subscriber_count = (
    SELECT COUNT(*) FROM subscriptions WHERE plan_id = COALESCE(NEW.plan_id, OLD.plan_id) AND status IN ('trial','active','past_due','paused')
  ) WHERE id = COALESCE(NEW.plan_id, OLD.plan_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sub_count ON subscriptions;
CREATE TRIGGER trg_sub_count
  AFTER INSERT OR UPDATE OR DELETE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_plan_subscriber_count();

-- updated_at triggers
CREATE OR REPLACE FUNCTION update_sub_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_subs_updated ON subscriptions;
CREATE TRIGGER trg_subs_updated BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_sub_timestamp();

DROP TRIGGER IF EXISTS trg_sub_plans_updated ON subscription_plans;
CREATE TRIGGER trg_sub_plans_updated BEFORE UPDATE ON subscription_plans FOR EACH ROW EXECUTE FUNCTION update_sub_timestamp();

-- RLS
ALTER TABLE subscription_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_sub_plans"    ON subscription_plans;
DROP POLICY IF EXISTS "org_subs"         ON subscriptions;
DROP POLICY IF EXISTS "org_sub_invoices" ON subscription_invoices;

CREATE POLICY "org_sub_plans" ON subscription_plans
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_subs" ON subscriptions
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));

CREATE POLICY "org_sub_invoices" ON subscription_invoices
  USING (org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid()));
