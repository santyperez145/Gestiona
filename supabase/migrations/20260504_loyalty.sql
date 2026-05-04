-- Loyalty points ledger
create table if not exists public.loyalty_points (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  customer_name text not null,
  delta         integer not null,          -- positive = earn, negative = redeem
  reason        text,                      -- 'sale', 'manual', 'redeem', etc.
  reference_id  uuid,                      -- sale id or null
  created_at    timestamptz default now()
);

alter table public.loyalty_points enable row level security;

create policy "loyalty_org_access" on public.loyalty_points
  for all using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

create index if not exists loyalty_org_customer_idx on public.loyalty_points (org_id, customer_name);

-- Settings: points_per_1000_ars (how many points per $1000 spent)
-- We'll store this in the existing settings.monthly_targets jsonb or as a separate column.
-- Add a dedicated column to settings for loyalty config.
alter table public.settings add column if not exists loyalty_enabled boolean default false;
alter table public.settings add column if not exists loyalty_points_per_1000 integer default 1;
alter table public.settings add column if not exists loyalty_points_value_ars integer default 100; -- 1 point = $100 ARS discount
