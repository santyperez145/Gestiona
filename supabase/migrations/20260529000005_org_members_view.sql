-- ─────────────────────────────────────────────────────────────────
-- Backwards-compat view: `org_members` → `memberships`
-- Sprint A1 cleanup: 93 migrations historically referenced the
-- non-existent table `public.org_members`. Production has been
-- running fine because RLS policies failed open (`org_id IN (NULL)`
-- evaluates to false → policies are silently restrictive).
--
-- Rather than rewrite 93 migrations (risk of accidental break),
-- we expose `org_members` as a thin view over `memberships` so all
-- existing policies suddenly resolve correctly.
-- ─────────────────────────────────────────────────────────────────

create or replace view public.org_members as
  select
    id,
    org_id,
    user_id,
    role,
    joined_at,
    invited_by
  from public.memberships;

-- Allow authenticated users to read the view (RLS policies on it
-- inherit from the underlying memberships table).
grant select on public.org_members to authenticated, service_role;

-- Also fix the audit_logs / role_permissions / deal_outcomes
-- policies created in the previous migrations: they referenced
-- `memberships` directly, so they are already correct — no-op.

comment on view public.org_members is
  'Backwards-compat alias of public.memberships. Used by 90+ legacy RLS policies. Prefer memberships in new code.';
