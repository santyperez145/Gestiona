-- Ledger de pagos de deudas de clientes.
-- Hoy `addDebtPaymentDB` solo actualiza los totales de `debts`: el medio de
-- pago que elige el usuario en el diálogo se descartaba. Esta tabla guarda
-- cada pago para poder auditar y conciliar.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.debt_payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  debt_id        uuid NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  amount_ars     numeric NOT NULL CHECK (amount_ars > 0),
  payment_method text,
  paid_at        timestamptz NOT NULL DEFAULT now(),
  user_id        uuid,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS debt_payments_debt_idx ON public.debt_payments(debt_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS debt_payments_org_idx  ON public.debt_payments(org_id, paid_at DESC);

ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "debt_payments_select" ON public.debt_payments;
CREATE POLICY "debt_payments_select" ON public.debt_payments
  FOR SELECT USING (public.is_org_member(org_id, auth.uid()));

DROP POLICY IF EXISTS "debt_payments_write" ON public.debt_payments;
CREATE POLICY "debt_payments_write" ON public.debt_payments
  FOR ALL USING (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']))
  WITH CHECK (public.has_org_role(org_id, auth.uid(), ARRAY['owner','admin']));
