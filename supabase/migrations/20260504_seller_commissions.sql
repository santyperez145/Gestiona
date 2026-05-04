-- Seller commission configuration per membership
alter table public.memberships
  add column if not exists commission_percent numeric default 0,
  add column if not exists commission_enabled boolean default false;

-- Seller commission payouts
create table if not exists public.seller_payouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seller_name text not null,
  period_start date not null,
  period_end date not null,
  sales_total_ars numeric not null default 0,
  commission_percent numeric not null default 0,
  commission_ars numeric not null default 0,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.seller_payouts enable row level security;

create policy "seller_payouts_org_access" on public.seller_payouts
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists seller_payouts_org_idx on public.seller_payouts (org_id, created_at desc);
create index if not exists seller_payouts_user_idx on public.seller_payouts (user_id);
