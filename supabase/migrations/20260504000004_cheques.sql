-- Post-dated checks (cheques diferidos) tracking
create table if not exists public.cheques (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type text not null default 'received' check (type in ('received', 'issued')),
  customer_name text,
  bank_name text,
  check_number text,
  amount_ars numeric not null,
  issue_date date,
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'deposited', 'cleared', 'bounced', 'cancelled')),
  deposited_at date,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.cheques enable row level security;

create policy "cheques_org_access" on public.cheques
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists cheques_org_due_idx on public.cheques (org_id, due_date, status);
