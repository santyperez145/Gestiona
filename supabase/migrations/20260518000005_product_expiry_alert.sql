-- Add product_expiry alert type
-- Alerts when products with stock>0 expire within threshold_days days

-- Drop old check constraint and add product_expiry
ALTER TABLE public.alert_rules
  DROP CONSTRAINT IF EXISTS alert_rules_type_check;

ALTER TABLE public.alert_rules
  ADD CONSTRAINT alert_rules_type_check
  CHECK (type IN (
    'stock_low', 'low_margin', 'debt_overdue',
    'customer_inactive', 'high_expense', 'product_expiry'
  ));

-- Update seed function to include new rule
CREATE OR REPLACE FUNCTION public.seed_default_alert_rules(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.alert_rules (org_id, type, threshold_value, threshold_days) VALUES
    (p_org_id, 'stock_low',          5,    0),
    (p_org_id, 'low_margin',         15,   0),
    (p_org_id, 'debt_overdue',       0,    7),
    (p_org_id, 'customer_inactive',  0,    60),
    (p_org_id, 'high_expense',       50000, 0),
    (p_org_id, 'product_expiry',     0,    30)
  ON CONFLICT (org_id, type) DO NOTHING;
END;
$$;

-- Back-fill the new rule for all existing orgs
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    INSERT INTO public.alert_rules (org_id, type, threshold_value, threshold_days)
    VALUES (r.id, 'product_expiry', 0, 30)
    ON CONFLICT (org_id, type) DO NOTHING;
  END LOOP;
END $$;
