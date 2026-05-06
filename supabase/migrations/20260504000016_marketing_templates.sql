-- Public marketing template marketplace
-- Templates are shared across all orgs (public) or private to one org
create table if not exists public.marketing_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  content text not null,
  post_type text not null default 'post',
  industry text,
  tags text[] default '{}',
  is_public boolean not null default false,
  likes integer not null default 0,
  uses_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.marketing_templates enable row level security;

-- Public templates: anyone can read
create policy "marketing_templates_read_public" on public.marketing_templates
  for select using (is_public = true or org_id in (
    select org_id from public.memberships where user_id = auth.uid()
  ));

-- Org members can insert/update/delete their own org's templates
create policy "marketing_templates_manage_own" on public.marketing_templates
  for all using (
    org_id in (select org_id from public.memberships where user_id = auth.uid())
  );

create index if not exists marketing_templates_public_idx on public.marketing_templates (is_public, likes desc);
create index if not exists marketing_templates_org_idx on public.marketing_templates (org_id, created_at desc);
