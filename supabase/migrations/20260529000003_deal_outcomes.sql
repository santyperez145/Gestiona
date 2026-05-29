-- ─────────────────────────────────────────────────────────────────
-- Deal Outcomes — registro estructurado de cierre de deals
-- Sprint B1: CRM Intelligence
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.deal_outcomes (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  deal_id         uuid references public.deals(id) on delete set null,
  deal_title      text not null,
  outcome         text not null check (outcome in ('won', 'lost')),
  reason          text not null,          -- precio / competencia / timing / etc
  reason_detail   text,                   -- texto libre del vendedor
  deal_value      numeric(14,2),
  currency        text default 'ARS',
  competitor      text,                   -- competidor nombrado (si aplica)
  customer_name   text,
  seller_name     text,
  stage_at_close  text,                   -- desde qué etapa se cerró
  days_in_pipeline int,
  closed_at       timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists deal_outcomes_org_id_closed on public.deal_outcomes(org_id, closed_at desc);
create index if not exists deal_outcomes_outcome        on public.deal_outcomes(org_id, outcome);
create index if not exists deal_outcomes_reason         on public.deal_outcomes(org_id, reason);

alter table public.deal_outcomes enable row level security;

create policy "org members can read deal outcomes"
  on public.deal_outcomes for select
  using (org_id in (select org_id from public.memberships where user_id = auth.uid()));

create policy "org members can insert deal outcomes"
  on public.deal_outcomes for insert
  with check (org_id in (select org_id from public.memberships where user_id = auth.uid()));

-- Vista de analytics: win rate por razón
create or replace view public.deal_outcome_stats as
  select
    org_id,
    outcome,
    reason,
    count(*)                                as total,
    sum(deal_value)                         as total_value,
    avg(days_in_pipeline)                   as avg_days,
    date_trunc('month', closed_at)          as month
  from public.deal_outcomes
  group by org_id, outcome, reason, date_trunc('month', closed_at);
