-- Business task management
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'cancelled')),
  due_date date,
  completed_at timestamptz,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks enable row level security;

create policy "tasks_org_access" on public.tasks
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists tasks_org_status_idx on public.tasks (org_id, status, due_date);
create index if not exists tasks_assigned_idx on public.tasks (assigned_to, status);
