-- Marketing automation flows table
create table if not exists public.automation_flows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  trigger_type text not null check (trigger_type in ('customer_inactive', 'debt_overdue', 'low_stock', 'birthday')),
  trigger_config jsonb not null default '{}',
  action_type text not null check (action_type in ('whatsapp_message', 'notification', 'email')),
  action_config jsonb not null default '{}',
  active boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.automation_flows enable row level security;

create policy "automation_flows_org_access" on public.automation_flows
  for all using (
    org_id in (
      select org_id from public.memberships where user_id = auth.uid()
    )
  );

create index if not exists automation_flows_org_active_idx on public.automation_flows (org_id, active);
