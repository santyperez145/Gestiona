-- Installment payments (cuotas) tracking on sales
alter table public.sales
  add column if not exists installments integer default 1 check (installments >= 1),
  add column if not exists installment_amount_ars numeric,
  add column if not exists first_installment_date date;

-- Cuotas proyectadas (for cash flow projection)
create table if not exists public.installment_schedule (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  installment_number integer not null,
  amount_ars numeric not null,
  due_date date not null,
  paid boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.installment_schedule enable row level security;

create policy "installment_schedule_org_access" on public.installment_schedule
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists installment_schedule_org_due_idx on public.installment_schedule (org_id, due_date, paid);
create index if not exists installment_schedule_sale_idx on public.installment_schedule (sale_id);
