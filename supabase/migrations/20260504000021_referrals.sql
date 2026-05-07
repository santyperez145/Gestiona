-- Customer referral program
create table if not exists public.customer_referrals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  referrer_name text not null,
  referred_name text not null,
  referral_code text not null,
  bonus_ars numeric default 0,
  bonus_points integer default 0,
  status text not null default 'pending' check (status in ('pending', 'credited', 'cancelled')),
  sale_id uuid references public.sales(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.customer_referrals enable row level security;

create policy "referrals_org_access" on public.customer_referrals
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists referrals_org_code_idx on public.customer_referrals (org_id, referral_code);
create index if not exists referrals_org_referrer_idx on public.customer_referrals (org_id, referrer_name);

-- Add referral settings columns to settings table
alter table public.settings
  add column if not exists referral_enabled boolean default false,
  add column if not exists referral_bonus_ars integer default 500,
  add column if not exists referral_bonus_points integer default 5;
