-- ─────────────────────────────────────────────────────────────────
-- Drip — unsubscribe tokens
-- Sprint B2: legal compliance (CAN-SPAM, GDPR, Argentine PDPA)
--
-- Every drip email gets a unique unsubscribe token that:
--   1. Expires after 90 days (so old emails can still be unsubscribed)
--   2. Marks the enrollment as `unsubscribed` when clicked
--   3. Optionally suppresses the email globally for the org
-- ─────────────────────────────────────────────────────────────────

-- ─── Token table ────────────────────────────────────────────────────────────
create table if not exists public.drip_unsubscribe_tokens (
  id            uuid        primary key default gen_random_uuid(),
  token         text        not null unique,
  enrollment_id uuid        not null references public.drip_enrollments(id) on delete cascade,
  org_id        uuid        not null,
  customer_email text       not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '90 days'),
  used_at       timestamptz,
  user_agent    text,
  ip_address    inet
);

create index if not exists idx_drip_unsub_token  on public.drip_unsubscribe_tokens(token);
create index if not exists idx_drip_unsub_enroll on public.drip_unsubscribe_tokens(enrollment_id);
create index if not exists idx_drip_unsub_email  on public.drip_unsubscribe_tokens(org_id, customer_email);

-- ─── Suppression list (global opt-out per org) ──────────────────────────────
create table if not exists public.email_suppressions (
  id              uuid        primary key default gen_random_uuid(),
  org_id          uuid        not null,
  email           text        not null,
  reason          text        not null default 'unsubscribed'
                              check (reason in ('unsubscribed', 'bounced', 'complaint', 'manual')),
  source          text,           -- e.g. 'drip:sequence-name'
  created_at      timestamptz not null default now(),
  unique (org_id, email)
);

create index if not exists idx_email_suppressions_org_email on public.email_suppressions(org_id, email);

-- ─── RLS ────────────────────────────────────────────────────────────────────
alter table public.drip_unsubscribe_tokens enable row level security;
alter table public.email_suppressions      enable row level security;

drop policy if exists "org_drip_unsub_read"   on public.drip_unsubscribe_tokens;
drop policy if exists "org_suppressions_all"  on public.email_suppressions;

create policy "org_drip_unsub_read"
  on public.drip_unsubscribe_tokens for select
  using (org_id in (select org_id from public.memberships where user_id = auth.uid()));

create policy "org_suppressions_all"
  on public.email_suppressions for all
  using  (org_id in (select org_id from public.memberships where user_id = auth.uid()))
  with check (org_id in (select org_id from public.memberships where user_id = auth.uid()));

-- ─── RPC: process unsubscribe (called by edge function) ─────────────────────
create or replace function public.process_drip_unsubscribe(
  p_token text,
  p_user_agent text default null,
  p_ip inet default null
) returns jsonb
language plpgsql security definer as $$
declare
  v_token public.drip_unsubscribe_tokens;
  v_enrollment public.drip_enrollments;
begin
  -- Lookup token
  select * into v_token
  from public.drip_unsubscribe_tokens
  where token = p_token
  limit 1;

  if v_token.id is null then
    return jsonb_build_object('ok', false, 'error', 'token_not_found');
  end if;

  if v_token.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'token_expired');
  end if;

  -- Mark token used (idempotent — second click is fine)
  update public.drip_unsubscribe_tokens
     set used_at = coalesce(used_at, now()),
         user_agent = coalesce(user_agent, p_user_agent),
         ip_address = coalesce(ip_address, p_ip)
   where id = v_token.id;

  -- Flip enrollment to unsubscribed
  update public.drip_enrollments
     set status = 'unsubscribed',
         completed_at = now()
   where id = v_token.enrollment_id;

  select * into v_enrollment
  from public.drip_enrollments
  where id = v_token.enrollment_id;

  -- Suppress globally for the org (all future drips)
  insert into public.email_suppressions (org_id, email, reason, source)
  values (v_token.org_id, v_token.customer_email, 'unsubscribed', 'drip')
  on conflict (org_id, email) do nothing;

  return jsonb_build_object(
    'ok', true,
    'email', v_token.customer_email,
    'org_id', v_token.org_id,
    'enrollment_id', v_token.enrollment_id
  );
end;
$$;

-- Make sure anon can call it (the unsubscribe link works without auth)
grant execute on function public.process_drip_unsubscribe(text, text, inet) to anon, authenticated, service_role;

-- ─── RPC: check if an email is suppressed ───────────────────────────────────
create or replace function public.is_email_suppressed(
  p_org_id uuid,
  p_email text
) returns boolean
language sql stable security definer as $$
  select exists(
    select 1 from public.email_suppressions
    where org_id = p_org_id and email = p_email
  );
$$;

grant execute on function public.is_email_suppressed(uuid, text) to authenticated, service_role;
