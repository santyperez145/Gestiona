-- Session 43: WhatsApp Campaigns + Payment Links improvements
-- 2026-05-22

-- ── whatsapp_campaigns ──────────────────────────────────────────────────────
create table if not exists whatsapp_campaigns (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  message       text not null,
  segment       text not null default 'all',
  status        text not null default 'draft' check (status in ('draft','sending','sent','failed')),
  sent_count    int  not null default 0,
  failed_count  int  not null default 0,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);

alter table whatsapp_campaigns enable row level security;

create policy "org members can manage whatsapp_campaigns"
  on whatsapp_campaigns for all
  using (
    exists (
      select 1 from memberships m
      where m.org_id = whatsapp_campaigns.org_id
        and m.user_id = auth.uid()
    )
  );

create index if not exists whatsapp_campaigns_org_id_idx on whatsapp_campaigns(org_id);

-- ── payment_links: add missing columns if not present ───────────────────────
alter table payment_links
  add column if not exists customer_email   text,
  add column if not exists mp_preference_id text,
  add column if not exists external_ref     text;

-- index for external_ref lookups from webhook
create index if not exists payment_links_external_ref_idx
  on payment_links(org_id, external_ref)
  where external_ref is not null;

-- ── Scheduled campaigns cron (every 15 min) ─────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Remove old job if it exists, then re-add
    perform cron.unschedule('send-scheduled-campaigns') where exists (
      select 1 from cron.job where jobname = 'send-scheduled-campaigns'
    );
    perform cron.schedule(
      'send-scheduled-campaigns',
      '*/15 * * * *',
      $$
        select net.http_post(
          url := current_setting('app.supabase_url') || '/functions/v1/send-scheduled-campaigns',
          headers := '{"Authorization":"Bearer ' || current_setting('app.service_role_key') || '","Content-Type":"application/json"}'::jsonb,
          body := '{}'::jsonb
        );
      $$
    );
  end if;
end $$;

-- ── Expire payment links (daily) ─────────────────────────────────────────────
create or replace function expire_payment_links() returns void language plpgsql as $$
begin
  update payment_links
  set status = 'expired'
  where status = 'pending'
    and expires_at is not null
    and expires_at < now();
end $$;
