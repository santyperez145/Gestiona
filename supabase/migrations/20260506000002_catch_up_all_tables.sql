-- ============================================================================
-- CATCH-UP MIGRATION — 2026-05-06
-- Applies all migrations from 20260429 → 20260505 in one safe, idempotent run.
-- Run this in the Supabase SQL Editor to fix "table not found" errors.
-- Every statement uses IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS.
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TYPES
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE public.invoice_status AS ENUM ('draft','sent','paid','overdue','canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. INVOICES / FACTURAS (20260429_invoices)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number           text NOT NULL,
  customer_name    text NOT NULL,
  customer_email   text,
  customer_address text,
  customer_tax_id  text,
  issue_date       date NOT NULL DEFAULT CURRENT_DATE,
  due_date         date,
  status           public.invoice_status NOT NULL DEFAULT 'draft',
  notes            text,
  currency         text NOT NULL DEFAULT 'ARS',
  subtotal         numeric NOT NULL DEFAULT 0,
  tax_pct          numeric NOT NULL DEFAULT 0,
  tax_amount       numeric NOT NULL DEFAULT 0,
  total            numeric NOT NULL DEFAULT 0,
  paid_at          timestamptz,
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity    numeric NOT NULL DEFAULT 1,
  unit_price  numeric NOT NULL DEFAULT 0,
  total       numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  org_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0
);

ALTER TABLE public.invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_select" ON public.invoices;
CREATE POLICY "invoice_select" ON public.invoices FOR SELECT USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);
DROP POLICY IF EXISTS "invoice_insert" ON public.invoices;
CREATE POLICY "invoice_insert" ON public.invoices FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid() AND role IN ('owner','admin'))
);
DROP POLICY IF EXISTS "invoice_update" ON public.invoices;
CREATE POLICY "invoice_update" ON public.invoices FOR UPDATE USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid() AND role IN ('owner','admin'))
);
DROP POLICY IF EXISTS "invoice_delete" ON public.invoices;
CREATE POLICY "invoice_delete" ON public.invoices FOR DELETE USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid() AND role IN ('owner','admin'))
);
DROP POLICY IF EXISTS "invoice_items_select" ON public.invoice_items;
CREATE POLICY "invoice_items_select" ON public.invoice_items FOR SELECT USING (
  invoice_id IN (SELECT id FROM public.invoices WHERE org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
);
DROP POLICY IF EXISTS "invoice_items_all" ON public.invoice_items;
CREATE POLICY "invoice_items_all" ON public.invoice_items FOR ALL USING (
  invoice_id IN (SELECT id FROM public.invoices WHERE org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid() AND role IN ('owner','admin')))
);
DROP POLICY IF EXISTS "invoice_seq_all" ON public.invoice_sequences;
CREATE POLICY "invoice_seq_all" ON public.invoice_sequences FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid() AND role IN ('owner','admin'))
);

CREATE INDEX IF NOT EXISTS idx_invoices_org        ON public.invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status     ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(invoice_id);

-- AFIP fields for invoices (20260504_afip_fields)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS tipo_comprobante integer,
  ADD COLUMN IF NOT EXISTS cae              text,
  ADD COLUMN IF NOT EXISTS cae_vencimiento  date,
  ADD COLUMN IF NOT EXISTS afip_status      text DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS afip_error       text,
  ADD COLUMN IF NOT EXISTS numero_afip      integer;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. BARCODE + VARIANT IMPROVEMENTS (20260430_barcode_variants)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS sku     text;

CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_sku     ON public.products(sku)     WHERE sku IS NOT NULL;

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS variant_type    text NOT NULL DEFAULT 'sabor',
  ADD COLUMN IF NOT EXISTS price_override  numeric;

