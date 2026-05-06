-- Sprint 4: Split de pago, descuento global, tabla de clientes

-- 1. Split de pago y descuento global en ventas
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS split_payments jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS global_discount_ars numeric DEFAULT 0;

-- 2. Tabla de clientes con perfil completo
CREATE TABLE IF NOT EXISTS public.customers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users(id),
  name        text        NOT NULL,
  email       text,
  phone       text,
  address     text,
  birthday    date,
  tags        text[]      DEFAULT '{}',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_manage_customers" ON public.customers
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS customers_org_id_idx ON public.customers(org_id);
CREATE INDEX IF NOT EXISTS customers_name_idx    ON public.customers(org_id, name);
