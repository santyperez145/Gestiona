-- Sales pipeline deals table
create table if not exists public.deals (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  customer_name text,
  value_ars   numeric default 0,
  stage       text not null default 'lead'
              check (stage in ('lead','contactado','propuesta','negociacion','cerrado','perdido')),
  notes       text,
  expected_close date,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- RLS
alter table public.deals enable row level security;

create policy "deals_org_access" on public.deals
  for all using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

-- Index for performance
create index if not exists deals_org_stage_idx on public.deals (org_id, stage);
