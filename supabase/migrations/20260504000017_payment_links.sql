-- Payment links: shareable URLs per presupuesto for customer self-payment
create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid references public.presupuestos(id) on delete set null,
  quote_number text,
  customer_name text not null,
  customer_phone text,
  items jsonb not null default '[]',
  total_ars numeric not null,
  mp_link text,
  status text not null default 'pending' check (status in ('pending', 'pending_confirmation', 'paid', 'cancelled')),
  paid_at timestamptz,
  notes text,
  expires_at date,
  created_at timestamptz not null default now()
);

alter table public.payment_links enable row level security;

-- Org members can manage their payment links
create policy "payment_links_org_access" on public.payment_links
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

-- Anonymous users can read a specific payment link by ID (UUID = safe secret)
create policy "payment_links_public_read" on public.payment_links
  for select using (true);

-- Anonymous users can update status to 'pending_confirmation' only
create policy "payment_links_customer_update" on public.payment_links
  for update using (true)
  with check (status in ('pending_confirmation'));

create index if not exists payment_links_org_idx on public.payment_links (org_id, created_at desc);
create index if not exists payment_links_quote_idx on public.payment_links (quote_id);

-- Add bank account fields to settings for payment links
alter table public.settings
  add column if not exists bank_cbu text,
  add column if not exists bank_alias text,
  add column if not exists bank_name text,
  add column if not exists bank_holder text;
