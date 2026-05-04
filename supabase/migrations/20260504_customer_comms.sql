-- Customer communications / interaction log
create table if not exists public.customer_communications (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  customer_name text not null,
  type          text not null default 'note'
                check (type in ('note','call','whatsapp','email','visit','other')),
  summary       text not null,
  created_at    timestamptz default now()
);

alter table public.customer_communications enable row level security;

create policy "comm_org_access" on public.customer_communications
  for all using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

create index if not exists customer_comms_org_name_idx
  on public.customer_communications (org_id, customer_name, created_at desc);
