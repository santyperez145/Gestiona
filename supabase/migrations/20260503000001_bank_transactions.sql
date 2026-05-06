-- Conciliación bancaria
CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date        date        NOT NULL,
  description text        NOT NULL,
  amount_ars  numeric     NOT NULL,
  type        text        NOT NULL CHECK (type IN ('credit', 'debit')),
  matched     boolean     NOT NULL DEFAULT false,
  match_ref   text,
  account     text        NOT NULL DEFAULT 'Cuenta Principal',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_manage_bank_transactions" ON public.bank_transactions
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS bank_transactions_org_date_idx ON public.bank_transactions(org_id, date DESC);
CREATE INDEX IF NOT EXISTS bank_transactions_matched_idx  ON public.bank_transactions(org_id, matched);
