-- Session 48: Team Chat (real-time messaging between org members)
-- 2026-05-22

create table if not exists team_messages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null,
  sender_name text not null,
  content     text not null check (char_length(content) <= 2000),
  created_at  timestamptz default now()
);

create index if not exists team_messages_org_created
  on team_messages (org_id, created_at desc);

alter table team_messages enable row level security;

-- Members of the org can read messages
create policy "org_members_select_team_messages"
  on team_messages for select
  using (
    exists (
      select 1 from memberships
      where org_id = team_messages.org_id
        and user_id = auth.uid()
    )
  );

-- Members can insert their own messages
create policy "org_members_insert_team_messages"
  on team_messages for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from memberships
      where org_id = team_messages.org_id
        and user_id = auth.uid()
    )
  );

-- Authors can delete their own messages
create policy "author_delete_team_messages"
  on team_messages for delete
  using (user_id = auth.uid());

-- Enable realtime for this table (required for Postgres Changes subscription)
alter publication supabase_realtime add table team_messages;
