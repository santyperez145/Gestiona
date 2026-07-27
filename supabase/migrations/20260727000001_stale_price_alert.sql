-- ============================================================================
-- Alerta "precio desactualizado" (stale_price)
-- ============================================================================
-- Detecta productos cuyo precio de venta guardado se desvió más de
-- threshold_value % del precio que correspondería HOY según:
--   costo landeado (costo + pasero) × tipo de cambio actual × markup de la categoría
-- Típicamente se dispara cuando sube el dólar y los precios quedaron viejos.

ALTER TABLE public.alert_rules
  DROP CONSTRAINT IF EXISTS alert_rules_type_check;

ALTER TABLE public.alert_rules
  ADD CONSTRAINT alert_rules_type_check
  CHECK (type IN (
    'stock_low', 'low_margin', 'debt_overdue',
    'customer_inactive', 'high_expense', 'product_expiry', 'stale_price'
  ));

-- Seed por defecto: avisar cuando el desvío supera el 10%
CREATE OR REPLACE FUNCTION public.seed_default_alert_rules(p_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.alert_rules (org_id, type, threshold_value, threshold_days) VALUES
    (p_org_id, 'stock_low',          5,    0),
    (p_org_id, 'low_margin',         15,   0),
    (p_org_id, 'debt_overdue',       0,    7),
    (p_org_id, 'customer_inactive',  0,    60),
    (p_org_id, 'high_expense',       50000, 0),
    (p_org_id, 'product_expiry',     0,    30),
    (p_org_id, 'stale_price',        10,   0)
  ON CONFLICT (org_id, type) DO NOTHING;
END;
$$;

-- Back-fill para las orgs existentes
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.organizations LOOP
    INSERT INTO public.alert_rules (org_id, type, threshold_value, threshold_days)
    VALUES (r.id, 'stale_price', 10, 0)
    ON CONFLICT (org_id, type) DO NOTHING;
  END LOOP;
END $$;