CREATE INDEX IF NOT EXISTS idx_product_variants_org ON public.product_variants(org_id) WHERE org_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. CASH SESSIONS (20260430_cash_sessions)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opened_by       uuid REFERENCES auth.users(id),
  closed_by       uuid REFERENCES auth.users(id),
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  opening_amount  numeric NOT NULL DEFAULT 0,
  closing_amount  numeric,
  expected_cash   numeric,
  difference      numeric,
  notes           text,
  status          text NOT NULL DEFAULT 'open'
);

ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cash_sessions_org" ON public.cash_sessions;
CREATE POLICY "cash_sessions_org" ON public.cash_sessions FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_cash_sessions_org    ON public.cash_sessions(org_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON public.cash_sessions(org_id, status);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. QUOTES / PRESUPUESTOS (20260430_presupuestos)
-- ═══════════════════════════════════════════════════════════════════════════
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
  status          text NOT NULL DEFAULT 'draft',
  valid_until     date,
  notes           text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quote_sequences (
  org_id      uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0
);

ALTER TABLE public.quotes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quotes_org" ON public.quotes;
CREATE POLICY "quotes_org" ON public.quotes FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);
DROP POLICY IF EXISTS "quote_sequences_org" ON public.quote_sequences;
CREATE POLICY "quote_sequences_org" ON public.quote_sequences FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_quotes_org    ON public.quotes(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON public.quotes(org_id, status);

CREATE OR REPLACE FUNCTION public.next_quote_number(p_org_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_next integer;
BEGIN
  INSERT INTO public.quote_sequences (org_id, last_number) VALUES (p_org_id, 1)
  ON CONFLICT (org_id) DO UPDATE SET last_number = quote_sequences.last_number + 1
  RETURNING last_number INTO v_next;
  RETURN 'PRE-' || LPAD(v_next::text, 4, '0');
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. SUPPLIERS / PROVEEDORES (20260430_proveedores)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  contact    text,
  phone      text,
  email      text,
  address    text,
  notes      text,
  tags       text[],
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suppliers_org" ON public.suppliers;
CREATE POLICY "suppliers_org" ON public.suppliers FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_org      ON public.suppliers(org_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON public.purchases(supplier_id) WHERE supplier_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. TIENDANUBE INTEGRATION (20260430_tiendanube)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tiendanube_connections (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id                 text NOT NULL,
  access_token             text NOT NULL,
  store_name               text,
  store_url                text,
  connected_at             timestamptz NOT NULL DEFAULT now(),
  last_sync_products_at    timestamptz,
  last_sync_orders_at      timestamptz,
  sync_products            boolean NOT NULL DEFAULT true,
  sync_orders              boolean NOT NULL DEFAULT true,
  UNIQUE(org_id, store_id)
);

ALTER TABLE public.tiendanube_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tiendanube_connections_org" ON public.tiendanube_connections;
CREATE POLICY "tiendanube_connections_org" ON public.tiendanube_connections FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tiendanube_id text;
ALTER TABLE public.sales    ADD COLUMN IF NOT EXISTS tiendanube_order_id text;
ALTER TABLE public.tiendanube_connections ADD COLUMN IF NOT EXISTS webhook_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_tiendanube_unique ON public.products(org_id, tiendanube_id) WHERE tiendanube_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_tiendanube    ON public.sales(org_id, tiendanube_order_id) WHERE tiendanube_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tiendanube_conn_org ON public.tiendanube_connections(org_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. DEVOLUCIONES + MERCADO PAGO (20260430_sprint3)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.returns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id),
  sale_id       uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  product_id    uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name  text NOT NULL,
  quantity      integer NOT NULL DEFAULT 1,
  amount_ars    numeric NOT NULL DEFAULT 0,
  reason        text,
  refund_method text NOT NULL DEFAULT 'efectivo',
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "returns_org" ON public.returns;
CREATE POLICY "returns_org" ON public.returns FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_returns_org  ON public.returns(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_sale ON public.returns(sale_id) WHERE sale_id IS NOT NULL;

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS returned  boolean NOT NULL DEFAULT false;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS return_id uuid REFERENCES public.returns(id) ON DELETE SET NULL;

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS mp_access_token text;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS mp_enabled      boolean NOT NULL DEFAULT false;


-- ═══════════════════════════════════════════════════════════════════════════
-- 9. CUSTOMERS + SPLIT PAYMENTS (20260502_sprint4_features)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS split_payments      jsonb   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS global_discount_ars numeric DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.customers (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id),
  name       text        NOT NULL,
  email      text,
  phone      text,
  address    text,
  birthday   date,
  tags       text[]      DEFAULT '{}',
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_customers" ON public.customers;
CREATE POLICY "org_members_manage_customers" ON public.customers FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS customers_org_id_idx ON public.customers(org_id);
CREATE INDEX IF NOT EXISTS customers_name_idx   ON public.customers(org_id, name);


-- ═══════════════════════════════════════════════════════════════════════════
-- 10. BANK TRANSACTIONS (20260503_bank_transactions)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date        date        NOT NULL,
  description text        NOT NULL,
  amount_ars  numeric     NOT NULL,
  type        text        NOT NULL CHECK (type IN ('credit','debit')),
  matched     boolean     NOT NULL DEFAULT false,
  match_ref   text,
  account     text        NOT NULL DEFAULT 'Cuenta Principal',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_bank_transactions" ON public.bank_transactions;
CREATE POLICY "org_members_manage_bank_transactions" ON public.bank_transactions FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS bank_transactions_org_date_idx ON public.bank_transactions(org_id, date DESC);
CREATE INDEX IF NOT EXISTS bank_transactions_matched_idx  ON public.bank_transactions(org_id, matched);


-- ═══════════════════════════════════════════════════════════════════════════
-- 11. EMAIL CAMPAIGNS (20260503_email_campaigns)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subject      text        NOT NULL,
  body_html    text        NOT NULL,
  segment      text        NOT NULL DEFAULT 'all',
  status       text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent','failed')),
  sent_count   integer     NOT NULL DEFAULT 0,
  failed_count integer     NOT NULL DEFAULT 0,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_email_campaigns" ON public.email_campaigns;
CREATE POLICY "org_members_manage_email_campaigns" ON public.email_campaigns FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS email_campaigns_org_id_idx ON public.email_campaigns(org_id);
CREATE INDEX IF NOT EXISTS email_campaigns_status_idx ON public.email_campaigns(org_id, status);

-- Settings columns for monthly targets and API key
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS monthly_targets jsonb DEFAULT NULL;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS api_key         text UNIQUE DEFAULT NULL;
CREATE INDEX IF NOT EXISTS settings_api_key_idx ON public.settings(api_key) WHERE api_key IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 12. SUPPLIER DEBTS (20260503_supplier_debts)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.supplier_debts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id   uuid        REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name text        NOT NULL,
  description   text        NOT NULL,
  amount_ars    numeric     NOT NULL DEFAULT 0,
  paid_ars      numeric     NOT NULL DEFAULT 0,
  remaining_ars numeric     GENERATED ALWAYS AS (amount_ars - paid_ars) STORED,
  due_date      date,
  status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','partial','paid')),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_debts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_supplier_debts" ON public.supplier_debts;
CREATE POLICY "org_members_manage_supplier_debts" ON public.supplier_debts FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS supplier_debts_org_id_idx   ON public.supplier_debts(org_id);
CREATE INDEX IF NOT EXISTS supplier_debts_status_idx   ON public.supplier_debts(org_id, status);
CREATE INDEX IF NOT EXISTS supplier_debts_due_date_idx ON public.supplier_debts(org_id, due_date);

CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_debt_id uuid        NOT NULL REFERENCES public.supplier_debts(id) ON DELETE CASCADE,
  amount_ars       numeric     NOT NULL,
  method           text        NOT NULL DEFAULT 'transferencia',
  note             text,
  paid_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_members_manage_supplier_payments" ON public.supplier_payments;
CREATE POLICY "org_members_manage_supplier_payments" ON public.supplier_payments FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);


-- ═══════════════════════════════════════════════════════════════════════════
-- 13. CHEQUES (20260504_cheques)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cheques (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type          text NOT NULL DEFAULT 'received' CHECK (type IN ('received','issued')),
  customer_name text,
  bank_name     text,
  check_number  text,
  amount_ars    numeric NOT NULL,
  issue_date    date,
  due_date      date NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','deposited','cleared','bounced','cancelled')),
  deposited_at  date,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cheques ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cheques_org_access" ON public.cheques;
CREATE POLICY "cheques_org_access" ON public.cheques FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS cheques_org_due_idx ON public.cheques(org_id, due_date, status);


-- ═══════════════════════════════════════════════════════════════════════════
-- 14. INSTALLMENT SCHEDULE / CUOTAS (20260504_cuotas)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS installments            integer DEFAULT 1 CHECK (installments >= 1),
  ADD COLUMN IF NOT EXISTS installment_amount_ars  numeric,
  ADD COLUMN IF NOT EXISTS first_installment_date  date;

CREATE TABLE IF NOT EXISTS public.installment_schedule (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id             uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  installment_number  integer NOT NULL,
  amount_ars          numeric NOT NULL,
  due_date            date NOT NULL,
  paid                boolean NOT NULL DEFAULT false,
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.installment_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "installment_schedule_org_access" ON public.installment_schedule;
CREATE POLICY "installment_schedule_org_access" ON public.installment_schedule FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS installment_schedule_org_due_idx ON public.installment_schedule(org_id, due_date, paid);
CREATE INDEX IF NOT EXISTS installment_schedule_sale_idx    ON public.installment_schedule(sale_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 15. CUSTOMER COMMUNICATIONS (20260504_customer_comms)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.customer_communications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  type          text NOT NULL DEFAULT 'note' CHECK (type IN ('note','call','whatsapp','email','visit','other')),
  summary       text NOT NULL,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.customer_communications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comm_org_access" ON public.customer_communications;
CREATE POLICY "comm_org_access" ON public.customer_communications FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS customer_comms_org_name_idx
  ON public.customer_communications(org_id, customer_name, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 16. DEALS / PIPELINE (20260504_deals)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.deals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title          text NOT NULL,
  customer_name  text,
  value_ars      numeric DEFAULT 0,
  stage          text NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead','contactado','propuesta','negociacion','cerrado','perdido')),
  notes          text,
  expected_close date,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deals_org_access" ON public.deals;
CREATE POLICY "deals_org_access" ON public.deals FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS deals_org_stage_idx ON public.deals(org_id, stage);


-- ═══════════════════════════════════════════════════════════════════════════
-- 17. LOYALTY POINTS (20260504_loyalty)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.loyalty_points (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  delta         integer NOT NULL,
  reason        text,
  reference_id  uuid,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE public.loyalty_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loyalty_org_access" ON public.loyalty_points;
CREATE POLICY "loyalty_org_access" ON public.loyalty_points FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS loyalty_org_customer_idx ON public.loyalty_points(org_id, customer_name);

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS loyalty_enabled          boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS loyalty_points_per_1000  integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS loyalty_points_value_ars integer DEFAULT 100;


-- ═══════════════════════════════════════════════════════════════════════════
-- 18. MARKETING TEMPLATES (20260504_marketing_templates)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.marketing_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title       text NOT NULL,
  content     text NOT NULL,
  post_type   text NOT NULL DEFAULT 'post',
  industry    text,
  tags        text[] DEFAULT '{}',
  is_public   boolean NOT NULL DEFAULT false,
  likes       integer NOT NULL DEFAULT 0,
  uses_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketing_templates_read_public" ON public.marketing_templates;
CREATE POLICY "marketing_templates_read_public" ON public.marketing_templates FOR SELECT USING (
  is_public = true OR org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);
DROP POLICY IF EXISTS "marketing_templates_manage_own" ON public.marketing_templates;
CREATE POLICY "marketing_templates_manage_own" ON public.marketing_templates FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS marketing_templates_public_idx ON public.marketing_templates(is_public, likes DESC);
CREATE INDEX IF NOT EXISTS marketing_templates_org_idx    ON public.marketing_templates(org_id, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 19. PAYMENT LINKS (20260504_payment_links) — FK bug fixed: quotes not presupuestos
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.payment_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quote_id      uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  quote_number  text,
  customer_name text NOT NULL,
  customer_phone text,
  items         jsonb NOT NULL DEFAULT '[]',
  total_ars     numeric NOT NULL,
  mp_link       text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','pending_confirmation','paid','cancelled')),
  paid_at       timestamptz,
  notes         text,
  expires_at    date,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payment_links_org_access" ON public.payment_links;
CREATE POLICY "payment_links_org_access" ON public.payment_links FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);
DROP POLICY IF EXISTS "payment_links_public_read" ON public.payment_links;
CREATE POLICY "payment_links_public_read" ON public.payment_links FOR SELECT USING (true);
DROP POLICY IF EXISTS "payment_links_customer_update" ON public.payment_links;
CREATE POLICY "payment_links_customer_update" ON public.payment_links FOR UPDATE
  USING (true) WITH CHECK (status IN ('pending_confirmation'));

CREATE INDEX IF NOT EXISTS payment_links_org_idx   ON public.payment_links(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_links_quote_idx ON public.payment_links(quote_id);

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS bank_cbu    text,
  ADD COLUMN IF NOT EXISTS bank_alias  text,
  ADD COLUMN IF NOT EXISTS bank_name   text,
  ADD COLUMN IF NOT EXISTS bank_holder text;


-- ═══════════════════════════════════════════════════════════════════════════
-- 20. PRICE HISTORY (20260504_price_history)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.price_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  old_price_ars numeric,
  new_price_ars numeric NOT NULL,
  old_cost_usd  numeric,
  new_cost_usd  numeric,
  change_pct    numeric,
  changed_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "price_history_org_access" ON public.price_history;
CREATE POLICY "price_history_org_access" ON public.price_history FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS price_history_product_idx ON public.price_history(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS price_history_org_idx     ON public.price_history(org_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_price_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (TG_OP = 'UPDATE') AND (
    OLD.sale_price_ars IS DISTINCT FROM NEW.sale_price_ars OR
    OLD.total_cost_usd IS DISTINCT FROM NEW.total_cost_usd
  ) THEN
    INSERT INTO public.price_history (
      product_id, org_id,
      old_price_ars, new_price_ars,
      old_cost_usd,  new_cost_usd,
      change_pct, changed_by
    ) VALUES (
      NEW.id, NEW.org_id,
      OLD.sale_price_ars, NEW.sale_price_ars,
      OLD.total_cost_usd, NEW.total_cost_usd,
      CASE WHEN OLD.sale_price_ars > 0
        THEN ROUND(((NEW.sale_price_ars - OLD.sale_price_ars) / OLD.sale_price_ars) * 100, 1)
        ELSE NULL
      END,
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_price_change ON public.products;
CREATE TRIGGER trg_record_price_change
  AFTER UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.record_price_change();


-- ═══════════════════════════════════════════════════════════════════════════
-- 21. CUSTOMER REFERRALS (20260504_referrals)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.customer_referrals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  referrer_name   text NOT NULL,
  referred_name   text NOT NULL,
  referral_code   text NOT NULL,
  bonus_ars       numeric DEFAULT 0,
  bonus_points    integer DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','credited','cancelled')),
  sale_id         uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referrals_org_access" ON public.customer_referrals;
CREATE POLICY "referrals_org_access" ON public.customer_referrals FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS referrals_org_code_idx    ON public.customer_referrals(org_id, referral_code);
CREATE INDEX IF NOT EXISTS referrals_org_referrer_idx ON public.customer_referrals(org_id, referrer_name);

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS referral_enabled      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS referral_bonus_ars    integer DEFAULT 500,
  ADD COLUMN IF NOT EXISTS referral_bonus_points integer DEFAULT 5;


-- ═══════════════════════════════════════════════════════════════════════════
-- 22. SELLER COMMISSIONS (20260504_seller_commissions)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS commission_percent  numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_enabled  boolean DEFAULT false;

CREATE TABLE IF NOT EXISTS public.seller_payouts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_name        text NOT NULL,
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  sales_total_ars    numeric NOT NULL DEFAULT 0,
  commission_percent numeric NOT NULL DEFAULT 0,
  commission_ars     numeric NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  paid_at            timestamptz,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seller_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "seller_payouts_org_access" ON public.seller_payouts;
CREATE POLICY "seller_payouts_org_access" ON public.seller_payouts FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS seller_payouts_org_idx  ON public.seller_payouts(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS seller_payouts_user_idx ON public.seller_payouts(user_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 23. TASKS (20260504_tasks)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title        text NOT NULL,
  description  text,
  priority     text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','cancelled')),
  due_date     date,
  completed_at timestamptz,
  category     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_org_access" ON public.tasks;
CREATE POLICY "tasks_org_access" ON public.tasks FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS tasks_org_status_idx ON public.tasks(org_id, status, due_date);
CREATE INDEX IF NOT EXISTS tasks_assigned_idx   ON public.tasks(assigned_to, status);


-- ═══════════════════════════════════════════════════════════════════════════
-- 24. AUTOMATION FLOWS (20260504_automation_flows + v2)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.automation_flows (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name           text NOT NULL,
  trigger_type   text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}',
  action_type    text NOT NULL,
  action_config  jsonb NOT NULL DEFAULT '{}',
  active         boolean NOT NULL DEFAULT true,
  last_run_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_flows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_flows_org_access" ON public.automation_flows;
CREATE POLICY "automation_flows_org_access" ON public.automation_flows FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS automation_flows_org_active_idx ON public.automation_flows(org_id, active);

-- Widen check constraints (v2) — drop old, add new
ALTER TABLE public.automation_flows DROP CONSTRAINT IF EXISTS automation_flows_trigger_type_check;
ALTER TABLE public.automation_flows DROP CONSTRAINT IF EXISTS automation_flows_action_type_check;
ALTER TABLE public.automation_flows
  ADD CONSTRAINT automation_flows_trigger_type_check CHECK (trigger_type IN (
    'customer_inactive','debt_overdue','low_stock','birthday','stock_out','new_customer','big_sale'
  ));
ALTER TABLE public.automation_flows
  ADD CONSTRAINT automation_flows_action_type_check CHECK (action_type IN (
    'notification','email','whatsapp_message','create_task','create_purchase_order','webhook'
  ));


-- ═══════════════════════════════════════════════════════════════════════════
-- 25. LOCATIONS + STOCK TRANSFERS (20260504_locations)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.locations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  address    text,
  phone      text,
  is_main    boolean NOT NULL DEFAULT false,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "locations_org_access" ON public.locations;
CREATE POLICY "locations_org_access" ON public.locations FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS locations_org_idx ON public.locations(org_id, active);

CREATE TABLE IF NOT EXISTS public.location_stock (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  stock       integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(location_id, product_id)
);

ALTER TABLE public.location_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "location_stock_org_access" ON public.location_stock;
CREATE POLICY "location_stock_org_access" ON public.location_stock FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  to_location_id   uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  product_id       uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_name     text NOT NULL,
  quantity         integer NOT NULL CHECK (quantity > 0),
  notes            text,
  transferred_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_transfers_org_access" ON public.stock_transfers;
CREATE POLICY "stock_transfers_org_access" ON public.stock_transfers FOR ALL USING (
  org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS stock_transfers_org_idx ON public.stock_transfers(org_id, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 26. PRODUCT LOTS + TAGS (20260504_product_lots, 20260504_product_tags)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS lot_number  text,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS tags        text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS products_expiry_idx ON public.products(org_id, expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_tags_idx   ON public.products USING gin(tags) WHERE tags IS NOT NULL AND array_length(tags, 1) > 0;


-- ═══════════════════════════════════════════════════════════════════════════
-- 27. SETTINGS — remaining columns (webhook, AFIP, daily KPI alert)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS webhook_url     text,
  ADD COLUMN IF NOT EXISTS webhook_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS webhook_events  text[]  DEFAULT ARRAY['sale.created','stock.low','debt.overdue'];

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS afip_cuit            text,
  ADD COLUMN IF NOT EXISTS afip_razon_social    text,
  ADD COLUMN IF NOT EXISTS afip_domicilio       text,
  ADD COLUMN IF NOT EXISTS afip_punto_venta     integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS afip_environment     text    DEFAULT 'homologacion',
  ADD COLUMN IF NOT EXISTS afip_tipo_emisor     text    DEFAULT 'monotributo',
  ADD COLUMN IF NOT EXISTS afip_certificate     text,
  ADD COLUMN IF NOT EXISTS afip_private_key     text,
  ADD COLUMN IF NOT EXISTS afip_ta_token        text,
  ADD COLUMN IF NOT EXISTS afip_ta_sign         text,
  ADD COLUMN IF NOT EXISTS afip_ta_expires_at   timestamptz;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS daily_sales_alert_threshold  numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_margin_alert_threshold numeric DEFAULT 0;


-- ═══════════════════════════════════════════════════════════════════════════
-- 28. CASH ENTRIES (20260505_cash_entries)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cash_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id     UUID REFERENCES public.cash_sessions(id) ON DELETE SET NULL,
  entry_type     TEXT NOT NULL,
  payment_method TEXT,
  amount_ars     NUMERIC NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id   UUID,
  description    TEXT,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_entries_org     ON public.cash_entries(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_entries_session ON public.cash_entries(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_entries_ref     ON public.cash_entries(reference_type, reference_id);

ALTER TABLE public.cash_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members manage cash entries" ON public.cash_entries;
CREATE POLICY "org members manage cash entries" ON public.cash_entries FOR ALL TO authenticated
  USING    (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.trg_sale_cash_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id  UUID;
  v_session UUID;
BEGIN
  IF NOT NEW.paid THEN RETURN NEW; END IF;
  IF NEW.payment_method NOT IN ('efectivo','transferencia','debito','credito','mayorista') THEN
    RETURN NEW;
  END IF;
  SELECT m.org_id INTO v_org_id FROM public.memberships m WHERE m.user_id = NEW.user_id ORDER BY m.joined_at LIMIT 1;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_session FROM public.cash_sessions WHERE org_id = v_org_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF v_session IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.cash_entries (org_id, session_id, entry_type, payment_method, amount_ars, reference_type, reference_id, description, created_by)
  VALUES (v_org_id, v_session, 'sale_in', COALESCE(NEW.payment_method,'efectivo'), NEW.total_ars, 'sale', NEW.id, 'Venta ' || COALESCE(NEW.payment_method,'') || ': ' || NEW.product_name, NEW.user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_cash_entry ON public.sales;
CREATE TRIGGER trg_sale_cash_entry
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_cash_entry();

CREATE OR REPLACE VIEW public.cash_session_summary AS
SELECT
  cs.id AS session_id,
  cs.org_id, cs.opened_at, cs.closed_at, cs.status, cs.opening_amount,
  COALESCE(SUM(CASE WHEN ce.payment_method='efectivo' AND ce.entry_type IN ('sale_in','debt_payment','manual_in') THEN ce.amount_ars
                    WHEN ce.entry_type IN ('expense_out','supplier_out','manual_out') AND ce.payment_method='efectivo' THEN -ce.amount_ars
                    ELSE 0 END), 0) AS efectivo_neto,
  COALESCE(SUM(CASE WHEN ce.payment_method='transferencia' AND ce.entry_type IN ('sale_in','debt_payment') THEN ce.amount_ars ELSE 0 END), 0) AS transferencia_total,
  COALESCE(SUM(CASE WHEN ce.payment_method IN ('debito','credito') AND ce.entry_type IN ('sale_in','debt_payment') THEN ce.amount_ars ELSE 0 END), 0) AS tarjeta_total,
  COALESCE(SUM(CASE WHEN ce.entry_type='sale_in' THEN ce.amount_ars ELSE 0 END), 0) AS total_ventas,
  COALESCE(SUM(CASE WHEN ce.entry_type='debt_payment' THEN ce.amount_ars ELSE 0 END), 0) AS total_cobros,
  COALESCE(SUM(CASE WHEN ce.entry_type IN ('expense_out','supplier_out','manual_out') THEN ce.amount_ars ELSE 0 END), 0) AS total_egresos,
  COUNT(ce.id) AS total_movements
FROM public.cash_sessions cs
LEFT JOIN public.cash_entries ce ON ce.session_id = cs.id
GROUP BY cs.id, cs.org_id, cs.opened_at, cs.closed_at, cs.status, cs.opening_amount;

CREATE OR REPLACE FUNCTION public.record_debt_payment_cash_entry(
  p_org_id UUID, p_debt_id UUID, p_amount_ars NUMERIC,
  p_payment_method TEXT, p_description TEXT, p_created_by UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_session  UUID;
  v_entry_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE org_id = p_org_id AND user_id = p_created_by)
  THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT id INTO v_session FROM public.cash_sessions WHERE org_id = p_org_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
  INSERT INTO public.cash_entries (org_id, session_id, entry_type, payment_method, amount_ars, reference_type, reference_id, description, created_by)
  VALUES (p_org_id, v_session, 'debt_payment', p_payment_method, p_amount_ars, 'debt', p_debt_id, COALESCE(p_description,'Cobro de deuda'), p_created_by)
  RETURNING id INTO v_entry_id;
  RETURN v_entry_id;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 29. KARDEX — STOCK MOVEMENTS (20260505_kardex)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id     UUID REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id     UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_name   TEXT NOT NULL,
  variant_name   TEXT,
  movement_type  TEXT NOT NULL,
  quantity       INTEGER NOT NULL,
  stock_before   INTEGER NOT NULL DEFAULT 0,
  stock_after    INTEGER NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id   UUID,
  unit_cost_usd  NUMERIC,
  unit_price_ars NUMERIC,
  notes          TEXT,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_org     ON public.stock_movements(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON public.stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant ON public.stock_movements(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type    ON public.stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref     ON public.stock_movements(reference_type, reference_id);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members read stock movements" ON public.stock_movements;
CREATE POLICY "org members read stock movements" ON public.stock_movements FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "org members insert stock movements" ON public.stock_movements;
CREATE POLICY "org members insert stock movements" ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_org_id UUID, p_product_id UUID, p_variant_id UUID,
  p_product_name TEXT, p_variant_name TEXT,
  p_movement_type TEXT, p_quantity INTEGER,
  p_reference_type TEXT DEFAULT NULL, p_reference_id UUID DEFAULT NULL,
  p_unit_cost_usd NUMERIC DEFAULT NULL, p_unit_price_ars NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL, p_created_by UUID DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_stock_before INTEGER;
  v_stock_after  INTEGER;
  v_mov_id       UUID;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_stock_before FROM public.product_variants WHERE id = p_variant_id;
  ELSE
    SELECT stock INTO v_stock_before FROM public.products WHERE id = p_product_id;
  END IF;
  v_stock_before := COALESCE(v_stock_before, 0);
  v_stock_after  := v_stock_before + p_quantity;
  IF p_variant_id IS NOT NULL THEN
    UPDATE public.product_variants SET stock = v_stock_after WHERE id = p_variant_id;
    UPDATE public.products p SET stock = (SELECT COALESCE(SUM(pv.stock),0) FROM public.product_variants pv WHERE pv.product_id = p.id) WHERE id = p_product_id;
  ELSE
    UPDATE public.products SET stock = v_stock_after WHERE id = p_product_id;
  END IF;
  INSERT INTO public.stock_movements (
    org_id, product_id, variant_id, product_name, variant_name,
    movement_type, quantity, stock_before, stock_after,
    reference_type, reference_id, unit_cost_usd, unit_price_ars, notes, created_by
  ) VALUES (
    p_org_id, p_product_id, p_variant_id, p_product_name, p_variant_name,
    p_movement_type, p_quantity, v_stock_before, v_stock_after,
    p_reference_type, p_reference_id, p_unit_cost_usd, p_unit_price_ars, p_notes, p_created_by
  ) RETURNING id INTO v_mov_id;
  RETURN v_mov_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sale_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id       UUID;
  v_variant_name TEXT;
BEGIN
  SELECT m.org_id INTO v_org_id FROM public.memberships m WHERE m.user_id = NEW.user_id ORDER BY m.joined_at LIMIT 1;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.variant_id IS NOT NULL THEN
    SELECT variant_name INTO v_variant_name FROM public.product_variants WHERE id = NEW.variant_id;
  END IF;
  PERFORM public.record_stock_movement(
    p_org_id=>v_org_id, p_product_id=>NEW.product_id, p_variant_id=>NEW.variant_id,
    p_product_name=>NEW.product_name, p_variant_name=>v_variant_name,
    p_movement_type=>'sale', p_quantity=>-NEW.quantity,
    p_reference_type=>'sale', p_reference_id=>NEW.id,
    p_unit_cost_usd=>NEW.cost_per_unit_usd, p_unit_price_ars=>NEW.unit_price_ars,
    p_created_by=>NEW.user_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_stock_movement ON public.sales;
CREATE TRIGGER trg_sale_stock_movement
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_sale_stock_movement();

CREATE OR REPLACE FUNCTION public.trg_purchase_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org_id UUID;
BEGIN
  SELECT m.org_id INTO v_org_id FROM public.memberships m WHERE m.user_id = NEW.user_id ORDER BY m.joined_at LIMIT 1;
  IF v_org_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.record_stock_movement(
    p_org_id=>v_org_id, p_product_id=>NEW.product_id, p_variant_id=>NULL,
    p_product_name=>NEW.product_name, p_variant_name=>NULL,
    p_movement_type=>'purchase', p_quantity=>NEW.quantity,
    p_reference_type=>'purchase', p_reference_id=>NEW.id,
    p_unit_cost_usd=>NEW.unit_cost_usd, p_created_by=>NEW.user_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_stock_movement ON public.purchases;
CREATE TRIGGER trg_purchase_stock_movement
  AFTER INSERT ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.trg_purchase_stock_movement();

CREATE OR REPLACE VIEW public.kardex_summary AS
SELECT
  sm.org_id, sm.product_id, sm.product_name,
  p.stock AS current_stock,
  COUNT(*)                                                            AS total_movements,
  SUM(CASE WHEN sm.quantity > 0 THEN sm.quantity ELSE 0 END)         AS total_in,
  SUM(CASE WHEN sm.quantity < 0 THEN ABS(sm.quantity) ELSE 0 END)    AS total_out,
  MAX(sm.created_at)                                                  AS last_movement_at
FROM public.stock_movements sm
LEFT JOIN public.products p ON p.id = sm.product_id
GROUP BY sm.org_id, sm.product_id, sm.product_name, p.stock;

CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_org_id UUID, p_product_id UUID, p_variant_id UUID,
  p_new_stock INTEGER, p_notes TEXT, p_created_by UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_stock INTEGER;
  v_delta         INTEGER;
  v_product_name  TEXT;
  v_variant_name  TEXT;
  v_movement_type TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE org_id = p_org_id AND user_id = p_created_by)
  THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT name INTO v_product_name FROM public.products WHERE id = p_product_id;
  IF p_variant_id IS NOT NULL THEN
    SELECT variant_name, stock INTO v_variant_name, v_current_stock FROM public.product_variants WHERE id = p_variant_id;
  ELSE
    SELECT stock INTO v_current_stock FROM public.products WHERE id = p_product_id;
  END IF;
  v_current_stock := COALESCE(v_current_stock, 0);
  v_delta := p_new_stock - v_current_stock;
  IF v_delta = 0 THEN RETURN NULL; END IF;
  v_movement_type := CASE WHEN v_delta > 0 THEN 'adjustment_in' ELSE 'adjustment_out' END;
  RETURN public.record_stock_movement(
    p_org_id=>p_org_id, p_product_id=>p_product_id, p_variant_id=>p_variant_id,
    p_product_name=>v_product_name, p_variant_name=>v_variant_name,
    p_movement_type=>v_movement_type, p_quantity=>v_delta,
    p_reference_type=>'manual', p_notes=>p_notes, p_created_by=>p_created_by
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 30. ONBOARDING FLAG (20260505_onboarding_flag)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;

UPDATE public.organizations o
SET onboarding_completed = true
WHERE onboarding_completed = false
  AND EXISTS (
    SELECT 1 FROM public.settings s
    WHERE s.org_id = o.id
      AND s.business_name IS NOT NULL
      AND s.business_name != ''
      AND s.business_name != 'Mi Negocio'
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 31. SALES — quote link (20260505_sales_quote_link)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_quote ON public.sales(quote_id) WHERE quote_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 32. DEMO DATA FUNCTION (20260505_demo_data_function)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.seed_demo_data(p_org_id uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prod1 uuid := gen_random_uuid();
  v_prod2 uuid := gen_random_uuid();
  v_prod3 uuid := gen_random_uuid();
  v_sale1 uuid := gen_random_uuid();
  v_sale2 uuid := gen_random_uuid();
  v_sale3 uuid := gen_random_uuid();
  v_today date := current_date;
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE org_id = p_org_id LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'org already has products');
  END IF;
  INSERT INTO public.products (id, org_id, user_id, name, brand, category, gender, cost_usd, customs_fee, total_cost_usd, sale_price_ars, profit_per_unit_ars, profit_per_unit_usd, stock, featured) VALUES
    (v_prod1, p_org_id, p_user_id, 'BACCARAT ROUGE 540', 'MAISON FRANCIS KURKDJIAN', 'perfume_arabe', 'unisex', 8.50, 1.50, 10.00, 15000, 5000, 3.33, 12, true),
    (v_prod2, p_org_id, p_user_id, 'GOOD GIRL', 'CAROLINA HERRERA', 'perfume_mujer', 'mujer', 6.00, 1.00, 7.00, 10500, 3500, 2.33, 8, false),
    (v_prod3, p_org_id, p_user_id, 'SAUVAGE EDP', 'DIOR', 'perfume_hombre', 'hombre', 7.50, 1.50, 9.00, 13500, 4500, 3.00, 5, false);
  INSERT INTO public.settings (org_id, user_id, business_name, usd_rate_blue, low_stock_threshold)
  VALUES (p_org_id, p_user_id, 'Mi Perfumería', 1200, 3) ON CONFLICT (org_id) DO NOTHING;
  INSERT INTO public.sales (id, org_id, user_id, product_id, product_name, quantity, unit_price_ars, total_ars, cost_per_unit_usd, profit_ars, profit_usd, customer_name, date, paid, payment_method) VALUES
    (v_sale1, p_org_id, p_user_id, v_prod1, 'BACCARAT ROUGE 540', 1, 15000, 15000, 10.00, 5000, 4.17, 'María González', (v_today - 2)::timestamptz, true, 'transferencia'),
    (v_sale2, p_org_id, p_user_id, v_prod2, 'GOOD GIRL', 2, 10500, 21000, 7.00, 7000, 5.83, 'Laura Martínez', (v_today - 1)::timestamptz, true, 'efectivo'),
    (v_sale3, p_org_id, p_user_id, v_prod3, 'SAUVAGE EDP', 1, 13500, 13500, 9.00, 4500, 3.75, 'Carlos Pérez', v_today::timestamptz, false, 'transferencia');
  INSERT INTO public.debts (org_id, user_id, sale_id, customer_name, amount_ars, paid_ars, remaining_ars, status, description)
  VALUES (p_org_id, p_user_id, v_sale3, 'Carlos Pérez', 13500, 0, 13500, 'pending', 'SAUVAGE EDP — pago pendiente');
  INSERT INTO public.customers (org_id, user_id, name, phone, tags, notes)
  VALUES (p_org_id, p_user_id, 'María González', '+54 9 11 1234-5678', ARRAY['VIP','Baccarat'], 'Cliente frecuente, regalo habitual') ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'products', 3, 'sales', 3);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_demo_data(uuid, uuid) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 33. TRIAL EXPIRATION FUNCTION (20260505_trial_expiration_cron)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.expire_overdue_trials()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.subscriptions s
  SET status = 'past_due'
  FROM public.organizations o
  WHERE s.org_id = o.id
    AND s.status = 'trialing'
    AND o.trial_ends_at IS NOT NULL
    AND o.trial_ends_at < now()
    AND s.stripe_subscription_id IS NULL;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 34. PG_CRON JOBS (only if pg_cron extension is enabled)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Trial expiration (hourly)
    PERFORM cron.schedule('expire-overdue-trials', '0 * * * *', $j$ SELECT public.expire_overdue_trials(); $j$);

    -- Customer reactivation alerts (daily 9AM UTC)
    PERFORM cron.schedule('customer-reactivation-alerts', '0 9 * * *', $j$
      SELECT net.http_post(
        url := current_setting('app.supabase_functions_url') || '/customer-reactivation-alerts',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
        body := '{}'::jsonb
      )
    $j$);

    -- Daily KPI alert (9AM UTC)
    PERFORM cron.schedule('daily-kpi-alert', '0 9 * * *', $j$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/daily-kpi-alert',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.supabase_service_key')),
        body := '{}'::jsonb
      )
    $j$);

    -- Automation flows runner (11AM UTC daily)
    PERFORM cron.schedule('run-automation-flows-daily', '0 11 * * *', $j$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/run-automation-flows',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.supabase_anon_key')),
        body := '{}'::jsonb
      )
    $j$);

    -- Weekly performance digest (Mondays 9AM UTC)
    PERFORM cron.schedule('weekly-performance-digest', '0 9 * * 1', $j$
      SELECT net.http_post(
        url := current_setting('app.supabase_url') || '/functions/v1/weekly-performance-digest',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || current_setting('app.service_role_key')),
        body := '{}'::jsonb
      )
    $j$);
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- pg_cron not enabled — skip silently
  NULL;
END $$;
