-- ============================================================
-- PRESUPUESTOS (Quotes / Estimates)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quote_number    text NOT NULL,
  customer_name   text NOT NULL,
  customer_email  text,
  customer_phone  text,
  items           jsonb NOT NULL DEFAULT '[]',
  subtotal        numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  total           numeric NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'draft',  -- draft | sent | accepted | rejected | expired
  valid_until     date,
  notes           text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Auto-increment quote numbers per org
CREATE TABLE IF NOT EXISTS public.quote_sequences (
  org_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0
);

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quotes_org" ON public.quotes
  FOR ALL USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "quote_sequences_org" ON public.quote_sequences
  FOR ALL USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_quotes_org ON public.quotes(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON public.quotes(org_id, status);

-- Function to get next quote number for an org
CREATE OR REPLACE FUNCTION public.next_quote_number(p_org_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO public.quote_sequences (org_id, last_number) VALUES (p_org_id, 1)
  ON CONFLICT (org_id) DO UPDATE SET last_number = quote_sequences.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'PRE-' || LPAD(v_next::text, 4, '0');
END;
$$;
