-- ============================================================================
-- Suscripciones de clientes (planes recurrentes de la tienda)
-- ============================================================================
-- SubscriptionsPage ya estaba escrita contra estas tablas pero nunca se
-- crearon → la página fallaba en runtime. OJO: es distinto de `plans`
-- (los planes SaaS de Gestiona); esto son planes que la tienda le vende a
-- SUS clientes (ej. caja de perfumes mensual).

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  price            NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'ARS',
  billing_interval TEXT NOT NULL DEFAULT 'monthly'
                   CHECK (billing_interval IN ('weekly','monthly','quarterly','semiannual','annual')),
  trial_days       INTEGER NOT NULL DEFAULT 0,
  features         TEXT[],
  is_public        BOOLEAN NOT NULL DEFAULT false,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id              UUID NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  customer_id          UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name        TEXT NOT NULL,
  customer_email       TEXT,
  status               TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('trial','active','past_due','cancelled','paused','expired')),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end   TIMESTAMPTZ NOT NULL,
  trial_end            TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  cancel_reason        TEXT,
  payment_method       TEXT,
  amount_override      NUMERIC(12,2),
  discount_percent     NUMERIC(5,2) NOT NULL DEFAULT 0,
  notes                TEXT,
  auto_renew           BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscription_invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.customer_subscriptions(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_number  TEXT NOT NULL,
  amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'ARS',
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','paid','failed','void')),
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  due_date        TIMESTAMPTZ NOT NULL,
  paid_at         TIMESTAMPTZ,
  payment_method  TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_plans_org   ON public.subscription_plans(org_id, active);
CREATE INDEX IF NOT EXISTS idx_cust_subs_org   ON public.customer_subscriptions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_cust_subs_plan  ON public.customer_subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_sub_inv_sub     ON public.subscription_invoices(subscription_id, created_at DESC);

-- updated_at
DROP TRIGGER IF EXISTS trg_sub_plans_updated ON public.subscription_plans;
CREATE TRIGGER trg_sub_plans_updated BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_cust_subs_updated ON public.customer_subscriptions;
CREATE TRIGGER trg_cust_subs_updated BEFORE UPDATE ON public.customer_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: lectura para miembros de la org, escritura para owner/admin
ALTER TABLE public.subscription_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_invoices    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org read sub_plans" ON public.subscription_plans;
CREATE POLICY "org read sub_plans" ON public.subscription_plans FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "admin write sub_plans" ON public.subscription_plans;
CREATE POLICY "admin write sub_plans" ON public.subscription_plans FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

DROP POLICY IF EXISTS "org read cust_subs" ON public.customer_subscriptions;
CREATE POLICY "org read cust_subs" ON public.customer_subscriptions FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "admin write cust_subs" ON public.customer_subscriptions;
CREATE POLICY "admin write cust_subs" ON public.customer_subscriptions FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

DROP POLICY IF EXISTS "org read sub_invoices" ON public.subscription_invoices;
CREATE POLICY "org read sub_invoices" ON public.subscription_invoices FOR SELECT TO authenticated
  USING (public.is_org_member(org_id, auth.uid()));
DROP POLICY IF EXISTS "admin write sub_invoices" ON public.subscription_invoices;
CREATE POLICY "admin write sub_invoices" ON public.subscription_invoices FOR ALL TO authenticated
  USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));

-- ============================================================================
-- renew_subscription: avanza el período y emite la factura del ciclo
-- ============================================================================
CREATE OR REPLACE FUNCTION public.renew_subscription(p_subscription_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub      public.customer_subscriptions%ROWTYPE;
  v_plan     public.subscription_plans%ROWTYPE;
  v_interval INTERVAL;
  v_amount   NUMERIC(12,2);
  v_start    TIMESTAMPTZ;
  v_end      TIMESTAMPTZ;
  v_inv_id   UUID;
  v_seq      INTEGER;
BEGIN
  SELECT * INTO v_sub FROM public.customer_subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscription not found: %', p_subscription_id; END IF;

  IF NOT public.has_org_role(v_sub.org_id, auth.uid(), ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'Unauthorized: requires owner/admin role';
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_sub.plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found for subscription %', p_subscription_id; END IF;

  v_interval := CASE v_plan.billing_interval
    WHEN 'weekly'     THEN INTERVAL '7 days'
    WHEN 'monthly'    THEN INTERVAL '1 month'
    WHEN 'quarterly'  THEN INTERVAL '3 months'
    WHEN 'semiannual' THEN INTERVAL '6 months'
    WHEN 'annual'     THEN INTERVAL '1 year'
    ELSE INTERVAL '1 month'
  END;

  -- El nuevo período arranca donde terminaba el anterior (o ahora si ya venció)
  v_start := GREATEST(v_sub.current_period_end, now());
  v_end   := v_start + v_interval;

  -- Importe: override del cliente o precio del plan, menos su descuento
  v_amount := COALESCE(v_sub.amount_override, v_plan.price)
              * (1 - COALESCE(v_sub.discount_percent, 0) / 100.0);

  UPDATE public.customer_subscriptions
     SET current_period_start = v_start,
         current_period_end   = v_end,
         status               = CASE WHEN status IN ('past_due','expired','trial') THEN 'active' ELSE status END,
         updated_at           = now()
   WHERE id = p_subscription_id;

  SELECT COUNT(*) + 1 INTO v_seq FROM public.subscription_invoices WHERE org_id = v_sub.org_id;

  INSERT INTO public.subscription_invoices (
    subscription_id, org_id, invoice_number, amount, currency,
    status, period_start, period_end, due_date, payment_method
  ) VALUES (
    p_subscription_id, v_sub.org_id,
    'SUB-' || to_char(now(), 'YYYYMM') || '-' || lpad(v_seq::text, 4, '0'),
    ROUND(v_amount, 2), v_plan.currency,
    'pending', v_start, v_end, v_end, v_sub.payment_method
  ) RETURNING id INTO v_inv_id;

  RETURN v_inv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.renew_subscription(UUID) TO authenticated;
