-- Migration: Bank Reconciliation Engine (20260903000100_bank_reconciliation_engine.sql)
-- Creado: 2026-09-03. Usa `public.bank_transactions` (preexistente) y `public.expenses`.
-- Crea `finance_bank_reconciliations` y la función `match_transactions` (SQL plpgsql).
-- No modifica el frontend existente; requiere `public.has_permission(p_org_id, 'expenses', 'view')`.

-- Migration: Bank Reconciliation Engine
-- Created: 2026-09-03
-- Purpose: Create finance_bank_reconciliations table and match_transactions function

DROP TABLE IF EXISTS public.finance_bank_reconciliations CASCADE;

CREATE TABLE public.finance_bank_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bank_transaction_id UUID REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  reference VARCHAR(255) NOT NULL,
  transaction_date DATE NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'ARS',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'unmatched', 'disputed')),
  match_result JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_finance_bank_reconciliations_org_date ON public.finance_bank_reconciliations(org_id, transaction_date);
CREATE INDEX idx_finance_bank_reconciliations_org_status ON public.finance_bank_reconciliations(org_id, status);

ALTER TABLE public.bank_transactions ADD COLUMN IF NOT EXISTS reconciliation_id UUID REFERENCES public.finance_bank_reconciliations(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.match_transactions(
  p_org_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_threshold NUMERIC DEFAULT 0.01
) RETURNS TABLE (
  bank_id UUID,
  matched_expense_id UUID,
  amount NUMERIC,
  match_confidence NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r_bank RECORD;
  r_expense RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(p_org_id, 'expenses', 'view') THEN
    RAISE EXCEPTION 'No tenés permiso para conciliar' USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR r_bank IN
    SELECT id, amount, description, date
    FROM public.bank_transactions
    WHERE org_id = p_org_id
      AND date BETWEEN p_start_date AND p_end_date
      AND reconciliation_id IS NULL
    ORDER BY date
  LOOP
    FOR r_expense IN
      SELECT id, amount_ars, description, vendor, date
      FROM public.expenses
      WHERE org_id = p_org_id
        AND date BETWEEN p_start_date AND p_end_date
      ORDER BY date
    LOOP
      IF ABS(COALESCE(r_bank.amount, 0) - COALESCE(r_expense.amount_ars, 0)) <= p_threshold THEN
        RETURN QUERY SELECT r_bank.id, r_expense.id, r_bank.amount, 1.0 NUMERIC;
      END IF;
    END LOOP;
  END LOOP;

  RETURN;
END;
$$;
