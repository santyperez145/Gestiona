-- Multi-location / branch support
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text,
  phone text,
  is_main boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.locations enable row level security;

create policy "locations_org_access" on public.locations
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists locations_org_idx on public.locations (org_id, active);

-- Location-level stock tracking (separate from global product stock)
create table if not exists public.location_stock (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  stock integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(location_id, product_id)
);

alter table public.location_stock enable row level security;

create policy "location_stock_org_access" on public.location_stock
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

-- Inter-location stock transfers
create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  from_location_id uuid references public.locations(id) on delete set null,
  to_location_id uuid references public.locations(id) on delete set null,
  product_id uuid not null references public.products(id) on delete cascade,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  notes text,
  transferred_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.stock_transfers enable row level security;

create policy "stock_transfers_org_access" on public.stock_transfers
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists stock_transfers_org_idx on public.stock_transfers (org_id, created_at desc);
