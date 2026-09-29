-- Convergencia explícita después de la aplicación paralela de 012100:
-- producción y un replay completo aceptan exactamente los mismos orígenes.
ALTER TABLE public.financial_movements
  DROP CONSTRAINT IF EXISTS financial_movements_source_type_check;

ALTER TABLE public.financial_movements
  ADD CONSTRAINT financial_movements_source_type_check
  CHECK (source_type IN (
    'sale',
    'debt_payment',
    'supplier_payment',
    'return',
    'expense',
    'manual',
    'cash_open',
    'cash_close',
    'influencer_payment'
  ));

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.financial_movements'::regclass
      AND constraint_row.conname = 'financial_movements_source_type_check'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%influencer_payment%'
  ) THEN
    RAISE EXCEPTION 'financial_movements no acepta influencer_payment';
  END IF;
END
$guard$;
