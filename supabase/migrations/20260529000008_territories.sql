-- ─────────────────────────────────────────────────────────────────
-- Territory management & auto-assignment
-- Sprint C2: rule-based routing of new leads/customers/deals to
-- the right vendedor — equivalent of Salesforce Territory Management
-- ─────────────────────────────────────────────────────────────────

-- ─── Territories table ──────────────────────────────────────────────────────
create table if not exists public.territories (
  id          uuid        primary key default gen_random_uuid(),
  org_id      uuid        not null references public.organizations(id) on delete cascade,
  name        text        not null,
  description text,
  color       text        default '#3b82f6',
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, name)
);

create index if not exists idx_territories_org on public.territories(org_id, active);

-- ─── Rules table ────────────────────────────────────────────────────────────
-- A rule is a set of conditions (matched as AND). Multiple rules per territory
-- (matched as OR). Rules are evaluated in priority order (lowest first).
create table if not exists public.territory_rules (
  id             uuid        primary key default gen_random_uuid(),
  org_id         uuid        not null references public.organizations(id) on delete cascade,
  territory_id   uuid        not null references public.territories(id) on delete cascade,
  name           text        not null default 'Regla',
  priority       int         not null default 100,
  -- conditions: { field, op, value }[]
  --   field: city | province | tag | value_min | value_max | source | industry
  --   op:    eq | neq | contains | starts_with | gte | lte | in
  --   value: string | number | string[]
  conditions     jsonb       not null default '[]',
  -- assignment
  assigned_user_id uuid      references auth.users(id) on delete set null,
  use_round_robin  boolean   not null default false, -- if true, pick least-loaded vendedor in territory
  active           boolean   not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_territory_rules_org_priority on public.territory_rules(org_id, active, priority);

-- ─── Territory members (for round-robin assignment) ─────────────────────────
create table if not exists public.territory_members (
  territory_id uuid not null references public.territories(id) on delete cascade,
  user_id      uuid not null references auth.users(id)         on delete cascade,
  weight       int  not null default 1,    -- relative round-robin weight
  primary key (territory_id, user_id)
);

create index if not exists idx_territory_members_user on public.territory_members(user_id);

-- ─── Assignment audit (so we know why X was assigned to Y) ──────────────────
create table if not exists public.territory_assignments (
  id            uuid        primary key default gen_random_uuid(),
  org_id        uuid        not null,
  entity_type   text        not null check (entity_type in ('customer','deal','lead')),
  entity_id     uuid        not null,
  territory_id  uuid        references public.territories(id) on delete set null,
  rule_id       uuid        references public.territory_rules(id) on delete set null,
  assigned_user_id uuid     references auth.users(id) on delete set null,
  reason        text,                                          -- which rule matched, e.g. "city = Córdoba"
  created_at    timestamptz not null default now()
);

create index if not exists idx_territory_assignments_entity on public.territory_assignments(entity_type, entity_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.territories            enable row level security;
alter table public.territory_rules        enable row level security;
alter table public.territory_members      enable row level security;
alter table public.territory_assignments  enable row level security;

drop policy if exists "org_territories_all"           on public.territories;
drop policy if exists "org_territory_rules_all"       on public.territory_rules;
drop policy if exists "org_territory_members_read"    on public.territory_members;
drop policy if exists "org_territory_members_write"   on public.territory_members;
drop policy if exists "org_territory_assignments_read" on public.territory_assignments;

create policy "org_territories_all" on public.territories for all
  using  (org_id in (select org_id from public.memberships where user_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where user_id = auth.uid()));

create policy "org_territory_rules_all" on public.territory_rules for all
  using  (org_id in (select org_id from public.memberships where user_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where user_id = auth.uid()));

create policy "org_territory_members_read" on public.territory_members for select
  using (territory_id in (select id from public.territories where org_id in (select org_id from public.memberships where user_id = auth.uid())));

create policy "org_territory_members_write" on public.territory_members for all
  using (territory_id in (select id from public.territories where org_id in (select org_id from public.memberships where user_id = auth.uid() and role in ('owner','admin'))))
  with check (territory_id in (select id from public.territories where org_id in (select org_id from public.memberships where user_id = auth.uid() and role in ('owner','admin'))));

create policy "org_territory_assignments_read" on public.territory_assignments for select
  using (org_id in (select org_id from public.memberships where user_id = auth.uid()));

-- ─── Helper: evaluate a single rule against an entity attributes blob ───────
create or replace function public.eval_territory_conditions(
  p_conditions jsonb,
  p_attributes jsonb
) returns boolean
language plpgsql immutable as $$
declare
  cond jsonb;
  field text;
  op text;
  raw_val jsonb;
  attr_val text;
  attr_num numeric;
begin
  if jsonb_typeof(p_conditions) <> 'array' or jsonb_array_length(p_conditions) = 0 then
    return true; -- empty conditions = matches anything
  end if;

  for cond in select * from jsonb_array_elements(p_conditions) loop
    field    := cond->>'field';
    op       := coalesce(cond->>'op', 'eq');
    raw_val  := cond->'value';
    attr_val := lower(coalesce(p_attributes->>field, ''));

    case op
      when 'eq' then
        if attr_val <> lower(coalesce(raw_val#>>'{}', '')) then return false; end if;
      when 'neq' then
        if attr_val = lower(coalesce(raw_val#>>'{}', '')) then return false; end if;
      when 'contains' then
        if position(lower(coalesce(raw_val#>>'{}', '')) in attr_val) = 0 then return false; end if;
      when 'starts_with' then
        if attr_val not like lower(coalesce(raw_val#>>'{}', '')) || '%' then return false; end if;
      when 'gte' then
        attr_num := (p_attributes->>field)::numeric;
        if attr_num is null or attr_num < (raw_val#>>'{}')::numeric then return false; end if;
      when 'lte' then
        attr_num := (p_attributes->>field)::numeric;
        if attr_num is null or attr_num > (raw_val#>>'{}')::numeric then return false; end if;
      when 'in' then
        if not (raw_val ? attr_val) then return false; end if;
      else
        return false;
    end case;
  end loop;

  return true;
end;
$$;

-- ─── Main RPC: apply territory rules ────────────────────────────────────────
-- Walks rules in priority order, finds the first match, applies assignment.
-- Inserts an audit row in territory_assignments. Returns the assigned user_id
-- (or null if no rule matched).
create or replace function public.apply_territory_rules(
  p_org_id      uuid,
  p_entity_type text,                -- 'customer' | 'deal' | 'lead'
  p_entity_id   uuid,
  p_attributes  jsonb                -- { city, province, value, tag, source, ... }
) returns uuid
language plpgsql security definer as $$
declare
  rule public.territory_rules;
  v_assigned uuid;
  v_reason   text;
  rr_user    uuid;
begin
  for rule in
    select * from public.territory_rules
    where org_id = p_org_id and active = true
    order by priority asc, created_at asc
  loop
    if not public.eval_territory_conditions(rule.conditions, p_attributes) then
      continue;
    end if;

    -- Match! Resolve assignee:
    if rule.use_round_robin then
      -- Pick the member of the territory with the FEWEST recent assignments
      select tm.user_id into rr_user
      from public.territory_members tm
      where tm.territory_id = rule.territory_id
      order by (
        select count(*)
        from public.territory_assignments ta
        where ta.assigned_user_id = tm.user_id
          and ta.created_at > now() - interval '30 days'
      ) asc, random()
      limit 1;
      v_assigned := rr_user;
    else
      v_assigned := rule.assigned_user_id;
    end if;

    if v_assigned is null then continue; end if;

    -- Build a human-readable reason
    v_reason := coalesce(rule.name, 'rule:' || rule.id::text);

    insert into public.territory_assignments(
      org_id, entity_type, entity_id, territory_id, rule_id, assigned_user_id, reason
    ) values (
      p_org_id, p_entity_type, p_entity_id, rule.territory_id, rule.id, v_assigned, v_reason
    );

    return v_assigned;
  end loop;

  return null;
end;
$$;

grant execute on function public.apply_territory_rules(uuid, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.eval_territory_conditions(jsonb, jsonb) to authenticated, service_role;

comment on table public.territories is
  'Sales territories — typically geographic but can represent any segmentation (industry, deal size, etc).';
comment on table public.territory_rules is
  'Rule-based routing. Conditions: array of {field, op, value} AND-matched. Multiple rules per territory OR-matched.';
comment on function public.apply_territory_rules(uuid, text, uuid, jsonb) is
  'Walks active rules in priority order, returns the assigned user_id for the first match, audits the decision.';
