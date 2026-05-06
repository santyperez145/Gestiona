-- Agregar campo monthly_targets a settings para presupuesto anual vs real
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS monthly_targets jsonb DEFAULT NULL;

-- Estructura esperada:
-- { "sales_ars": 500000, "profit_ars": 150000, "expenses_ars": 80000 }
