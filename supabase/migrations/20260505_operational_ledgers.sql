-- Operational ledgers: stock, treasury and customer payments

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  source_type text not null check (source_type in ('sale', 'purchase', 'return', 'exchange', 'adjustment', 'stock_count', 'transfer')),
  source_id uuid,
  movement_type text not null check (movement_type in ('in', 'out', 'adjustment')),
  quantity integer not null,
  previous_stock integer,
  new_stock integer,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.stock_movements enable row level security;

create policy "org_members_manage_stock_movements" on public.stock_movements
  for all using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

create index if not exists stock_movements_org_created_idx on public.stock_movements (org_id, created_at desc);
create index if not exists stock_movements_product_idx on public.stock_movements (product_id, created_at desc);
create index if not exists stock_movements_variant_idx on public.stock_movements (variant_id, created_at desc);
create index if not exists stock_movements_source_idx on public.stock_movements (source_type, source_id);

create table if not exists public.financial_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  cash_session_id uuid references public.cash_sessions(id) on delete set null,
  source_type text not null check (source_type in ('sale', 'debt_payment', 'supplier_payment', 'return', 'expense', 'manual', 'cash_open', 'cash_close')),
  source_id uuid,
  direction text not null check (direction in ('in', 'out')),
  payment_method text not null,
  channel text not null check (channel in ('cash', 'bank', 'card', 'store_credit', 'other')),
  affects_cash boolean not null default false,
  affects_bank boolean not null default false,
  amount_ars numeric not null default 0,
  counterparty text,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  happened_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.financial_movements enable row level security;

create policy "org_members_manage_financial_movements" on public.financial_movements
  for all using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

create index if not exists financial_movements_org_happened_idx on public.financial_movements (org_id, happened_at desc);
create index if not exists financial_movements_session_idx on public.financial_movements (cash_session_id, happened_at desc);
create index if not exists financial_movements_source_idx on public.financial_movements (source_type, source_id);

create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  customer_name text not null,
  amount_ars numeric not null default 0,
  payment_method text not null default 'efectivo',
  note text,
  paid_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

alter table public.customer_payments enable row level security;

create policy "org_members_manage_customer_payments" on public.customer_payments
  for all using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

create index if not exists customer_payments_org_paid_idx on public.customer_payments (org_id, paid_at desc);
create index if not exists customer_payments_debt_idx on public.customer_payments (debt_id, paid_at desc);

alter table public.supplier_debts
  add column if not exists purchase_id uuid references public.purchases(id) on delete set null;

create index if not exists supplier_debts_purchase_idx on public.supplier_debts (purchase_id);

alter table public.returns
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists variant_id uuid references public.product_variants(id) on delete set null;

alter table public.sales
  add column if not exists returned_quantity integer not null default 0;

